/**
 * V4.x State Machine 统一入口 (老板实测 08-22 + 08-27)
 *
 * 业务流程 = 用 orchestrator 调度状态, 不用手写转移
 *   import { orchestrator } from '@/core/stateMachine';
 *
 *   orchestrator.send('START');              // Idle -> QianjiRefreshing (老板点 / 千机监听 / 反息屏 入口)
 *   orchestrator.send('QIANJI_READY');       // -> BaoliRunning
 *   orchestrator.send('BAOLI_COMPLETE');     // -> YuexiuRunning
 *   orchestrator.send('YUEXIU_COMPLETE');    // -> Idle (08-27 老板拍板: 不再绕 Cooldown)
 *   orchestrator.send('QIANJI_NO_REPORT');   // -> Idle (08-27 老板拍板: 不再绕 Cooldown)
 *   orchestrator.send('USER_CONFIRM');       // UserIntervention -> Idle (老板点"开始干活")
 *   orchestrator.send('RESET');              // Error -> Idle (老板手动恢复)
 *
 * 6 态: Idle / QianjiRefreshing / BaoliRunning / YuexiuRunning / UserIntervention / Error
 * 已删除 Cooldown: 流程正常结束直接 Idle, 老板 / 千机监听 / 反息屏 都能立刻启动
 */

import { orchestrator } from './orchestrator';

export { OrchState, ALL_STATES, STATE_INFO } from './states';
export {
  TRANSITIONS,
  TransitionEvent,
  canTransition,
  applyTransition,
  findTransition,
  getTransitionsFrom,
  getTransitionsTo,
} from './transitions';
export { stateBus, StateMachineEvent, StateChangedPayload } from './eventBus';
export { orchestrator };
export default orchestrator;
