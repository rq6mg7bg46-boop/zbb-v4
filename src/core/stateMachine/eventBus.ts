/**
 * V4.x State Machine Event Bus (老板实战反证金标准 08-22)
 *
 * 状态变更事件总线: DeviceEventEmitter 包装
 * - emit(event, payload)  广播状态变更
 * - subscribe(event, fn)  订阅状态变更
 * - subscribeOnce         订阅一次
 *
 * 业务流程:
 *   import { stateBus } from '@/core/stateMachine';
 *   stateBus.on('state.changed', (newState, oldState) => { ... });
 *   stateBus.emit('state.changed', { newState, oldState });
 */

import { DeviceEventEmitter, EmitterSubscription } from 'react-native';

export type StateMachineEvent =
  | 'state.changed'           // 状态变更
  | 'state.idle'              // 进入空闲
  | 'state.error'             // 进入错误
  | 'state.cooldown'          // 进入冷却
  | 'state.user_intervention' // 进入用户介入
  | 'flow.started'            // 业务流程开始
  | 'flow.completed'          // 业务流程完成
  | 'flow.failed';            // 业务流程失败

export interface StateChangedPayload {
  oldState: string;
  newState: string;
  event?: string;
  timestamp: number;
}

class StateEventBus {
  /**
   * 广播事件
   */
  emit(event: StateMachineEvent, payload?: any): void {
    DeviceEventEmitter.emit(event, payload);
  }

  /**
   * 订阅事件
   */
  on(event: StateMachineEvent, listener: (payload: any) => void): EmitterSubscription {
    return DeviceEventEmitter.addListener(event, listener);
  }

  /**
   * 订阅一次
   */
  once(event: StateMachineEvent, listener: (payload: any) => void): EmitterSubscription {
    const sub = DeviceEventEmitter.addListener(event, (payload) => {
      listener(payload);
      sub.remove();
    });
    return sub;
  }

  /**
   * 取消所有订阅
   */
  removeAll(event: StateMachineEvent): void {
    DeviceEventEmitter.removeAllListeners(event);
  }
}

export const stateBus = new StateEventBus();
export default stateBus;
