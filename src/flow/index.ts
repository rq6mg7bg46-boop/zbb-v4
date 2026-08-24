/**
 * V4.x flow barrel export (老板实战反证金标准 08-23, 08-24 重构)
 * 把 qianji / baoli 流程的入口函数集中再导出, 让 HomeScreen 一行 import 即可
 *
 * 老板实战反证金标准 08-24:
 *   - HomeScreen.handleStart 内部逻辑抽到 runZbbWorkflow()
 *   - 5min 自动触发器 (services/index.ts) 也调 runZbbWorkflow()
 *   - 两者 100% 复用同一套流程, 避免抢跑 bug (历史 V2.x 实战反证)
 */

export { runQianjiFlow, stepOpenQianji, stepRecognizeInterface, stepFindReportReview, stepParseCustomerInfo, stepWriteToReports, stepCopyPhoneNumber } from './qianji';
export type { CustomerInfo } from './qianji';

export { runBaoliFlow } from './baoli';

import { runQianjiFlow } from './qianji';
import { runBaoliFlow } from './baoli';
import { orchestrator, OrchState } from '@/core/stateMachine';

export type WorkflowResult = {
  ok: boolean;
  skipped: boolean;
  reason:
    | 'user_intervention'
    | 'already_running'
    | 'qianji_failed'
    | 'baoli_failed'
    | 'unknown_project'
    | 'success';
  customerName?: string;
  projectType?: string;
};

/**
 * V4.x 完整业务工作流 (老板实战反证金标准 08-24)
 *
 * 复刻 HomeScreen.handleStart 内部逻辑, 让 5min 触发器 / HomeScreen.handleStart 100% 复用
 *
 * 流程:
 *   1. 检查 orchestrator 状态 (USER_INTERVENTION / 已运行 → 跳过)
 *   2. setOrchestrator(QianjiRefreshing)
 *   3. runQianjiFlow() → 拿 customer
 *   4. customer.projectType === 'baoli' → runBaoliFlow(customer)
 *   5. customer.projectType === 'yuexiu' → 越秀待实现, 跳过
 *
 * @returns WorkflowResult.ok=true 表示流程跑成功; skipped=true 表示被守卫跳过
 */
export async function runZbbWorkflow(): Promise<WorkflowResult> {
  console.log('[runZbbWorkflow] 启动完整业务流...');

  // 1. 并发守卫: USER_INTERVENTION / already running → 跳过
  if (orchestrator.isInUserIntervention()) {
    console.warn('[runZbbWorkflow] 跳过: USER_INTERVENTION 中');
    return { ok: false, skipped: true, reason: 'user_intervention' };
  }
  if (orchestrator.isRunning()) {
    console.warn('[runZbbWorkflow] 跳过: 已在运行中');
    return { ok: false, skipped: true, reason: 'already_running' };
  }

  try {
    // 2. 千机端
    const customer = await runQianjiFlow();
    if (!customer) {
      console.warn('[runZbbWorkflow] 千机端失败');
      return { ok: false, skipped: false, reason: 'qianji_failed' };
    }

    // 3. 按项目类型分派
    if (customer.projectType === 'baoli') {
      const ok = await runBaoliFlow(customer);
      if (!ok) {
        return { ok: false, skipped: false, reason: 'baoli_failed' };
      }
      return { ok: true, skipped: false, reason: 'success', customerName: customer.customerName, projectType: customer.projectType };
    }

    // 越秀端待 S2.4 实现
    console.warn(`[runZbbWorkflow] 越秀端待实现 (${customer.customerName})`);
    return { ok: false, skipped: false, reason: 'unknown_project' };
  } catch (e: any) {
    console.error('[runZbbWorkflow] 异常:', e);
    return { ok: false, skipped: false, reason: 'unknown_project' };
  }
}