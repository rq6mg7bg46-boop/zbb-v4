/**
 * V4.x flow barrel export (老板实战反证金标准 08-23, 08-24 重构 + 08-25 正常/非正常结束分流)
 * 把 qianji / baoli 流程的入口函数集中再导出, 让 HomeScreen 一行 import 即可
 *
 * 老板实战反证金标准 08-25 (正常 vs 非正常结束):
 *   - 正常结束: 千机 → 保利 → 越秀全成功 → 进 Cooldown → 60s 后 Idle → 自动接龙跑下一个
 *   - 非正常结束: 任一环节 raiseAlert / 失败 → 进 UserIntervention → 等老板点"开始干活"
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
 * V4.x 完整业务工作流 (老板实战反证金标准 08-24 + 08-25)
 *
 * 复刻 HomeScreen.handleStart 内部逻辑, 让 5min 触发器 / HomeScreen.handleStart 100% 复用
 *
 * 流程结束状态分流 (08-25 老板拍板):
 *   1. 千机端 raiseAlert → customer=null → send('QIANJI_INTERVENE') → UserIntervention → 等老板
 *   2. 千机端真正异常 → send('QIANJI_FAILED') → Error
 *   3. 保利端失败 → send('BAOLI_FAILED') → Error
 *   4. 越秀端待实现 → send('YUEXIU_INTERVENE') → UserIntervention (老板实战反证: 等老板手动)
 *   5. 全成功 → send('YUEXIU_COMPLETE') → Cooldown → 60s 后 → Idle → 自动接龙
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

  // 2. 进入千机端刷新状态
  orchestrator.send('START');

  try {
    // 3. 千机端
    const customer = await runQianjiFlow();
    if (!customer) {
      // 🆕 08-25 老板拍板: 千机端 raiseAlert / return null = 非正常结束
      //   → 进 UserIntervention, 等老板点"开始干活"才恢复
      //   状态机: QianjiRefreshing + QIANJI_INTERVENE → UserIntervention
      console.warn('[runZbbWorkflow] 千机端失败 → 进 UserIntervention (等老板)');
      orchestrator.send('QIANJI_INTERVENE');
      return { ok: false, skipped: false, reason: 'qianji_failed' };
    }

    // 千机 ready → 保利
    orchestrator.send('QIANJI_READY');

    // 4. 按项目类型分派
    if (customer.projectType === 'baoli') {
      const ok = await runBaoliFlow(customer);
      if (!ok) {
        // 保利失败 → Error (老板实战反证金标准 08-25: 保利异常不算用户介入)
        console.warn('[runZbbWorkflow] 保利端失败 → 进 Error');
        orchestrator.send('BAOLI_FAILED');
        return { ok: false, skipped: false, reason: 'baoli_failed' };
      }
      // 保利完成 → 越秀 (V4.x 暂未实装, 直接当成功)
      orchestrator.send('BAOLI_COMPLETE');

      // 🆕 08-25 老板拍板: 正常结束 → 进 Cooldown → 自动接龙
      //   状态机: YuexiuRunning + YUEXIU_COMPLETE → Cooldown → COOLDOWN_DONE → Idle → 自动跑下一个
      //   注: V4.x 暂未实装越秀端, 直接当 YUEXIU_COMPLETE 处理
      orchestrator.send('YUEXIU_COMPLETE');
      console.log(`[runZbbWorkflow] ✓ 全流程完成: 客户=${customer.customerName} 项目=${customer.projectType} → 进 Cooldown`);
      return { ok: true, skipped: false, reason: 'success', customerName: customer.customerName, projectType: customer.projectType };
    }

    // 越秀端待 S2.4 实现 → 当作需要老板介入 (老板实战反证金标准 08-25)
    console.warn(`[runZbbWorkflow] 越秀端待实现 (${customer.customerName}) → 进 UserIntervention`);
    orchestrator.send('YUEXIU_INTERVENE');
    return { ok: false, skipped: false, reason: 'unknown_project' };
  } catch (e: any) {
    console.error('[runZbbWorkflow] 异常:', e);
    // 真正异常 → Error (不是 UserIntervention)
    orchestrator.send('QIANJI_FAILED');
    return { ok: false, skipped: false, reason: 'unknown_project' };
  }
}