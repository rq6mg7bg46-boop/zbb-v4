/**
 * V4.x State Machine Transitions (老板实战反证金标准 08-22)
 *
 * 7 态转移图定义 + guard 函数
 *
 * 转移表:
 * Idle              -> QianjiRefreshing (老板点"开始")
 * QianjiRefreshing  -> BaoliRunning (千机数据 ready)
 * QianjiRefreshing  -> Error (千机失败)
 * BaoliRunning      -> YuexiuRunning (保利完成)
 * BaoliRunning      -> Error (保利失败)
 * BaoliRunning      -> UserIntervention (需要老板)
 * YuexiuRunning     -> Cooldown (越秀完成)
 * YuexiuRunning     -> Error (越秀失败)
 * YuexiuRunning     -> UserIntervention (需要老板)
 * UserIntervention  -> Idle (老板手动确认)
 * UserIntervention  -> Error (老板取消)
 * Cooldown          -> Idle (60s 倒计时结束)
 * Error             -> Idle (老板手动恢复)
 */

import { OrchState } from './states';

/**
 * 转移事件
 */
export type TransitionEvent =
  | 'START'           // 老板点开始
  | 'QIANJI_READY'    // 千机数据 ready
  | 'QIANJI_FAILED'   // 千机失败
  | 'BAOLI_COMPLETE'  // 保利完成
  | 'BAOLI_FAILED'    // 保利失败
  | 'BAOLI_INTERVENE' // 保利需要老板介入
  | 'YUEXIU_COMPLETE' // 越秀完成
  | 'YUEXIU_FAILED'   // 越秀失败
  | 'YUEXIU_INTERVENE'// 越秀需要老板介入
  | 'USER_CONFIRM'    // 老板确认
  | 'USER_CANCEL'     // 老板取消
  | 'COOLDOWN_DONE'   // 冷却结束
  | 'RESET';          // 老板手动恢复

/**
 * 转移定义: from + event -> to
 */
interface Transition {
  from: OrchState;
  event: TransitionEvent;
  to: OrchState;
  description: string;
}

export const TRANSITIONS: Transition[] = [
  // 启动链路
  { from: OrchState.Idle, event: 'START', to: OrchState.QianjiRefreshing, description: '老板点开始 -> 千机刷数据' },
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_READY', to: OrchState.BaoliRunning, description: '千机 ready -> 保利' },
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_FAILED', to: OrchState.Error, description: '千机失败 -> 错误' },

  // 保利 -> 越秀
  { from: OrchState.BaoliRunning, event: 'BAOLI_COMPLETE', to: OrchState.YuexiuRunning, description: '保利完成 -> 越秀' },
  { from: OrchState.BaoliRunning, event: 'BAOLI_FAILED', to: OrchState.Error, description: '保利失败 -> 错误' },
  { from: OrchState.BaoliRunning, event: 'BAOLI_INTERVENE', to: OrchState.UserIntervention, description: '保利介入 -> 老板' },

  // 越秀 -> 冷却
  { from: OrchState.YuexiuRunning, event: 'YUEXIU_COMPLETE', to: OrchState.Cooldown, description: '越秀完成 -> 冷却' },
  { from: OrchState.YuexiuRunning, event: 'YUEXIU_FAILED', to: OrchState.Error, description: '越秀失败 -> 错误' },
  { from: OrchState.YuexiuRunning, event: 'YUEXIU_INTERVENE', to: OrchState.UserIntervention, description: '越秀介入 -> 老板' },

  // 用户介入
  { from: OrchState.UserIntervention, event: 'USER_CONFIRM', to: OrchState.Idle, description: '老板确认 -> 空闲' },
  { from: OrchState.UserIntervention, event: 'USER_CANCEL', to: OrchState.Error, description: '老板取消 -> 错误' },

  // 冷却
  { from: OrchState.Cooldown, event: 'COOLDOWN_DONE', to: OrchState.Idle, description: '冷却结束 -> 空闲' },

  // 恢复
  { from: OrchState.Error, event: 'RESET', to: OrchState.Idle, description: '老板手动恢复 -> 空闲' },
];

/**
 * 查找转移
 */
export function findTransition(
  from: OrchState,
  event: TransitionEvent,
): Transition | null {
  return TRANSITIONS.find(t => t.from === from && t.event === event) ?? null;
}

/**
 * Guard 函数: 判断状态 + 事件组合是否合法
 */
export function canTransition(
  from: OrchState,
  event: TransitionEvent,
): boolean {
  return findTransition(from, event) !== null;
}

/**
 * 应用转移 (返回新状态, 或抛错)
 */
export function applyTransition(
  from: OrchState,
  event: TransitionEvent,
): OrchState {
  const t = findTransition(from, event);
  if (!t) {
    throw new Error(`[StateMachine] 非法转移: ${from} + ${event}`);
  }
  return t.to;
}

/**
 * 获取所有从某状态出发的转移
 */
export function getTransitionsFrom(from: OrchState): Transition[] {
  return TRANSITIONS.filter(t => t.from === from);
}

/**
 * 获取所有进入某状态的转移
 */
export function getTransitionsTo(to: OrchState): Transition[] {
  return TRANSITIONS.filter(t => t.to === to);
}
