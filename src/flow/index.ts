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

import { runQianjiFlow, readReportCountFromNodes, type CustomerInfo } from './qianji'; // 🆕 V32.36.110 老板拍板: 学习 V2 testOnlyQianjiFlow 拿下一组 varB
import { runBaoliFlow } from './baoli';
import { orchestrator, OrchState } from '@/core/stateMachine';
import { setZbbWorkflowRunner } from './handleStart';
import { ZBBAutomation } from '@/native'; // 🆕 V32.36.103 老板拍板: 自动续跑 dump 千机首页用
import { qianjiPackage, qianjiMainActivity } from '@/config/env'; // 🆕 V32.36.105 老板拍板: dump 前 launch 千机确保首页
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
      // 🆕 V32.36.4: 端流程内部已自管状态转换 (V32.36.3 改 baoli.ts raiseAlert + send INTERVENE/FAILED)
      //   - runZbbWorkflow 不再二次发 onFailed, 避免 'BAOLI_FAILED' 二次触发 Illegal transition
      //   - 只读 orchestrator 当前状态决定 return reason
      const ok = await config.run(customer);
      if (!ok) {
        // 读当前状态机 (baoli.ts 已经发了 INTERVENE 或 FAILED)
        const currentState = orchestrator.getState();
        if (currentState === OrchState.UserIntervention) {
          logger.info('runZbbWorkflow', `${config.logTag}端失败 → 弹窗等老板 (V32.36.3 raiseAlert + INTERVENE)`);
          return { ok: false, skipped: false, reason: 'user_intervention' };
        }
        // Error 状态 = 真正失败 (没 raiseAlert)
        logger.info('runZbbWorkflow', `${config.logTag}端失败 → 进 Error (无弹窗)`);
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

// 🆕 V32.36.103 老板 09-23 拍板: 注册 runZbbWorkflowAuto 给 handleStart 用 (入口 1 老板点 开始干活 自动续跑)
import { setZbbWorkflowAutoRunner } from './handleStart';
setZbbWorkflowAutoRunner(async () => {
  return await runZbbWorkflowAuto();
});

/**
 * 🆕 V32.36.103 老板 09-23 拍板: 自动续跑机制
 *   老板 nova 11:36 log 反证: 5min 反息屏只报备第一组客户, 不会报备第二组
 *   老板拍板: '跑完一组 → 检查首页 → 有客户 → 立刻再调 runZbbWorkflow → 直到首页没客户'
 *   老板拍板: '不需要递归限制, 因为会一直跑到首页没有客户'
 *
 * 实施:
 *   - 位置: 入口 1 (handleStart) + 入口 3 (反息屏) 都改调本函数
 *   - 循环条件: runZbbWorkflow 成功 + reason != 'no_report' + 千机首页 报备待审核 N > 0
 *   - 退出条件: 千机首页 报备待审核 N == 0 (no_report) / 异常结束 (ok=false) / 守卫跳过 (skipped=true)
 *   - 间隔: 每轮 2-3s 等待 (让 mock 千机刷出新数据)
 *   - 不发通知: 自动续跑不打扰老板, 不弹 Toast
 *
 * V2.x 反证金标准 (QianjiService.ts stepCopyPhoneNumber 后 V2.x 反证逻辑):
 *   - V2.x 设计也是反复跑, 没设上限, 千机空了就停
 *   - 老板 09-23 实测反证: 5min 反息屏只跑第一组, V2.x 早期 v18.x 也有同样问题
 */
export async function runZbbWorkflowAuto(): Promise<{
  totalRuns: number;
  lastResult: WorkflowResult | null;
}> {
  let totalRuns = 0;
  let lastResult: WorkflowResult | null = null;

  for (let loop = 1; ; loop++) {
    logger.info('runZbbWorkflowAuto', `第 ${loop} 轮 runZbbWorkflow 启动...`);

    // 1. 跑单次流程
    const result = await runZbbWorkflow();
    totalRuns++;
    lastResult = result;

    // 2. 退出条件: 异常结束 / 千机无客户 / 守卫跳过
    if (!result.ok) {
      logger.info('runZbbWorkflowAuto', `第 ${loop} 轮异常结束 (reason=${result.reason}), 停止自动续跑`);
      break;
    }
    if (result.skipped || result.reason === 'no_report') {
      logger.info('runZbbWorkflowAuto', `第 ${loop} 轮无客户/被跳过 (reason=${result.reason}), 停止自动续跑`);
      break;
    }

    // 3. 等 2-3s 让 mock 千机刷出新数据 (V32.36.103 老板拍板)
    const wait = 2000 + Math.floor(Math.random() * 1000);
    logger.info('runZbbWorkflowAuto', `第 ${loop} 轮跑完, 等 ${wait}ms 让千机刷数据...`);
    await new Promise((r) => setTimeout(r, wait));

    // 🆕 V32.36.110 老板 09-24 拍板: 学习 V2 实现逻辑 (老板 nova 14:13 反证)
    //   老板原话: '现在不是log的问题,是流程本应该继续跑第二组客户,但到这里结束了!'
    //   老板原话: '学习V2的实现逻辑!!'
    //
    //   V2 实现 (QianjiService.ts:1289 testOnlyQianjiFlow + BaoliService.ts:2333 接龙):
    //     - 保 baoli 步骤15-情况2 完成后 → 调 QianjiService.testOnlyQianjiFlow()
    //     - testOnlyQianjiFlow 跑 step1+2+3+4+5+6+7 = 完整千机流程 (拿 varB)
    //     - 拿到 varB → 返回 'has_baoli'
    //     - 外层 BaoliService 看到 'has_baoli' → 递归 baoli.execute() 跑下一组
    //     - 没客户 → 返回 'no_pending' → 停止
    //
    //   V32.36.103/105/107 反证: dump 千机首页文本节点拿不到"报备待审核"
    //     - 保 baoli 步骤 14-7 Toast 阶段 dump 不到
    //     - V32.36.105 launch 千机后 dump 也可能拿不到 (mock 千机冷启动慢)
    //     - 老 dump + launch 千机机制不可靠
    //
    //   修法 V32.36.110: 删 dump + launch 千机, 直接调 runQianjiFlow() 跑完整千机步骤 (学习 V2)
    //     - runQianjiFlow 内部会 launch 千机 + 跑 1+2+3+4+5+6+7 + 拿 varB + 按 Home 键
    //     - 如果千机无客户 → 返回 'no_report' → 跳出循环
    //     - 如果有客户 → 返回 CustomerInfo → continue 跑下一轮
    //
    // V2.x 反证金标准 (QianjiService.ts:1289 testOnlyQianjiFlow):
    //   - V2 老板 2026-07-12 实战反证: testOnlyQianjiFlow 不调 stepJumpToReportApp (避免无限循环)
    //   - V2 拿 varB 后只返回 'has_baoli', 让外层 baoli.execute 递归
    //   - V4 V32.36.110: runQianjiFlow 拿 varB 后返回 CustomerInfo, runZbbWorkflowAuto continue 跑下一轮
    let nextCustomer: CustomerInfo | null | 'no_report' = null;
    try {
      logger.info('runZbbWorkflowAuto', `学习 V2 testOnlyQianjiFlow: 调 runQianjiFlow() 检测下一组 (V32.36.110 老板拍板)`);
      nextCustomer = await runQianjiFlow();
    } catch (qianjiErr: any) {
      logger.warn('runZbbWorkflowAuto', `runQianjiFlow 检测下一组异常 (best-effort, 退出循环): ${qianjiErr}`);
      break;
    }

    if (nextCustomer === 'no_report' || nextCustomer === null) {
      logger.info('runZbbWorkflowAuto', `千机已无待审核客户 → 停止自动续跑 (共 ${loop} 轮)`);
      break;
    }
    logger.info('runZbbWorkflowAuto', `✓ 千机有下一组客户=${nextCustomer.customerName} 项目=${nextCustomer.projectType} → 立刻跑下一轮 (V32.36.110 学习 V2)`);
  }

  return { totalRuns, lastResult };
}