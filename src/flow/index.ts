/**
 * V4.x flow barrel export (老板实测 08-23, 08-24 重构 + 08-27 删冷却)
 * 把 qianji / baoli 流程的入口函数集中再导出, 让 HomeScreen 一行 import 即可
 *
 * 老板实测 08-27:
 *   - 流程正常结束 (YUEXIU_COMPLETE / QIANJI_NO_REPORT) → 直 → Idle, 不再绕 Cooldown
 *   - Idle 状态下, 老板点 / 千机监听 / 反息屏 都能立刻启动 runZbbWorkflow (并发守卫仍生效)
 *   - 流程异常结束 → UserIntervention, 只有老板点"开始干活"才能恢复
 *
 * 老板实测 08-24:
 *   - HomeScreen.handleStart 内部逻辑抽到 runZbbWorkflow()
 *   - 5min 反息屏触发器 (services/index.ts) 也调 runZbbWorkflow()
 *   - 千机监听入口 (services/index.ts) 也调 runZbbWorkflow()
 *   - 三者 100% 复用同一套流程, 避免抢跑 bug (历史 V2.x 实测)
 */

import { runQianjiFlow } from './qianji';
import { runBaoliFlow } from './baoli';
import { orchestrator } from '@/core/stateMachine';
import { setZbbWorkflowRunner } from './handleStart';
import { logger } from '@/utils/logger';
import type { ProjectType } from './types';

export {
  runQianjiFlow,
  stepOpenQianji,
  stepRecognizeInterface,
  stepFindReportReview,
  stepParseCustomerInfo,
  stepWriteToReports,
  stepCopyPhoneNumber,
} from './qianji';
export type { CustomerInfo } from './qianji';
export { runBaoliFlow } from './baoli';
export { handleStart } from './handleStart';

export type WorkflowResult = {
  ok: boolean;
  skipped: boolean;
  reason:
    | 'user_intervention'
    | 'already_running'
    | 'qianji_failed'
    | 'baoli_failed'
    | 'unknown_project'
    | 'success'
    | 'no_report';
  customerName?: string;
  projectType?: string;
};

/**
 * V4.x 完整业务工作流 (老板实测 08-24 + 08-27)
 *
 * 流程结束状态分流:
 *   1. 千机端 raiseAlert → customer=null → send('QIANJI_INTERVENE') → UserIntervention → 等老板
 *   2. 千机端真正异常 → send('QIANJI_FAILED') → Error
 *   3. 保利端失败 → send('BAOLI_FAILED') → Error
 *   4. 越秀端未实装 → send('YUEXIU_INTERVENE') → UserIntervention
 *   5. 业务流程跑完 (千机无客户) → send('QIANJI_NO_REPORT') → Idle (08-27 拍板: 直 Idle)
 *   6. 业务流程跑完 (保利完成 + 越秀完成) → send('YUEXIU_COMPLETE') → Idle (08-27 拍板: 直 Idle)
 *
 * @returns WorkflowResult.ok=true 表示流程跑成功; skipped=true 表示被守卫跳过
 */
export async function runZbbWorkflow(): Promise<WorkflowResult> {
  logger.info('runZbbWorkflow', '启动完整业务流...');

  // 1. 并发守卫: USER_INTERVENTION / already running → 跳过
  if (orchestrator.isInUserIntervention()) {
    logger.info('runZbbWorkflow', '跳过: USER_INTERVENTION 中');
    return { ok: false, skipped: true, reason: 'user_intervention' };
  }
  if (orchestrator.isRunning()) {
    logger.info('runZbbWorkflow', '跳过: 已在运行中');
    return { ok: false, skipped: true, reason: 'already_running' };
  }

  // 2. 进入千机端刷新状态
  orchestrator.send('START');

  try {
    // 3. 千机端
    const customer = await runQianjiFlow();
    if (customer === 'no_report') {
      // 🆕 08-27 老板拍板: 无客户 = 正常业务状态, 直 → Idle (不绕 Cooldown, 不打扰老板)
      //   - notifyNoReport Toast 已显示
      //   - 状态机: QianjiRefreshing + QIANJI_NO_REPORT → Idle
      //   - 老板点 / 千机监听 / 反息屏 都能在 Idle 上立刻启动
      logger.info('runZbbWorkflow', '千机端无客户 → 直 → Idle (正常跳过)');
      orchestrator.send('QIANJI_NO_REPORT');
      return { ok: true, skipped: true, reason: 'no_report' };
    }
    if (!customer) {
      // 千机端 raiseAlert / return null = 非正常结束
      //   → 进 UserIntervention, 等老板点"开始干活"才恢复
      //   状态机: QianjiRefreshing + QIANJI_INTERVENE → UserIntervention
      logger.info('runZbbWorkflow', '千机端失败 → 进 UserIntervention (等老板)');
      orchestrator.send('QIANJI_INTERVENE');
      return { ok: false, skipped: false, reason: 'qianji_failed' };
    }

    // 千机 ready → 端路由 (08-30 老板拍板端路由设计)
    //   - 千机端零 APP 知识, 不知道是微信 / 飞书 / 丁丁
    //   - FLOW_REGISTRY 集中管理所有端 (baoli / yuexiu / zhaoshang / other)
    //   - 每个端自主 launchApp + 自主流程
    //   - 加新端只改 registry + 加端文件, 千机端零改动
    //   - 状态机转换按 customer.projectType 发 QIANJI_READY_* 路由到对应端状态
    const { FLOW_REGISTRY } = await import('./registry');
    // TS strict 兼容: customer.projectType 是 string, cast 为 ProjectType
    const config = FLOW_REGISTRY[customer.projectType as ProjectType];

    if (!config) {
      // 未知端类型 → UserIntervention
      logger.warn('runZbbWorkflow', `未知端类型: ${customer.projectType} → 进 UserIntervention`);
      orchestrator.send('YUEXIU_INTERVENE');
      return { ok: false, skipped: false, reason: 'unknown_project' };
    }

    // 状态机转换: 千机 → 对应端状态
    //   - baoli → QIANJI_READY_BAOLI → BaoliRunning
    //   - yuexiu → QIANJI_READY_YUEXIU → YuexiuRunning
    //   - zhaoshang → QIANJI_READY_ZHAOSHANG → ZhaoshangRunning
    const readyEventMap: Record<ProjectType, 'QIANJI_READY_BAOLI' | 'QIANJI_READY_YUEXIU' | 'QIANJI_READY_ZHAOSHANG'> = {
      baoli: 'QIANJI_READY_BAOLI',
      yuexiu: 'QIANJI_READY_YUEXIU',
      zhaoshang: 'QIANJI_READY_ZHAOSHANG',
      other: 'QIANJI_READY_BAOLI',  // 兜底走保利 (兼容旧版)
    };
    orchestrator.send(readyEventMap[customer.projectType as ProjectType]);

    try {
      // 调用端流程 (每个端自主 launchApp + 完整流程)
      const ok = await config.run(customer);
      if (!ok) {
        logger.info('runZbbWorkflow', `${config.logTag}端失败 → 进 Error`);
        orchestrator.send(config.onFailed);
        return { ok: false, skipped: false, reason: 'baoli_failed' };
      }

      orchestrator.send(config.onComplete);
      logger.info('runZbbWorkflow', `✓ 全流程完成: 客户=${customer.customerName} 项目=${customer.projectType} (${config.logTag}端) → 直 → Idle`);
      return {
        ok: true,
        skipped: false,
        reason: 'success',
        customerName: customer.customerName,
        projectType: customer.projectType,
      };
    } catch (e: any) {
      // 端流程异常 (例如越秀端抛 '待实装') → Error
      logger.error('runZbbWorkflow', `${config.logTag}端异常: ${e}`);
      orchestrator.send(config.onFailed);
      return { ok: false, skipped: false, reason: 'unknown_project' };
    }
  } catch (e: any) {
    logger.error('runZbbWorkflow', `'异常:' ${e}`);
    // 真正异常 → Error (不是 UserIntervention)
    orchestrator.send('QIANJI_FAILED');
    return { ok: false, skipped: false, reason: 'unknown_project' };
  }
}

// 🆕 08-24 实测: 注册给 handleStart 用 (避免循环依赖)
setZbbWorkflowRunner(async () => {
  await runZbbWorkflow();
});