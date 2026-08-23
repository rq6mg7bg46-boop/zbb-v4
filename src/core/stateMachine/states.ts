/**
 * V4.x State Machine States (老板实战反证金标准 08-22)
 *
 * 7 态定义 (V3.0 实战反证金标准):
 * - Idle              空闲 (等待老板点"开始干活")
 * - QianjiRefreshing  千机端刷数据
 * - BaoliRunning      保利流程
 * - YuexiuRunning     越秀流程
 * - UserIntervention  用户介入 (需要老板手动确认)
 * - Cooldown          冷却 (60s 内不重复触发)
 * - Error             错误 (需要恢复)
 */

export enum OrchState {
  Idle = 'Idle',
  QianjiRefreshing = 'QianjiRefreshing',
  BaoliRunning = 'BaoliRunning',
  YuexiuRunning = 'YuexiuRunning',
  UserIntervention = 'UserIntervention',
  Cooldown = 'Cooldown',
  Error = 'Error',
}

/**
 * 7 态列表 (用于 UI 渲染)
 */
export const ALL_STATES: OrchState[] = [
  OrchState.Idle,
  OrchState.QianjiRefreshing,
  OrchState.BaoliRunning,
  OrchState.YuexiuRunning,
  OrchState.UserIntervention,
  OrchState.Cooldown,
  OrchState.Error,
];

/**
 * 状态中文名 + UI 信息
 */
export const STATE_INFO: Record<OrchState, {
  label: string;
  icon: string;
  color: string;
  description: string;
}> = {
  [OrchState.Idle]: {
    label: '空闲',
    icon: '⏸',
    color: '#9CA3AF',
    description: '等待老板开始干活',
  },
  [OrchState.QianjiRefreshing]: {
    label: '千机刷数据',
    icon: '🔄',
    color: '#8B5CF6',
    description: '千机端在刷新客户数据',
  },
  [OrchState.BaoliRunning]: {
    label: '保利执行中',
    icon: '🏃',
    color: '#10B981',
    description: '保利流程正在跑',
  },
  [OrchState.YuexiuRunning]: {
    label: '越秀执行中',
    icon: '🏃',
    color: '#3B82F6',
    description: '越秀流程正在跑',
  },
  [OrchState.UserIntervention]: {
    label: '需要老板介入',
    icon: '✋',
    color: '#F59E0B',
    description: '需要老板手动确认',
  },
  [OrchState.Cooldown]: {
    label: '冷却中',
    icon: '❄',
    color: '#06B6D4',
    description: '60s 内不重复触发',
  },
  [OrchState.Error]: {
    label: '错误',
    icon: '⚠️',
    color: '#EF4444',
    description: '需要恢复',
  },
};
