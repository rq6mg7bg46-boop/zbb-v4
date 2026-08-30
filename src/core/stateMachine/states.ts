/**
 * V4.x State Machine States (老板实测 08-22)
 *
 * 6 态定义 (08-27 老板拍板: 删 Cooldown, 正常结束直接 Idle):
 * - Idle              空闲 (流程正常结束) → 老板点 / 千机监听 / 反息屏触发 都能立刻启动
 * - QianjiRefreshing  千机端刷数据
 * - BaoliRunning      保利流程
 * - YuexiuRunning     越秀流程
 * - UserIntervention  用户介入 (流程异常结束, 必须老板点"开始干活")
 * - Error             错误 (需要恢复)
 *
 * 设计:
 * - 流程跑完 (YUEXIU_COMPLETE / QIANJI_NO_REPORT) → 直 → Idle, 不再绕 Cooldown
 * - 反息屏 5min 触发跟业务流程互相不感知 (各自守卫), 反息屏不能打断运行中的业务
 * - UserIntervention 期间 = 异常结束, 反息屏不触发业务 (老板不介入, 没人操作, lastInteraction 不刷新, 永远不触发)
 */

export enum OrchState {
  Idle = 'Idle',
  QianjiRefreshing = 'QianjiRefreshing',
  BaoliRunning = 'BaoliRunning',
  YuexiuRunning = 'YuexiuRunning',
  ZhaoshangRunning = 'ZhaoshangRunning',  // 🆕 08-30 老板拍板端路由: 招商端流程态
  UserIntervention = 'UserIntervention',
  Error = 'Error',
}

/**
 * 6 态列表 (用于 UI 渲染)
 */
export const ALL_STATES: OrchState[] = [
  OrchState.Idle,
  OrchState.QianjiRefreshing,
  OrchState.BaoliRunning,
  OrchState.YuexiuRunning,
  OrchState.ZhaoshangRunning,  // 🆕 08-30 老板拍板端路由
  OrchState.UserIntervention,
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
  // 🆕 08-30 老板拍板端路由: 招商端流程态
  [OrchState.ZhaoshangRunning]: {
    label: '招商执行中',
    icon: '🏃',
    color: '#8B5CF6',
    description: '招商流程正在跑 (端路由)',
  },
  [OrchState.UserIntervention]: {
    label: '需要老板介入',
    icon: '✋',
    color: '#F59E0B',
    description: '流程异常结束,需要老板手动点"开始干活"',
  },
  [OrchState.Error]: {
    label: '错误',
    icon: '⚠️',
    color: '#EF4444',
    description: '需要恢复',
  },
};
