/**
 * V4.x State Machine Orchestrator (老板实测 08-22)
 *
 * 状态机调度器:
 * - getState()       获取当前状态
 * - send(event)      发送转移事件 (应用 guard)
 * - reset()          重置到 Idle
 * - subscribe(fn)    订阅状态变更
 *
 * 业务流程:
 *   import { orchestrator } from '@/core/stateMachine';
 *   orchestrator.send('START');  // Idle -> QianjiRefreshing
 *   orchestrator.onChange((newState, oldState) => { ... });
 */

import { OrchState } from './states';
import {
  TransitionEvent,
  canTransition,
  applyTransition,
  TRANSITIONS,
} from './transitions';
import { stateBus } from './eventBus';

type StateChangeListener = (newState: OrchState, oldState: OrchState, event: TransitionEvent) => void;

/** 业务跑状态集合 (实测 08-24 + 08-27: 删 Cooldown, isRunning = 是否在跑业务)
 *  - QianjiRefreshing: 千机端在跑
 *  - BaoliRunning: 保利端在跑
 *  - YuexiuRunning: 越秀端在跑
 *  用途: 用于 5min 反息屏 / HomeScreen.handleStart 并发守卫 (Cooldown 已删除, 正常结束 = Idle,
 *        所以反息屏触发和老板点击都能立刻启动流程)
 */
const RUNNING_STATES = new Set<OrchState>([
  OrchState.QianjiRefreshing,
  OrchState.BaoliRunning,
  OrchState.YuexiuRunning,
]);

class Orchestrator {
  private currentState: OrchState = OrchState.Idle;
  private listeners: StateChangeListener[] = [];

  constructor() {
    // 启动时 emit 一次 Idle
    stateBus.emit('state.changed', {
      oldState: '',
      newState: OrchState.Idle,
      timestamp: Date.now(),
    });
  }

  /**
   * 获取当前状态
   */
  getState(): OrchState {
    return this.currentState;
  }

  /**
   * 老板实测 08-24 + 08-27:
   *   isRunning = 是否在跑业务 (千机 / 保利 / 越秀)
   *   用于 5min 反息屏 / HomeScreen.handleStart / 千机监听 并发守卫
   *   注意: 正常结束的"自动接龙"已由 Idle 直可达 -> 老板点 / 反息屏 / 千机监听 都能立即触发, 不再受 Cooldown 阻碍
   */
  isRunning(): boolean {
    return RUNNING_STATES.has(this.currentState);
  }

  /**
   * V2.x 实测 (services/index.ts L54-59):
   *   USER_INTERVENTION 期间跳过所有自动触发 (防止 Bug E "流程已在运行中")
   *   08-27: 反息屏触发也被这个守卫挡掉, 保证异常期间不打扰老板
   */
  isInUserIntervention(): boolean {
    return this.currentState === OrchState.UserIntervention;
  }

  /**
   * V2.x 实测 (services/index.ts L60-67):
   *   修法: 5min 触发前查任一 mutex 忙 → 跳过本轮
   *   V4 实测 08-27: 删 Cooldown 后 = isRunning, 业务跑完自动 Idle, 反息屏也能立刻触发
   */
  isAnyServiceBusy(): boolean {
    return this.isRunning();
  }

  /**
   * 发送转移事件
   */
  send(event: TransitionEvent): OrchState {
    const oldState = this.currentState;

    if (!canTransition(oldState, event)) {
      console.warn(`[Orchestrator] 非法转移: ${oldState} + ${event}`);
      return oldState;
    }

    const newState = applyTransition(oldState, event);
    this.currentState = newState;

    // 广播事件
    stateBus.emit('state.changed', {
      oldState,
      newState,
      event,
      timestamp: Date.now(),
    });

    // 触发特定事件
    switch (newState) {
      case OrchState.Idle:
        stateBus.emit('state.idle', { oldState, event });
        break;
      case OrchState.Error:
        stateBus.emit('state.error', { oldState, event });
        break;
      case OrchState.UserIntervention:
        stateBus.emit('state.user_intervention', { oldState, event });
        break;
    }

    // 通知 listeners
    for (const fn of this.listeners) {
      try {
        fn(newState, oldState, event);
      } catch (e) {
        console.error('[Orchestrator] listener error:', e);
      }
    }

    console.log(`[Orchestrator] ${oldState} --[${event}]--> ${newState}`);
    return newState;
  }

  /**
   * 订阅状态变更
   */
  onChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * 重置到 Idle
   */
  reset(): OrchState {
    const oldState = this.currentState;
    this.currentState = OrchState.Idle;
    stateBus.emit('state.changed', {
      oldState,
      newState: OrchState.Idle,
      event: 'RESET',
      timestamp: Date.now(),
    });
    return OrchState.Idle;
  }

  /**
   * 检查当前是否可执行某个 event
   */
  canDo(event: TransitionEvent): boolean {
    return canTransition(this.currentState, event);
  }

  /**
   * 获取当前可执行的 events
   */
  getAvailableEvents(): TransitionEvent[] {
    return TRANSITIONS
      .filter((t) => t.from === this.currentState)
      .map((t) => t.event);
  }
}

export const orchestrator = new Orchestrator();
export default orchestrator;
