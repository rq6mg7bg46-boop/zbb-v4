/**
 * V4.x State Machine 统一入口 (老板实战反证金标准 08-22)
 *
 * 业务流程 = 用 orchestrator 调度状态, 不用手写转移
 *   import { orchestrator, OrchState } from '@/core/stateMachine';
 *
 *   orchestrator.send('START'); // Idle -> QianjiRefreshing
 *   orchestrator.send('QIANJI_READY'); // -> BaoliRunning
 *   orchestrator.send('BAOLI_COMPLETE'); // -> YuexiuRunning
 *   orchestrator.send('YUEXIU_COMPLETE'); // -> Cooldown
 *   orchestrator.send('COOLDOWN_DONE'); // -> Idle
 */

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
export { orchestrator } from './orchestrator';
import { orchestrator } from './orchestrator';
export default orchestrator;
