/**
 * V4.x State Machine Transitions (老板实测 08-22 + 08-27 + 08-30)
 *
 * 7 态转移图定义 + guard 函数 (08-30 老板拍板端路由设计, 加 ZhaoshangRunning):
 *
 * 转移表:
 * Idle              -> QianjiRefreshing (老板点 / 千机监听 / 反息屏 入口)
 * QianjiRefreshing  -> BaoliRunning (千机数据 ready, 保理端) 兼容旧版 QIANJI_READY
 * QianjiRefreshing  -> YuexiuRunning (千机数据 ready, 越秀端) 08-30 端路由
 * QianjiRefreshing  -> ZhaoshangRunning (千机数据 ready, 招商端) 08-30 端路由
 * QianjiRefreshing  -> UserIntervention (千机 raiseAlert)
 * QianjiRefreshing  -> Error (千机真正异常)
 * QianjiRefreshing  -> Idle (千机刷新后 0 客户, 08-27 拍板直接 Idle)
 * BaoliRunning      -> Idle (保利完成, 08-27 拍板直接 Idle)
 * BaoliRunning      -> Error (保利失败)
 * BaoliRunning      -> UserIntervention (需要老板)
 * YuexiuRunning     -> Idle (越秀完成, 08-27 拍板直接 Idle, 不再绕 Cooldown)
 * YuexiuRunning     -> Error (越秀失败)
 * YuexiuRunning     -> UserIntervention (需要老板)
 * ZhaoshangRunning  -> Idle (招商完成, 08-30 端路由直接 Idle)
 * ZhaoshangRunning  -> Error (招商失败)
 * ZhaoshangRunning  -> UserIntervention (需要老板)
 * UserIntervention  -> Idle (老板点"开始干活", 永不超时)
 * UserIntervention  -> Error (老板取消)
 * Error             -> Idle (老板手动恢复)
 */

import { OrchState } from './states';

/**
 * 转移事件
 */
export type TransitionEvent =
  | 'START'                   // 老板点开始 / 千机监听 / 反息屏 触发的入口
  | 'QIANJI_READY'            // 千机数据 ready → BaoliRunning (兼容旧版, 默认走保理)
  | 'QIANJI_READY_BAOLI'      // 🆕 08-30 端路由: 千机 ready → 保理
  | 'QIANJI_READY_YUEXIU'     // 🆕 08-30 端路由: 千机 ready → 越秀
  | 'QIANJI_READY_ZHAOSHANG'  // 🆕 08-30 端路由: 千机 ready → 招商
  | 'QIANJI_FAILED'           // 千机真正失败 → Error
  | 'QIANJI_INTERVENE'        // 千机 raiseAlert → UserIntervention
  | 'QIANJI_NO_REPORT'        // 千机无客户 → Idle (08-27 老板拍板: 不再进 Cooldown)
  | 'BAOLI_COMPLETE'          // 保利完成 → Idle (08-30 端路由: 直接 Idle, 不再绕越秀)
  | 'BAOLI_FAILED'            // 保利失败
  | 'BAOLI_INTERVENE'         // 保利需要老板介入
  | 'YUEXIU_COMPLETE'         // 越秀完成 → Idle (08-27 老板拍板: 不再进 Cooldown)
  | 'YUEXIU_FAILED'           // 越秀失败
  | 'YUEXIU_INTERVENE'        // 越秀需要老板介入
  | 'ZHAOSHANG_COMPLETE'      // 🆕 08-30 端路由: 招商完成 → Idle
  | 'ZHAOSHANG_FAILED'        // 🆕 08-30 端路由: 招商失败
  | 'ZHAOSHANG_INTERVENE'     // 🆕 08-30 端路由: 招商需要老板介入
  | 'UNKNOWN_COMPLETE'        // 🆕 08-30 端路由兜底: 未知端完成 → Idle
  | 'UNKNOWN_FAILED'          // 🆕 08-30 端路由兜底: 未知端失败 → Error
  | 'USER_CONFIRM'            // 老板点"开始干活" → Idle (UserIntervention 恢复)
  | 'USER_CANCEL'             // 老板取消
  | 'RESET';                  // 老板手动恢复

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

  // 千机 → 端 (兼容旧版 + 08-30 端路由)
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_READY', to: OrchState.BaoliRunning, description: '千机 ready -> 保利 (兼容旧版)' },
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_READY_BAOLI', to: OrchState.BaoliRunning, description: '千机 ready -> 保理 (端路由)' },
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_READY_YUEXIU', to: OrchState.YuexiuRunning, description: '千机 ready -> 越秀 (端路由)' },
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_READY_ZHAOSHANG', to: OrchState.ZhaoshangRunning, description: '千机 ready -> 招商 (端路由)' },
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_FAILED', to: OrchState.Error, description: '千机真正失败 -> 错误' },
  // 🆕 08-27 老板拍板: 千机 raiseAlert → UserIntervention (非正常结束, 等老板点)
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_INTERVENE', to: OrchState.UserIntervention, description: '千机 raiseAlert → 老板介入' },
  // 🆕 08-27 老板拍板: 千机无客户 → 直接 Idle (不绕 Cooldown, 不打扰老板)
  { from: OrchState.QianjiRefreshing, event: 'QIANJI_NO_REPORT', to: OrchState.Idle, description: '千机无客户 → 直接 Idle' },

  // 保利 → Idle (08-30 端路由: 不再绕越秀, 直接 Idle)
  { from: OrchState.BaoliRunning, event: 'BAOLI_COMPLETE', to: OrchState.Idle, description: '保利完成 -> 直接 Idle (端路由)' },
  { from: OrchState.BaoliRunning, event: 'BAOLI_FAILED', to: OrchState.Error, description: '保利失败 -> 错误' },
  { from: OrchState.BaoliRunning, event: 'BAOLI_INTERVENE', to: OrchState.UserIntervention, description: '保利介入 -> 老板' },

  // 越秀 → Idle (08-27 老板拍板: 删 Cooldown, 直 → Idle, 自动接龙)
  { from: OrchState.YuexiuRunning, event: 'YUEXIU_COMPLETE', to: OrchState.Idle, description: '越秀完成 -> 直接 Idle' },
  { from: OrchState.YuexiuRunning, event: 'YUEXIU_FAILED', to: OrchState.Error, description: '越秀失败 -> 错误' },
  { from: OrchState.YuexiuRunning, event: 'YUEXIU_INTERVENE', to: OrchState.UserIntervention, description: '越秀介入 -> 老板' },

  // 🆕 08-30 老板拍板端路由: 招商端流程态 (跟越秀一样, 各自 COMPLETE → Idle)
  { from: OrchState.ZhaoshangRunning, event: 'ZHAOSHANG_COMPLETE', to: OrchState.Idle, description: '招商完成 -> 直接 Idle' },
  { from: OrchState.ZhaoshangRunning, event: 'ZHAOSHANG_FAILED', to: OrchState.Error, description: '招商失败 -> 错误' },
  { from: OrchState.ZhaoshangRunning, event: 'ZHAOSHANG_INTERVENE', to: OrchState.UserIntervention, description: '招商介入 -> 老板' },

  // 兜底: 未知端 (projectType 未实装时)
  { from: OrchState.BaoliRunning, event: 'UNKNOWN_COMPLETE', to: OrchState.Idle, description: '未知端完成 -> 直接 Idle' },
  { from: OrchState.BaoliRunning, event: 'UNKNOWN_FAILED', to: OrchState.Error, description: '未知端失败 -> 错误' },

  // 用户介入 (永不超时, 必须老板点"开始干活")
  { from: OrchState.UserIntervention, event: 'USER_CONFIRM', to: OrchState.Idle, description: '老板点开始干活 -> 空闲' },
  { from: OrchState.UserIntervention, event: 'USER_CANCEL', to: OrchState.Error, description: '老板取消 -> 错误' },

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