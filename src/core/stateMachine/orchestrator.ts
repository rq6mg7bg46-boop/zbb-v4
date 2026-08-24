/**
 * V4.x State Machine Orchestrator (老板实战反证金标准 08-22)
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
  findTransition,
} from './transitions';
import { stateBus } from './eventBus';

type StateChangeListener = (newState: OrchState, oldState: OrchState, event: TransitionEvent) => void;

/** 业务跑状态集合 (实战反证金标准 08-24: 老板拍板 isRunning 语义)
 *  - QianjiRefreshing: 千机端在跑
 *  - BaoliRunning: 保利端在跑
 *  - YuexiuRunning: 越秀端在跑
 *  - Cooldown: 跑完冷却 (防止 5min 触发器跟 cooldown 抢跑)
 */
const RUNNING_STATES = new Set<OrchState>([
  OrchState.QianjiRefreshing,
  OrchState.BaoliRunning,
  OrchState.YuexiuRunning,
  OrchState.Cooldown,
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
   * 老板实战反证金标准 08-24:
   *   isRunning = 是否在跑业务 (千机 / 保理 / 越秀 / 冷却)
   *   用于 5min 触发器 / HomeScreen.handleStart 并发守卫
   */
  isRunning(): boolean {
    return RUNNING_STATES.has(this.currentState);
  }

  /**
   * V2.x 实战反证金标准 (services/index.ts L54-59):
   *   USER_INTERVENTION 期间跳过 5min 触发 (防止 Bug E "流程已在运行中")
   */
  isInUserIntervention(): boolean {
    return this.currentState === OrchState.UserIntervention;
  }

  /**
   * V2.x 实战反证金标准 (services/index.ts L60-67):
   *   修法: 5min 触发前查任一 mutex 忙 → 跳过本轮
   *   V4 实战反证金标准: 当前状态在 RUNNING_STATES 集合即视为忙
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
      case OrchState.Cooldown:
        stateBus.emit('state.cooldown', { oldState, event });
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
    const { TRANSITIONS } = require('./transitions');
    return TRANSITIONS
      .filter((t: any) => t.from === this.currentState)
      .map((t: any) => t.event);
  }
}

export const orchestrator = new Orchestrator();
export default orchestrator;
