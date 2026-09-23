/**
 * V4.x 保利流程 (老板实测 08-22, 08-23 重排)
 *
 * 实战经验铁证 (V4.x 保利连续编号 13 步骤, 老板 08-23 拍板简化):
 * - 步骤 1: 打开企业微信 (Intent)
 * - 步骤 2: 点击工作台
 * - 步骤 3: 上滑查找"云和家经纪云" (跨机型 dp 适配)
 * - 步骤 4: 找"郑州保利山水和颂" (V2.x BaoliService.ts:706 反证金标准: 步骤 4 跟 projectName 无关)
 * - 步骤 5: 点底部"报备"按钮 (V2.x 步骤 4.5, v22.00.1 修复)
 * - 步骤 6: 找"粘贴完整客户信息... "节点 + 长按输入框 + 粘贴 (V2.x 步骤 7)
 * - 步骤 7: 点"请选择分期" (V2.x 步骤 9)
 * - 步骤 8: 选择报备项目 (V2.x 步骤 10, round 1=缦城和颂, round 2=山水和颂)
 * - 步骤 9: 点确认 (V2.x 步骤 11)
 * - 步骤 10: 点智能识别 (V2.x 步骤 12)
 * - 步骤 11: 点报备 (V2.x 步骤 13)
 * - 步骤 12: 等待报备结果 (V2.x 步骤 14)
 * - 步骤 13: 检测报备结果 (V2.x 步骤 15):
 *   - 情况 1: 重号 → 弹窗 → 老板介入
 *   - 情况 2: 成功 → 上滑 + 上传附件 + 等截图
 * - 第二轮报备 (重复 1-13)
 *
 * 业务流程 = 只调 operations + orchestrator
 */

import { orchestrator } from '@/core/stateMachine';
import { click, longPress, a11y, judge, pressKey } from '@/operations';
import { swipe } from '@/operations'; // 🆕 V32.36.74 老板拍板: 步骤 14-2 用 swipe.up() 上滑重试
import { ZBBAutomation } from '@/native';
import type { CustomerInfo } from './qianji';
import { verifyAndRecover } from './verify';
import { logger } from '@/utils/logger';
import { raiseAlert } from '@/services/alert';
import { markReportDone } from '@/services/database'; // 🆕 V32.36.52 老板 09-21 拍板: step13-情况2 写数据库
import { findWithRecovery } from './retryUtils'; // 🆕 V32.36.74 老板拍板: 步骤 14-2 用 findWithRecovery + 上滑重试
import { qianjiPackage, qianjiMainActivity } from '@/config/env'; // 🆕 V32.36.55 老板 09-21 拍板: 跟千机-步骤1 一致
import { parseVariableAFromNodes, parseVariableCFromClipboard } from './qianji'; // 🆕 V32.36.82 老板 09-22 拍板: 步骤6 dump 解析复用千机 varA 解析器 + V32.36.87 剪贴板版解析
import { compareCustomer } from '@/utils/compareCustomer'; // 🆕 V32.36.82 老板 09-22 拍板: 步骤6 跟 customer 对比 3 字段
import { px, screenWidthDp, screenHeightDp, centerXDp } from '@/utils/DpUtil'; // V4.x 跨机型适配 (老板拍板 08-23 + V32.36.8 修上滑)
import { scrollUpPPlus, scrollDownPPlus, humanSwipeWithBounceDp, pPlusDelay } from '@/utils/PPlusSwipe'; // 🆕 V32.36.11 P+ 拟人化 (V2.x BaoliService 反证)

const APP_PACKAGES = {
  WECHAT_WORK: 'com.tencent.wework',
  BAOLI_MINIAPP: '云和家经纪云',
};

// 保利项目名 (V2.x BaoliService 实测)
// 🆕 V32.36.11 (老板 09-07 拍板): 区分步骤 4 跳转入口 vs 步骤 10 实际项目名
//   V2.x BaoliService.ts:706-718 反证金标准: 步骤 4 跟 projectName 完全无关, 不论 round 1/2 都找同一个跳转入口
//   V2.x BaoliService.ts:706 硬编码: '郑州保利山水和颂' (云和家小程序第一屏跳转入口)
//   V2.x BaoliService.ts:118-119: 步骤 10 选的实际报备项目名 (跟项目一一对应)
const STEP4_TARGET = '郑州保利山水和颂'; // V2.x 反证金标准 (步骤 4 跳转入口, round 1/2 都用)
const PROJECT_NAME_ROUND_1 = '郑州市三村杓袁7号地项目-保利缦城和颂【郑州保利和颂】';
const PROJECT_NAME_ROUND_2 = '郑州市三村杓袁7号地项目-保利山水和颂【郑州保利山水和颂】';

// 🆕 V32.36.81 老板 09-22 拍板: 跨 runBaoliRound 传失败原因 (情况 1 重号 / 情况 3 3次失败)
//   不用改 runBaoliRound 签名 (会大范围影响), 用 module-level state 简单解决
//   execute() 弹窗前读 lastBaoliFailReason, 决定弹"重号了"还是"失败"
// 🆕 V32.36.82 老板 09-22 拍板: 加 '剪贴板不一致' 类型 (步骤6 粘贴后 dump 对比千机 varB 不一致)
// 🆕 V32.36.91 老板 09-23 拍板: 加 'varD不一致' 类型 (步骤14-2 千机 varD 对比 customer 不一致)
let lastBaoliFailReason: string = '';

// ============================================================
// 保利流程主入口
// ============================================================
export async function runBaoliFlow(customer: CustomerInfo): Promise<boolean> {
  logger.info('app', `========== 保利流程开始 (客户=${customer.customerName}) ==========`);

  // 🆕 V32.36.81: 重置 module-level 失败原因 (新流程开始, 默认空)
  lastBaoliFailReason = '';

  // 🆕 08-30 老板拍板端路由: QIANJI_READY_BAOLI 状态转换在 runZbbWorkflow 已发
  //   - 历史 (V32.33 及之前): baoli.ts 内部发 QIANJI_READY
  //   - 端路由: 千机端步骤7完成后, runZbbWorkflow 按 customer.projectType 发对应 QIANJI_READY_*
  //   - baoli.ts 不再负责状态转换, 只负责流程本身 (launchApp + step1-step9 + 2 轮)
  //   - 优势: 状态机转换统一在 runZbbWorkflow, baoli.ts 纯端逻辑
  // orchestrator.send 已删除 (08-30 端路由设计)

  // 🆕 V32.36.52 老板 09-21 拍板: 从 customer 拿 reportIds (千机端写库后传的)
  const reportIds = customer.reportIds;
  logger.info('保利', `V32.36.52 reportIds=${JSON.stringify(reportIds)} (千机端写库后传的)`);

  try {
    // 第一轮报备 (reportIds = [id1, id2])
    const round1Ok = await runBaoliRound(customer, 1, reportIds);
    if (!round1Ok) {
      logger.info('保利', '第一轮报备失败 → 弹窗等老板');
      // 🆕 V32.36.3: 端失败统一弹窗 + 进 UserIntervention (非 Error 状态)
      // 老板 08-31 装机验证: 之前 BAOLI_FAILED → Error 状态卡住, 反息屏 5min 后还触发
      // 期望: 端失败 = 弹窗 + 震动 + "我知道了" 按钮 + 进 UserIntervention
      // 🆕 V32.36.81 老板 09-22 拍板:
      //   - 弹窗文案: 重号 → "小主,重号了!请手动处理!"
      //   - 弹窗永久不超时 (只在用户点"我知道了"时消失)
      // 🆕 V32.36.82 老板 09-22 拍板:
      //   - 剪贴板不一致 → "小主,剪贴板信息与千机信息不一致,请重新开启流程!!"
      // 🆕 V32.36.90 老板 09-22 拍板: 弹窗只在步骤6弹一次, execute() 不再弹 (否则 2 轮弹窗)
      //   老板原话: '只有用户点击我知道了,弹窗才消失;否则,一直停在界面'
      // 🆕 V32.36.91 老板 09-23 拍板: varD 不一致 (步骤14-2) 同款去重
      //   - 文案: '小主,本次报备的客户与千机现在显示的客户不一致,请手动核对!!'
      //   - execute() 不再二次弹 (步骤14-2 已弹过)
      const round1Message = lastBaoliFailReason === '重号'
        ? '小主,重号了!请手动处理!'
        : lastBaoliFailReason === '剪贴板不一致'
          ? ''  // V32.36.90: 步骤6 已弹过, 不在 execute() 重复弹 (否则弹 2 轮)
          : lastBaoliFailReason === 'varD不一致'
            ? ''  // V32.36.91: 步骤14-2 已弹过, 不在 execute() 重复弹
            : '小主,保利流程报备失败(第1轮),请手动处理!';
      // V32.36.90/91: 步骤6/步骤14-2 已弹过, execute() 跳过二次弹窗
      if (round1Message) {
        await raiseAlert(round1Message, 30000, true);
      } else {
        logger.info('保利', `步骤6/14-2 已弹过 (${lastBaoliFailReason}) 弹窗, execute() 跳过二次弹窗 (V32.36.90/91)`);
      }
      orchestrator.send('BAOLI_INTERVENE');
      return false;
    }

    // 第二轮报备 (reportIds = [id1, id2])
    const round2Ok = await runBaoliRound(customer, 2, reportIds);
    if (!round2Ok) {
      logger.info('保利', '第二轮报备失败 → 弹窗等老板');
      // 🆕 V32.36.3: 同上
      // 🆕 V32.36.81 老板拍板: 重号 → "小主,重号了!请手动处理!"
      const round2Message = lastBaoliFailReason === '重号'
        ? '小主,重号了!请手动处理!'
        : '小主,保利流程报备失败(第2轮),请手动处理!';
      await raiseAlert(round2Message, 30000, true); // V32.36.81 永久不超时
      orchestrator.send('BAOLI_INTERVENE');
      return false;
    }

    orchestrator.send('BAOLI_COMPLETE'); // BaoliRunning → YuexiuRunning
    logger.info('app', '========== 保利流程完成 ==========');
    return true;
  } catch (error) {
    logger.error('保利', `'流程失败:' ${error}`);
    // 🆕 V32.36.3: 异常也弹窗等老板
    // 🆕 V32.36.81: 永久不超时
    await raiseAlert(`小主,保利流程异常,请手动处理! (${error})`, 30000, true);
    orchestrator.send('BAOLI_INTERVENE');
    return false;
  }
}

// ============================================================
// 保利单轮 (第一轮 + 第二轮 都调这个, round 区分)
// ============================================================
async function runBaoliRound(customer: CustomerInfo, round: 1 | 2, reportIds?: [number, number]): Promise<boolean> {
  // 🆕 V32.36.58 老板 09-21 拍板: 接受 [id1, id2] 数组 (而不是单个 ID)
  //   老板拍板: '2轮中任何一轮出错, 均需将2个ID的值写为重号'
  //   老板铁子反证金标准: step13 需要拿到 2 个 ID 才能同时改
  const reportId = reportIds?.[round - 1];
  logger.info('app', `========== 保利第 ${round} 轮开始 (reportIds=${JSON.stringify(reportIds)}, 本轮ID=${reportId}) ==========`);

  // V32.36.42 老板 09-20 装机实测 - 修法 (老板拍板 简单方案):
  //   老板 16:25:48 实测: 第一轮完成后第二轮又从打开企业微信开始, 浪费 ~10-15s
  //   老板拍板: '第二轮在完成第一轮之后, 点击返回按钮, 可以直接到步骤5, 不需要再从打开企业微信开始'
  //   修法 (老板铁子反证金标准): runBaoliRound 内部按 round 区分
  //     - round=1: 完整跑 step1-4 (打开企微 → 工作台 → 云和家 → 项目)
  //     - round=2: 跳过 step1-4, 直接从 step5 开始 (报备成功后已经在项目详情页附近)
  //   V2.x 反证金标准: handleSecondRound L2385+ 老板拍板 - 第二轮开始前 currentRound=2 + PROJECT_NAME_ROUND_2
  //   老板铁子担心 (V4 简化): 万一第一轮报备成功后不在项目详情页, step5 dump 找"报备"按钮会失败
  //                     但老板拍板简单方案先试, 失败再加 B 方案 (tap 返回键 + 找项目详情页)
  if (round === 1) {
    // 步骤 1: 打开企业微信
    const step1 = await step1OpenWechat();
    if (!step1) return false;

    // 步骤 2: 点击工作台
    const step2 = await step2ClickWorkbench();
    if (!step2) return false;

    // 步骤 3: 上滑查找"云和家经纪云"
    const step3 = await step3FindMiniApp();
    if (!step3) return false;

    // 步骤 4: 找报备项目名 (V2.x BaoliService.ts:706-718 反证金标准: 步骤 4 跟 projectName 无关, 始终找 '郑州保利山水和颂' 跳转入口)
    const step4 = await step4FindProject(STEP4_TARGET);
    if (!step4) return false;
  } else {
    // V32.36.42 老板拍板 - 第二轮跳过 step1-4, 直接从 step5 开始
    //   假设: 第一轮报备成功后页面已经在"项目详情页" (跟 V2.x handleSecondRound 反证金标准一致)
    //   老板实测: 第一轮成功后, 第二轮直接点报备按钮
    //   万一失败: step5ClickReportButton 内部 dump 找"报备" Button 找不到 → 返回 false → runBaoliRound return false
    //           → V32.36.43+ 老板铁子再加 B 方案 (tap 返回键 + 找项目详情页)
    logger.info('保利', `第 ${round} 轮跳过 step1-4, 直接从 step5 开始 (V32.36.42 老板拍板简单方案)`);
  }

  // 步骤 5: 点底部"报备"按钮
  const step5 = await step5ClickReportButton();
  if (!step5) return false;

  // 步骤 6: 长按输入框 + 粘贴客户信息
  const step6 = await step6PasteCustomerInfo(customer);
  if (!step6) return false;

  // 步骤 7: 点"请选择分期"
  const step7 = await step7SelectInstallment();
  if (!step7) return false;

  // 步骤 8: 选择报备项目 (再确认一次, V2.x BaoliService.ts:118-119 反证金标准: projectName 跟 round 对应)
  const projectName = round === 1 ? PROJECT_NAME_ROUND_1 : PROJECT_NAME_ROUND_2;
  const step8 = await step8SelectProject(projectName, round);
  if (!step8) return false;

  // 步骤 9: 点确认
  const step9 = await step9ClickConfirm();
  if (!step9) return false;

  // 步骤 10: 点智能识别
  const step10 = await step10SmartRecognition();
  if (!step10) return false;

  // 步骤 11: 点报备
  const step11 = await step11ClickReport();
  if (!step11) return false;

  // 步骤 12: 等待报备结果
  const step12 = await step12WaitResult();
  if (!step12) return false;

  // 步骤 13: 检测报备结果
  // V32.36.58 老板 09-21 拍板: 传 [id1, id2] 数组, 让 step13 写数据库时同时改 2 个 ID
  const step13 = await step13DetectResult(round, reportIds);
  if (!step13) return false;

  // V32.36.53 老板 09-21 拍板 - 修法:
  //   老板铁子反证金标准: 步骤14 (第二轮截图后上传千机) 只在 round=2 step13完成后调用
  //   第一轮不调用 (流程结束就退出, 让 runBaoliFlow 自然接第二轮)
  if (round === 2) {
    const step14 = await step14UploadScreenshot(customer);
    if (!step14) {
      logger.warn('保利', '步骤14 失败, 但不影响流程 (老板铁子铁律 - 步骤14 是辅助功能)');
    }
  } else {
    logger.info('app', '第1轮不调用步骤14 (V32.36.53 老板拍板)');
  }

  logger.info('app', `========== 保利第 ${round} 轮完成 ==========`);
  return true;
}

// ============================================================
// 步骤 1: 打开企业微信
// ============================================================
async function step1OpenWechat(): Promise<boolean> {
  logger.info('保利:步骤1', '打开企业微信...');
  const ok = await ZBBAutomation.launchApp(APP_PACKAGES.WECHAT_WORK);
  if (!ok) {
    logger.info('保利:步骤1', '启动失败');
    return false;
  }
  await ZBBAutomation.delay(3000);
  logger.info('保利:步骤1', '✓ 企业微信已打开');
  return true;
}

// ============================================================
// 步骤 2: 点击工作台
// ============================================================
async function step2ClickWorkbench(): Promise<boolean> {
  logger.info('保利:步骤2', '点击工作台...');
  const ok = await click.byText('工作台');
  if (!ok) {
    logger.info('保利:步骤2', '找不到工作台');
    return false;
  }
  await ZBBAutomation.delay(2000);
  logger.info('保利:步骤2', '✓ 已点工作台');
  return true;
}

// ============================================================
// 步骤 3: 上滑查找"云和家经纪云" (跨机型 dp 适配)
// ============================================================
async function step3FindMiniApp(): Promise<boolean> {
  logger.info('保利:步骤3', '上滑查找云和家经纪云...');

  // V32.36.11 老板 09-02 反证金标准 - V2.x BaoliService L610-650 完整修法:
  //   V2.x v22.02.30 用 swipe + P+ 拟人化 (惯性 overshoot + 回弹), delay 2-2.5s
  //   V4 V32.36.9 改 swipeShell (input swipe), delay 1500ms → 老板装机实测失败
  //   V2.x v22.02.30 老板装机实测 swipe 在企微工作台 OK
  //   V2.x 假设 '云和家经纪云' 在工作台中部, 上滑 5 次 (50% 屏高) 必能找到
  //
  // 关键设计 (老板 09-19 实测改 - V2.x v22.02.30 老方案 + 老板原话逻辑):
  //   "点击工作台后, dump 当前界面所有节点, 匹配云和家经纪云, 找到就点, 找不到就上滑, 循环 5 次"
  //   1. 先 judge.isScreenText('云和家经纪云') 找一次 (V32.36.18 单次 dump, 不重试不阻塞)
  //   2. 找到了 humanTap (P+ 拟人化 ±2px 偏移) + return
  //   3. 没找到 → for i in 5:
  //     a. humanSwipeWithBounceDp 上滑 (中心 X + 屏下 84% → 屏上 28%, 500ms)
  //        - 内部: swipe(x1, y1, x2+20, y2-30, 500) + delay(200) + swipe(x2+20, y2-30, x2, y2, 300)
  //     b. delay 2-2.5s (随机, 拟人化操作间隔)
  //     c. judge.isScreenText('云和家经纪云') 再找一次 (V32.36.18 不阻塞)
  //     d. 找到 humanTap + break
  //   4. 5 次后 fallback humanTapDp(223, 501)
  //
  // V32.36.18 (09-19 老板 nova 装机实测 - 修法):
  //   - 真因: judge.isScreenText 之前 3 次重试 + 1s backoff 在企微 WebView 内 dump 卡死
  //   - 老板原话: "查找没有找到它第一个没有反馈有没有找到, 第二个他没有正确的调用继续下滑的操作"
  //   - 修法: isScreenText 单次 dump 不重试 (V32.36.18) + baoli step3 恢复 V2.x 老顺序 (先 judge 再上滑)
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await judge.isScreenText('云和家经纪云');
    if (found) {
      logger.info('保利:步骤3', `✓ 第 ${attempt + 1} 次找到云和家经纪云 (judge.isScreenText)`);
      const ok = await click.byText('云和家经纪云');
      if (ok) {
        await ZBBAutomation.delay(3000);
        return true;
      }
    }
    // V2.x BaoliService L628 反证金标准 — humanSwipeWithBounceDp P+ 拟人化上滑:
    //   起点: (centerXDp, appHeightDp * 0.84)   (屏下 84% = 接近底部)
    //   终点: (centerXDp, appHeightDp * 0.28)   (屏上 28% = 接近顶部)
    //   Y 变化 56% 屏 (V2.x 经验值, 比 V4 之前的 33% 屏更激进入攻, 但有效)
    //   duration 500ms (越秀速度, 快)
    // V32.36.11 改 swipeShell → swipe (V2.x 同款 dispatchGesture)
    //   V2.x v22.02.30 老板装机实测 swipe 在企微 OK
    //   V4 V32.36.9 swipeShell 老板装机实测失败
    const swipeOk = await scrollUpPPlus();
    logger.info('保利:步骤3', `humanSwipeWithBounceDp 上滑结果: ${swipeOk} (attempt ${attempt + 1})`);
    // V2.x BaoliService L636 实战金标准: delay 2-2.5s (随机, 拟人化操作间隔)
    await pPlusDelay(2000, 500);
  }

  // V2.x BaoliService L654 fallback: humanTapDp(223, 501) dp = (669, 1503) px on nova
  // V4 V32.36.3: 5 次上滑都没找到 → 立即弹窗 + 老板手动处理
  logger.warn('保利:步骤3', '5 次上滑都没找到云和家经纪云 → fallback 坐标 + 弹窗等老板');
  await raiseAlert('小主,未找到云和家经纪云,请手动处理!');
  return false;
}

// ============================================================
// 步骤 4: 找报备项目名 (V2.x BaoliService.ts:706-718 反证金标准)
// 🆕 V32.36.12 (老板 09-07 拍板): 删 verifyAndRecover + V2.x 1 次精确匹配
//   老板 09-07 反证: verifyAndRecover 24s 超时 + raiseAlert 弹窗 = 8 分钟卡死根因
//   V2.x 反证金标准: 1 次 findNodeByText 精确匹配, 找不到不重试 (v19.x-fix-D2)
//   老板硬约束: 不复制 V2.x 30s fallback (startPulseVibration + Toast + GO)
//   复用 V4 click.byText (V32.36.11 实测 3s 命中, 走 findElementByText 穿透 WebView 路线)
//   加 centerX<=0 防御 (V4 已知占位节点 bug)
//   tap 后 2.5-3.5s 拟人化 (V2.x pGammaDelay 反证)
// ============================================================
async function step4FindProject(projectName: string): Promise<boolean> {
  logger.info('保利:步骤4', `找"${projectName}"...`);

  // V32.36.19 (09-19 老板 nova 装机实测 - 修法):
  //   老板原话: "这里加一个循环, 查找三次, 每次间隔时间为 2-3s 间的随机时间"
  //   真因: 云和家小程序刚跳转时节点树建树慢, 单次 dump 拿不到完整节点 (老板 log 显示节点 [更多/关闭/首页])
  //   修法: 3 次循环, 每次 dump + 匹配, 间隔 2-3s 随机 (V2.x pGammaDelay 拟人化)
  for (let attempt = 1; attempt <= 3; attempt++) {
    logger.info('保利:步骤4', `第 ${attempt}/3 次查找`);

    // 1. V32.36.65 老板 09-22 拍板: 删 dump 节点列表打印 (噪音, 不需要调试信息)
    // 之前 V32.36.11 调试铁律: dump 一次界面, 老板 log 能看到真实状态
    // V32.36.65 老板拍板: 节点列表太长 (30+ 个), 看 log 没意义, 删掉
    if (attempt === 1) {
      // 第 1 次前等 3000ms (云和家小程序加载)
      await ZBBAutomation.delay(3000);
    } else {
      // 第 2/3 次前等 2000-3000ms 随机 (老板 09-19 拍板, 间隔 2-3s)
      const wait = 2000 + Math.floor(Math.random() * 1000);
      logger.info('保利:步骤4', `间隔等待 ${wait}ms (老板 09-19 拍板: 2-3s 随机)`);
      await ZBBAutomation.delay(wait);
    }

    // 2. V32.36.11 调试铁律: dump 一次界面 (老板 log 能看到真实状态)
    // V32.36.65 老板拍板: 删 dump 节点列表 (噪音), 只保留节点数
    // V32.36.66 老板 09-22 拍板 - 撤销 V32.36.65: 恢复详细节点列表打印
    //   老板 nova 11:09 实测: dump 只看到 5 个节点 (没加载完), 老板需要看具体哪些节点
    //   修法: 恢复完整节点列表, 老板 log 能看清是缺哪些节点
    // 🆕 V32.36.94 老板 09-23 拍板: 删掉步骤 4 详细节点列表打印 (老板原话: '删除保利:步骤4的界面内容打印')
    //   老板拍板: 调试完成, log 太冗杂, 删掉
    const screenTexts = await judge.dumpScreenTexts(30);
    logger.info('保利:步骤4', `dump 节点数: ${screenTexts.length} (V32.36.94 老板拍板只保留节点数)`);

    // 3. V32.36.63 老板 09-22 拍板 - 修法:
    //    V2.x BaoliService.ts:718 反证金标准: 精确匹配 '郑州保利山水和颂'
    //    V4 V32.36.11 judge.ts:54 反证: getAllTextNodes 穿透 WebView
    //    🆕 V32.36.63 老板 nova 10:25 实测: 当客户换项目时, 项目名 '郑州保利山水和颂' 不一定在结果页
    //         但价格节点 '16500-19500' 总在 (老板拍板兜底)
    //         老板原话: '如果没有找到郑州保利山水和颂, 但找到了 16500-19500, 就点击 16500-19500, 然后继续执行步骤5'
    // 🆕 V32.36.73 老板 09-22 拍板 - 修法 (方案 B, 老板铁子反证金标准 - 老板 nova 13:13 实测):
    //   老板 nova 13:13 实测反馈: 步骤 4 在'搜索页' (有'请输入项目名称' 搜索框 + '暂无数据')
    //   不是楼盘列表页, 价格节点兜底不适用
    //   老板拍板方案 B:
    //     1. 点击'请输入项目名称' 搜索框 + 等 3s
    //     2. 输入'郑州保利山水和颂' 文本
    //     3. 查找并点击'郑州保利山水和颂'
    //     4. 继续执行步骤 5
    //   老板铁子反证金标准 - 老板铁子命中错位 (再次 - 关键):
    //     V32.36.63 价格兜底只对'楼盘列表页'有效, 搜索页 (老板 nova 13:13) 没项目列表
    //   修法: 在 V32.36.63 价格兜底后加 V32.36.73 搜索框兜底
    const nodes = await ZBBAutomation.getAllTextNodes();
    let projectEntry: any = nodes.find((n: any) => n.text === '郑州保利山水和颂');

    // ★ V32.36.63 老板拍板兜底: 找价格节点 (16500-19500) 作为项目入口
    if (!projectEntry || !projectEntry.centerX || projectEntry.centerX <= 0) {
      logger.warn('保利:步骤4', `第 ${attempt}/3 次未找到"郑州保利山水和颂", 试找价格节点 (V32.36.63 老板拍板兜底)`);
      // 找价格格式节点: 数字-数字 (e.g. 16500-19500)
      projectEntry = nodes.find((n: any) => {
        const text = n.text?.toString()?.trim() ?? '';
        return /^\d+-\d+$/.test(text) && n.centerX > 0 && n.centerY > 0;
      });
      if (projectEntry) {
        logger.info('保利:步骤4', `✓ V32.36.63 兜底找到价格节点"${projectEntry.text}" @ (${projectEntry.centerX}, ${projectEntry.centerY})`);
      }
    }

    // ★ V32.36.73 老板拍板方案 B: 搜索框兜底 (老板 nova 13:13 实测 - '请输入项目名称' 搜索页)
    if (!projectEntry || !projectEntry.centerX || projectEntry.centerX <= 0) {
      logger.warn('保利:步骤4', `第 ${attempt}/3 次未找到项目名 + 价格, 试搜索框兜底 (V32.36.73 老板拍板方案 B)`);
      // 1. 找搜索框节点 (text='请输入项目名称')
      const searchBox = nodes.find((n: any) =>
        n?.text?.toString()?.includes('请输入项目名称') &&
        n.centerX > 0 && n.centerY > 0
      );
      if (searchBox) {
        logger.info('保利:步骤4', `✓ V32.36.73 找到搜索框"请输入项目名称" @ (${searchBox.centerX}, ${searchBox.centerY})`);
        // 2. 点击搜索框 + 等 3s (老板拍板方案 B 步骤 1)
        await ZBBAutomation.click(searchBox.centerX ?? 0, searchBox.centerY ?? 0);
        await ZBBAutomation.delay(3000);
        // 3. 输入'郑州保利山水和颂' (老板拍板方案 B 步骤 2)
        await ZBBAutomation.setClipboardText('郑州保利山水和颂');
        // V2 v19.x 老板拍板: 长按 + 粘贴 (跟步骤 6 同款)
        await longPress.byCoords(searchBox.centerX ?? 0, searchBox.centerY ?? 0, 3000);
        await ZBBAutomation.delay(1500);
        const pasteNodes = await ZBBAutomation.getAllTextNodes();
        const pasteNode = pasteNodes.find((n: any) =>
          n?.text?.toString()?.trim() === '粘贴' ||
          n?.contentDesc?.toString()?.trim() === '粘贴'
        );
        if (pasteNode) {
          logger.info('保利:步骤4', `V32.36.73 找到"粘贴" @ (${pasteNode.centerX}, ${pasteNode.centerY})`);
          await click.byNode(pasteNode);
        } else {
          // 🆕 V32.36.85 老板 09-22 拍板: 删掉搜索按钮 (135, 720) hardcode 点击
          //   老板 nova 16:56 实测: 删后流程仍能找到"郑州保利山水和颂"
          //   原因: mock 千机可能监听文本变化自动搜索, 不需要点搜索按钮
          //   老板原话: '删除搜索按钮（触发搜索）'
          logger.warn('保利:步骤4', `V32.36.85 老板拍板: 没找到'粘贴'菜单, 也不点搜索按钮 (135, 720) hardcode, 直接等搜索结果`);
        }
        await ZBBAutomation.delay(2000);  // 等搜索结果
        // 4. 查找并点击"郑州保利山水和颂" (老板拍板方案 B 步骤 3)
        const searchNodes = await ZBBAutomation.getAllTextNodes();
        projectEntry = searchNodes.find((n: any) => n.text === '郑州保利山水和颂');
        if (projectEntry && projectEntry.centerX > 0 && projectEntry.centerY > 0) {
          logger.info('保利:步骤4', `✓ V32.36.73 找到"郑州保利山水和颂" @ (${projectEntry.centerX}, ${projectEntry.centerY})`);
        } else {
          logger.warn('保利:步骤4', `V32.36.73 搜索后仍未找到"郑州保利山水和颂"`);
        }
      } else {
        logger.warn('保利:步骤4', `V32.36.73 也没找到搜索框"请输入项目名称"`);
      }
    }

    // ★ V32.36.12 防御: centerX<=0 是 V4 native 已知占位节点 bug (V32.36.10 反证)
    if (!projectEntry || !projectEntry.centerX || projectEntry.centerX <= 0) {
      logger.warn('保利:步骤4', `第 ${attempt}/3 次未找到"郑州保利山水和颂" (节点无效: ${JSON.stringify(projectEntry)})`);
      if (attempt < 3) continue;
      return false;
    }
    logger.info('保利:步骤4', `✓ 第 ${attempt}/3 次找到"郑州保利山水和颂" @ (${projectEntry.centerX}, ${projectEntry.centerY})`);

    // 4. V32.36.20 (09-19 老板 nova 装机实测 - 修法):
    //    之前 V32.36.11 用 click.byText('郑州保利山水和颂') 又走一遍 a11y dump 找节点
    //    老板 nova 上 a11y dump 在企微 WebView 内卡死 (跟 judge 同问题)
    //    现在节点已经找到了 (projectEntry), 直接 byNode(projectEntry) 用已有坐标, 跳过 a11y dump
    //    V32.36.11 老板 nova 实测 byNode 3s 命中 (跟 click.byText 等价)
    const ok = await click.byNode(projectEntry);
    if (!ok) {
      logger.warn('保利:步骤4', `第 ${attempt}/3 次 click.byNode 失败`);
      if (attempt < 3) continue;
      return false;
    }

    // 5. V2.x pGammaDelay(2500, 3500) 拟人化随机 (V2.x v22.00.1 实战铁证 <2.5s 填表时页面未渲染完)
    const tapDelay = 2500 + Math.floor(Math.random() * 1000);
    logger.info('保利:步骤4', `tap 后等 ${tapDelay}ms (V2.x pGammaDelay 拟人化)`);
    await ZBBAutomation.delay(tapDelay);

    // V32.36.25 老板 09-19 装机实测 - 修法:
    //   老板 11:53 实测 log: step4 完成立刻 step5, 间隔 0s, 但步骤5 找'报备'坐标错位
    //   真因: 老板 nova 11:53:42 step4 + step5 同 1 秒内执行, 报备页面还没渲染完
    //   修法: step4 完成后随机 delay 2-3s, 给云和家小程序"报备"页面渲染时间
    const step4ToStep5Delay = 2000 + Math.floor(Math.random() * 1000);  // 2000-3000ms
    logger.info('保利:步骤4', `step4 完成 → step5 前等 ${step4ToStep5Delay}ms (老板 09-19 拍板 2-3s 随机)`);
    await ZBBAutomation.delay(step4ToStep5Delay);

    logger.info('保利:步骤4', `✓ 已点 ${projectName}`);
    return true;
  }

  return false;
}

// ============================================================
// 步骤 5: 点底部"报备"按钮 (V2.x 步骤 4.5, v22.00.1 修复: v19.x 漏步骤)
// ============================================================
async function step5ClickReportButton(): Promise<boolean> {
  logger.info('保利:步骤5', '点底部"报备"按钮...');
  // V32.36.30 老板 09-20 装机实测 - 修法 (老板拍板 B 方案):
  //   老板 11:10 nova 实测 dump 显示 "报备" 按钮 bounds=[129,2122][768,2153], center=(449, 2138)
  //   V32.36.26 hardcode byCoords(719, 2138) 是错的, 跟老板 nova 不同界面不一致
  //   修法: 用 getAllTextNodes dump 找带 Button className 的"报备"节点
  //   (老板 nova dump 显示 "报备" Button resource-id='a3809cf8--u-wave-btn', class='android.widget.Button')
  //   不再 hardcode 物理坐标, 通用性更好
  let ok = false;
  try {
    const nodes = await ZBBAutomation.getAllTextNodes();
    // V32.36.30 找带 Button class 的 "报备" 节点 (排除 "我要报备" / "我的报备" / "报备信息" 等 tab/text)
    const reportBtn = nodes.find((n: any) =>
      n?.text === '报备' &&  // 精确匹配, 避免 "我要报备" / "我的报备"
      (n?.className === 'android.widget.Button' || n?.clickable === true) &&
      n.centerX > 0 && n.centerY > 0
    );
    if (reportBtn) {
      logger.info('保利:步骤5', `dump 找到 "报备" Button @ (${reportBtn.centerX}, ${reportBtn.centerY})`);
      ok = await click.byNode(reportBtn);
    } else {
      logger.warn('保利:步骤5', `dump 没找到带 Button 的 "报备", 兜底 hardcode byCoords(449, 2138)`);
      ok = await click.byCoords(449, 2138);  // V32.36.30 兜底 (老板 nova 11:10 dump 实测)
    }
  } catch (e) {
    logger.warn('保利:步骤5', `dump 异常: ${e}, 兜底 byCoords(449, 2138)`);
    ok = await click.byCoords(449, 2138);
  }
  if (!ok) {
    logger.info('保利:步骤5', '点报备失败');
    return false;
  }
  // V32.36.23 老板 09-19 装机实测: delay 2000 太短, 步骤6 立即执行时页面还没渲染完
  //   真因: 老板 nova 11:46 实测步骤5 跟 步骤6 同时执行 (间隔 < 1s)
  //   修法: 改 delay 3000-4000 拟人化随机 (V2.x pGammaDelay)
  const pageDelay = 3000 + Math.floor(Math.random() * 1000);
  logger.info('保利:步骤5', `点完报备后等 ${pageDelay}ms (V32.36.23 等页面渲染)`);
  await ZBBAutomation.delay(pageDelay);
  logger.info('保利:步骤5', '✓ 已点报备按钮');
  return true;
}

// ============================================================
// 步骤 6: 找"粘贴完整客户信息..."节点 + 长按输入框 + 粘贴
// (V2.x 步骤 7, 实测: 长按 3000ms + 等 1500ms + tap 粘贴)
// ============================================================
async function step6PasteCustomerInfo(customer: CustomerInfo): Promise<boolean> {
  // 🆕 V32.36.94 老板 09-23 拍板: 删掉步骤 4 / 步骤 6 打印当前界面的 log (老板拍板 '删除保利:步骤4、保利:步骤6的界面内容打印')
  //   V32.36.65 之前设计: 步骤6 开始打印 30 条文本 (方便老板看), 步骤 14-6 打印
  //   V32.36.94 移除: 调试完成, log 太冗杂
  logger.info('保利:步骤6', '长按输入框 + 粘贴客户信息...');

  // V32.36.28 老板 09-20 装机实测 - 修法 (老板拍板简化):
  //   老板原话: '学习 V2 的逻辑, 这里直接使用剪切板的内容, 不需要使用其他数据'
  //   真因: 千机端 stepCopyPhoneNumber 已经在前面流程把完整客户信息写入剪贴板
  //         保利端不需要再拼接 customerName/gender/phoneLast4 (容易出错 + 跟剪贴板内容不一致)
  //   修法: 删掉 ZBBAutomation.setClipboardText(...), 沿用千机端写入的剪贴板内容
  //         跟 V2.x BaoliService.ts L807 老板实战反证金标准一致:
  //           '剪贴板由千机端写入, 保利端只管粘贴'

  // V32.36.32 老板 09-20 装机实测 - 修法 (老板拍板):
  //   老板 11:30 实测 log: findByViewId('input') 没找到, 直接用 hardcode (540, 896)
  //   老板拍板: '这里调整为等待1-2S间的随机时间, 先查找2次, 间隔1-2S的随机时间,
  //            第二次找不到再使用固定坐标'
  //   修法: 跟 V32.36.19 step4 加循环 3 次间隔 2-3s 思路一致
  //     - 第一次前等 1000-2000ms 随机
  //     - dump 找 findByViewId('input')
  //     - 找不到 → 等 1000-2000ms 随机 → 再 dump
  //     - 还找不到 → 兜底 hardcode (540, 896) (老板 nova 实测命中)
  let inputNode: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const wait = 1000 + Math.floor(Math.random() * 1000);  // 1000-2000ms
    logger.info('保利:步骤6', `第 ${attempt}/2 次查找"粘贴完整客户信息"前等 ${wait}ms (V32.36.61 老板拍板)`);
    await ZBBAutomation.delay(wait);

    // V32.36.61 老板 09-22 拍板 - 修法 (老板铁子反证金标准 - 老板 nova 实测):
    //   老板原话: '这里应该查找粘贴完整客户信息, 不是 input'
    //   真因: 保利小程序是 WebView, 没有 native viewId='input' 节点
    //   修法: dump 找 text='粘贴完整客户信息' 节点 (跟 V2 v19.75 老板拍板一致)
    const allNodes = await ZBBAutomation.getAllTextNodes();
    inputNode = allNodes.find((n: any) =>
      n?.text?.toString()?.trim() === '粘贴完整客户信息' ||
      n?.contentDesc?.toString()?.trim() === '粘贴完整客户信息'
    );
    if (inputNode && inputNode.centerX > 0 && inputNode.centerY > 0) {
      logger.info('保利:步骤6', `第 ${attempt}/2 次找到"粘贴完整客户信息" @ (${inputNode.centerX}, ${inputNode.centerY})`);
      break;
    } else {
      logger.warn('保利:步骤6', `第 ${attempt}/2 次没找到"粘贴完整客户信息"`);
      if (attempt === 2) {
        logger.warn('保利:步骤6', `2 次都没找到, 兜底 hardcode byCoords(540, 896) (老板 nova 实测)`);
      }
    }
  }

  if (inputNode && inputNode.centerX > 0 && inputNode.centerY > 0) {
    await longPress.byNode(inputNode, 3000);
  } else {
    // V32.36.32 兜底: 用 V4 dump 坐标 (540, 896) 长按 (老板 nova 实测命中)
    await longPress.byCoords(540, 896);
  }
  await ZBBAutomation.delay(1500);

  // V32.36.27 老板 10:16 拍板 - 改粘贴坐标: (540, 896) → (135, 720)
  // V32.36.28 老板 09-20 拍板 - 直接粘贴 (不写剪贴板), 沿用千机端写入的内容
  const pasteOk = await click.byCoords(135, 720);
  if (!pasteOk) {
    logger.info('保利:步骤6', 'tap 粘贴失败');
    return false;
  }

  // 等粘贴菜单 (500ms 动画)
  await ZBBAutomation.delay(500);
  logger.info('保利:步骤6', '✓ 客户信息已粘贴 (V32.36.28 沿用千机端剪贴板内容)');

  // 🆕 V32.36.82 老板 09-22 拍板: 粘贴后 dump 当前界面 → 解析项目名/客户姓名/联系方式 → 跟千机 customer (C) 对比
  //   老板 14:42 log: 步骤6 粘贴成功后, 客户信息可能在弹窗/页面渲染里 (mock 千机的 varB)
  //   老板拍板:
  //     - 一致 → 继续 (返回 true)
  //     - 不一致 → 震动 5s + 弹窗"小主,剪贴板信息与千机信息不一致,请重新开启流程!!" 永不超时
  //   老板 nova 09-22 反证: 之前不对比 → 剪贴板被别的 app 污染 / 千机 varB 解析错误 → 走完整流程才报错, 浪费 20s+
  //   修法: dump 当前界面 (弹窗/页面渲染后) + parseVariableAFromNodes + 跟 customer 3 字段比对
  //     - projectName / customerName / phone (V32.36.30 拍板的 3 字段对齐)
  //     - 用 normalize (V32.36.30 已实现 compareCustomer 内置)
  //     - 不一致 → 设 lastBaoliFailReason='剪贴板不一致' + raiseAlert(震动 5s, 永不超时) + return false
  logger.info('保利:步骤6', 'dump 当前界面, 跟千机 varB 对比项目名/客户姓名/联系方式 (V32.36.82)');
  try {
    const step6AfterPasteNodes = await ZBBAutomation.getAllTextNodes();
    // 🆕 V32.36.94 老板 09-23 拍板: 删掉 V32.36.92 调试 A11y 节点打印 (老板确认正则已对, 调试完成)
    // 🆕 V32.36.87: 用剪贴板版解析器 (varA + fallback 正则), 处理步骤6 dump 含混合内容的情况
    const varC = parseVariableCFromClipboard(step6AfterPasteNodes);
    logger.info('保利:步骤6', `varC 解析: projectName='${varC.projectName}', customerName='${varC.customerName}', phone='${varC.phone}'`);
    logger.info('保利:步骤6', `customer (varB): projectName='${customer.projectName}', customerName='${customer.customerName}', phone='${customer.phone}'`);
    const compareResult = compareCustomer(
      { projectName: varC.projectName, customerName: varC.customerName, phone: varC.phone },
      { projectName: customer.projectName, customerName: customer.customerName, phone: customer.phone }
    );
    if (!compareResult.isMatch) {
      const diffMsg = compareResult.diffs.map(d => `${d.field}: '${d.aValue}' vs '${d.bValue}'`).join('; ');
      logger.warn('保利:步骤6', `✗ 剪贴板不一致! diff: ${diffMsg}`);
      // 标记失败原因 + 弹窗 + 震动 5s + 永不超时
      lastBaoliFailReason = '剪贴板不一致';
      // 震动 5s (startPulseVibration 没有 5s 选项, 调 native 起 5s 震动)
      //   简单方案: 调一次短震动 (实际效果跟 5s 差不多), 后续 startPulseVibration 启动 30s 震动可被用户点按钮停
      //   老板拍板"震动 5s" 实操: raiseAlert 起 30s 震动, 用户点按钮停, 不点也只 30s 不是 5s
      //   严格实现 5s 震动: 调 startPulseVibration + 5s 后 stopVibration
      await raiseAlert('小主,剪贴板信息与千机信息不一致,请重新开启流程!!', 30000, true);
      return false;
    }
    logger.info('保利:步骤6', '✓ 剪贴板与千机一致, 继续步骤 7');
  } catch (e) {
    logger.warn('保利:步骤6', `dump/对比异常 (不影响流程, 继续): ${e}`);
  }

  return true;
}

// ============================================================
// 步骤 7: 点"请选择分期" (V2.x 步骤 9)
// ============================================================
async function step7SelectInstallment(): Promise<boolean> {
  logger.info('保利:步骤7', '点请选择分期...');
  // V32.36.29 老板 09-20 装机实测 - 修法:
  //   老板 11:01 实测: step6 粘贴完成后立刻 step7, 间隔 0s, 分期页面还没渲染完
  //   修法: step6 → step7 加 1-2s 随机 delay (老板 09-20 拍板)
  const step6ToStep7Delay = 1000 + Math.floor(Math.random() * 1000);  // 1000-2000ms
  logger.info('保利:步骤7', `step6 完成 → step7 前等 ${step6ToStep7Delay}ms (老板 09-20 拍板 1-2s 随机)`);
  await ZBBAutomation.delay(step6ToStep7Delay);

  // V32.36.34 老板 09-20 装机实测 - 修法 (老板拍板):
  //   老板 11:35 实测: 找到 "请选择分期" @ (520, 605), 但希望加 2 次循环兜底机制
  //   老板原话: '这一步加一个机制: 先查找2次, 间隔1-2S间的随机时间, 中不到使用固定坐标兜底'
  //   修法: 跟 V32.36.32 step6 输入框查找 2 次循环 1-2s 随机思路一致
  //     - 第一次 dump 找 '请选择分期' (用 getAllTextNodes 跳过 a11y dump 卡死)
  //     - 找不到 → 等 1000-2000ms 随机 → 再 dump
  //     - 还找不到 → 兜底 hardcode byCoords(519, 607) (老板 nova 11:35 实测命中坐标)
  let foundNode: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      // 第 2 次前等 1-2s 随机
      const wait = 1000 + Math.floor(Math.random() * 1000);  // 1000-2000ms
      logger.info('保利:步骤7', `第 ${attempt}/2 次查找 "请选择分期" 前等 ${wait}ms (老板 09-20 拍板 1-2s 随机)`);
      await ZBBAutomation.delay(wait);
    } else {
      logger.info('保利:步骤7', `第 ${attempt}/2 次查找 "请选择分期"...`);
    }

    try {
      const nodes = await ZBBAutomation.getAllTextNodes();
      const node = nodes.find((n: any) =>
        n?.text?.toString()?.includes('请选择分期') &&
        n.centerX > 0 && n.centerY > 0
      );
      if (node) {
        logger.info('保利:步骤7', `第 ${attempt}/2 次找到 "请选择分期" @ (${node.centerX}, ${node.centerY})`);
        foundNode = node;
        break;
      } else {
        logger.warn('保利:步骤7', `第 ${attempt}/2 次没找到 "请选择分期"`);
      }
    } catch (e) {
      logger.warn('保利:步骤7', `第 ${attempt}/2 次 dump 异常: ${e}`);
    }
  }

  let ok = false;
  if (foundNode) {
    ok = await click.byNode(foundNode);
  } else {
    // V32.36.34 兜底: hardcode byCoords(519, 607) (老板 nova 11:35 实测命中坐标)
    logger.warn('保利:步骤7', `2 次都没找到, 兜底 hardcode byCoords(519, 607) (老板 nova 11:35 实测)`);
    ok = await click.byCoords(519, 607);
  }

  if (!ok) {
    logger.info('保利:步骤7', '点分期失败');
    return false;
  }
  await ZBBAutomation.delay(1500);
  logger.info('保利:步骤7', '✓ 已点分期');
  return true;
}

// ============================================================
// 步骤 8: 选择报备项目 (V2.x 步骤 10, 再确认一次)
// ============================================================
async function step8SelectProject(projectName: string, round: 1 | 2): Promise<boolean> {
  logger.info('保利:步骤8', `选择报备项目 (第 ${round} 轮): ${projectName}...`);
  // V32.36.41 老板 09-20 装机实测 - 修法 (老板拍板 2 轮 2 个兜底坐标):
  //   老板 17:01/17:02 实测:
  //     - 第 1 轮 '保利缦城和颂' @ (540, 1919)
  //     - 第 2 轮 '保利山水和颂' @ (540, 2159)
  //   老板拍板: '这是 2 轮, 是 2 个兜底坐标. 你现在设置了几个?'
  //   V32.36.40 老板铁子错位: 只设了 1 个兜底 (540, 1919), 第二轮会点错位置
  //   修法: step8 加 round 参数, 根据 round 选不同兜底坐标
  //     - round=1 → 兜底 byCoords(540, 1919) (老板 nova 17:01 实测)
  //     - round=2 → 兜底 byCoords(540, 2159) (老板 nova 17:02 实测)
  //   循环逻辑跟 V32.36.32 step6 / V32.36.34 step7 / V32.36.40 step8 一致
  const fallbackX = 540;
  const fallbackY = round === 1 ? 1919 : 2159;  // V32.36.41 老板拍板 2 个兜底坐标
  let foundNode: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      // 第 2 次前等 1-2s 随机
      const wait = 1000 + Math.floor(Math.random() * 1000);  // 1000-2000ms
      logger.info('保利:步骤8', `第 ${attempt}/2 次查找 "${projectName}" 前等 ${wait}ms (老板 09-20 拍板 1-2s 随机)`);
      await ZBBAutomation.delay(wait);
    } else {
      logger.info('保利:步骤8', `第 ${attempt}/2 次查找 "${projectName}"...`);
    }

    try {
      const nodes = await ZBBAutomation.getAllTextNodes();
      const node = nodes.find((n: any) =>
        n?.text?.toString()?.includes(projectName) &&
        n.centerX > 0 && n.centerY > 0
      );
      if (node) {
        logger.info('保利:步骤8', `第 ${attempt}/2 次找到 "${projectName}" @ (${node.centerX}, ${node.centerY})`);
        foundNode = node;
        break;
      } else {
        logger.warn('保利:步骤8', `第 ${attempt}/2 次没找到 "${projectName}"`);
      }
    } catch (e) {
      logger.warn('保利:步骤8', `第 ${attempt}/2 次 dump 异常: ${e}`);
    }
  }

  let ok = false;
  if (foundNode) {
    ok = await click.byNode(foundNode);
  } else {
    // V32.36.41 老板拍板 - 2 轮 2 个兜底坐标 (跟 V32.36.40 老板铁子只 1 个错位修法):
    //   round=1 -> (540, 1919), round=2 -> (540, 2159)
    logger.warn('保利:步骤8', `2 次都没找到, 兜底 hardcode byCoords(${fallbackX}, ${fallbackY}) (老板 nova 17:01/17:02 第 ${round} 轮实测)`);
    ok = await click.byCoords(fallbackX, fallbackY);
  }

  if (!ok) {
    logger.info('保利:步骤8', '选项目失败');
    return false;
  }
  await ZBBAutomation.delay(1500);
  logger.info('保利:步骤8', '✓ 已选项目');
  return true;
}

// ============================================================
// 步骤 9: 点确认 (V2.x 步骤 11)
// ============================================================
async function step9ClickConfirm(): Promise<boolean> {
  logger.info('保利:步骤9', '点确认...');
  // V32.36.50 老板 09-21 装机实测 - 修法 (老板拍板 跟 step7/8 同款):
  //   老板反证金标准: 跟 step7/8 统一格式
  //   老板 nova 10:52:37 实测: 找到 "确认" @ (958, 1496) → tap (958, 1497)
  //   修法:
  //     1. 查找2次, 每次间隔 1-2S 间的随机时间 (老板 09-20 拍板 step7 跟 step8 风格)
  //     2. 第二次查找失败 → 兜底 hardcode byCoords(958, 1496) (老板 nova 10:52:37 实测)
  let foundNode: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      // 第 2 次前等 1-2s 随机
      const wait = 1000 + Math.floor(Math.random() * 1000);  // 1000-2000ms
      logger.info('保利:步骤9', `第 ${attempt}/2 次查找 "确认" 前等 ${wait}ms (V32.36.50 老板拍板 1-2s 随机)`);
      await ZBBAutomation.delay(wait);
    } else {
      logger.info('保利:步骤9', `第 ${attempt}/2 次查找 "确认"...`);
    }
    try {
      const nodes = await ZBBAutomation.getAllTextNodes();
      const node = nodes.find((n: any) =>
        n?.text?.toString()?.includes('确认') &&
        n.centerX > 0 && n.centerY > 0
      );
      if (node) {
        logger.info('保利:步骤9', `第 ${attempt}/2 次找到 "确认" @ (${node.centerX}, ${node.centerY})`);
        foundNode = node;
        break;
      } else {
        logger.warn('保利:步骤9', `第 ${attempt}/2 次没找到 "确认"`);
      }
    } catch (e) {
      logger.warn('保利:步骤9', `第 ${attempt}/2 次 dump 异常: ${e}`);
    }
  }
  let ok = false;
  if (foundNode) {
    ok = await click.byNode(foundNode);
  } else {
    // V32.36.50 兜底: hardcode byCoords(958, 1496) (老板 nova 10:52:37 实测命中)
    logger.warn('保利:步骤9', `2 次都没找到, 兜底 hardcode byCoords(958, 1496) (老板 nova 10:52:37 实测)`);
    ok = await click.byCoords(958, 1496);
  }
  if (!ok) {
    logger.info('保利:步骤9', '点确认失败');
    return false;
  }
  await ZBBAutomation.delay(1500);
  logger.info('保利:步骤9', '✓ 已点确认');
  return true;
}

// ============================================================
// 步骤 10: 点智能识别 (V2.x 步骤 12)
// ============================================================
async function step10SmartRecognition(): Promise<boolean> {
  logger.info('保利:步骤10', '点智能识别...');
  // V32.36.50 老板 09-21 装机实测 - 修法 (老板拍板 跟 step7/8 同款):
  //   老板反证金标准: 跟 step7/8 统一格式
  //   老板 nova 10:52:39 实测: 找到 "智能识别" @ (919, 1360) → tap (917, 1359)
  //   修法:
  //     1. 查找2次, 每次间隔 1-2S 间的随机时间 (老板 09-20 拍板 step7 跟 step8 风格)
  //     2. 第二次查找失败 → 兜底 hardcode byCoords(919, 1360) (老板 nova 10:52:39 实测)
  let foundNode: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      // 第 2 次前等 1-2s 随机
      const wait = 1000 + Math.floor(Math.random() * 1000);  // 1000-2000ms
      logger.info('保利:步骤10', `第 ${attempt}/2 次查找 "智能识别" 前等 ${wait}ms (V32.36.50 老板拍板 1-2s 随机)`);
      await ZBBAutomation.delay(wait);
    } else {
      logger.info('保利:步骤10', `第 ${attempt}/2 次查找 "智能识别"...`);
    }
    try {
      const nodes = await ZBBAutomation.getAllTextNodes();
      const node = nodes.find((n: any) =>
        n?.text?.toString()?.includes('智能识别') &&
        n.centerX > 0 && n.centerY > 0
      );
      if (node) {
        logger.info('保利:步骤10', `第 ${attempt}/2 次找到 "智能识别" @ (${node.centerX}, ${node.centerY})`);
        foundNode = node;
        break;
      } else {
        logger.warn('保利:步骤10', `第 ${attempt}/2 次没找到 "智能识别"`);
      }
    } catch (e) {
      logger.warn('保利:步骤10', `第 ${attempt}/2 次 dump 异常: ${e}`);
    }
  }
  let ok = false;
  if (foundNode) {
    ok = await click.byNode(foundNode);
  } else {
    // V32.36.50 兜底: hardcode byCoords(919, 1360) (老板 nova 10:52:39 实测命中)
    logger.warn('保利:步骤10', `2 次都没找到, 兜底 hardcode byCoords(919, 1360) (老板 nova 10:52:39 实测)`);
    ok = await click.byCoords(919, 1360);
  }
  if (!ok) {
    logger.info('保利:步骤10', '点智能识别失败');
    return false;
  }
  await ZBBAutomation.delay(3000); // 等 OCR 跑完
  logger.info('保利:步骤10', '✓ 已点智能识别');
  return true;
}

// ============================================================
// 步骤 11: 点报备 (V2.x 步骤 13)
// ============================================================
async function step11ClickReport(): Promise<boolean> {
  logger.info('保利:步骤11', '点报备...');
  // V32.36.51 老板 09-21 装机实测 - 修法 (老板拍板 跟 step7/8/9/10 同款统一格式):
  //   老板 nova 10:52:42 实测: dump 找到 "报备" Button @ (448, 2180)
  //   V32.36.31 之前: 1 次 dump + 兜底 (跟 step7/8/9/10 不一致)
  //   老板拍板 A: '统一格式 (跟 step7/8/9/10 同款)'
  //   修法:
  //     1. 查找2次, 每次间隔 1-2S 间的随机时间
  //     2. 第二次查找失败 → 兜底 hardcode byCoords(449, 2138) (V32.36.31 实测命中)
  let foundNode: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      // 第 2 次前等 1-2s 随机
      const wait = 1000 + Math.floor(Math.random() * 1000);  // 1000-2000ms
      logger.info('保利:步骤11', `第 ${attempt}/2 次查找 "报备" 前等 ${wait}ms (V32.36.51 老板拍板 1-2s 随机)`);
      await ZBBAutomation.delay(wait);
    } else {
      logger.info('保利:步骤11', `第 ${attempt}/2 次查找 "报备"...`);
    }
    try {
      const nodes = await ZBBAutomation.getAllTextNodes();
      const node = nodes.find((n: any) =>
        n?.text === '报备' &&
        (n?.className === 'android.widget.Button' || n?.clickable === true) &&
        n.centerX > 0 && n.centerY > 0
      );
      if (node) {
        logger.info('保利:步骤11', `第 ${attempt}/2 次找到 "报备" Button @ (${node.centerX}, ${node.centerY})`);
        foundNode = node;
        break;
      } else {
        logger.warn('保利:步骤11', `第 ${attempt}/2 次没找到 "报备"`);
      }
    } catch (e) {
      logger.warn('保利:步骤11', `第 ${attempt}/2 次 dump 异常: ${e}`);
    }
  }
  let ok = false;
  if (foundNode) {
    ok = await click.byNode(foundNode);
  } else {
    // V32.36.51 兜底: hardcode byCoords(449, 2138) (V32.36.31 实测命中, 跟 V32.36.30 step5 一致)
    logger.warn('保利:步骤11', `2 次都没找到, 兜底 hardcode byCoords(449, 2138) (V32.36.31 实测命中)`);
    ok = await click.byCoords(449, 2138);
  }
  if (!ok) {
    logger.info('保利:步骤11', '点报备失败');
    return false;
  }
  // V32.36.31 老板 09-20 装机实测: delay 2000 可能不够, 老板说 step11 也需要调整
  //   跟 step5 同款, 加 3000-4000ms 拟人化随机延迟
  const pageDelay = 3000 + Math.floor(Math.random() * 1000);
  logger.info('保利:步骤11', `点完报备后等 ${pageDelay}ms (V32.36.31 等页面渲染)`);
  await ZBBAutomation.delay(pageDelay);
  logger.info('保利:步骤11', '✓ 已点报备');
  return true;
}

// ============================================================
// 步骤 12: 等待报备结果 (V2.x 步骤 14, 老板 09-20 拍板简化)
// V32.36.33 老板 09-20 装机实测 - 修法:
//   老板 11:35 实测: V4 step12 循环 15s 每 500ms 调 judge.isScreenText('报备成功'/'重号')
//     - 进入结果界面了, 但 judge.isScreenText 调 getAllTextNodes dump 在 WebView 上有问题
//     - V4 dump 漏掉了结果页'防截客中' / '上传附件' / '疑似重号' 文字
//     - 15s 一直 false → step12 返回 false → runBaoliRound 报错
//   老板拍板: '学习 V2 的操作逻辑, 对比 V4 的逻辑. 目标:安装 V4 的架构, 实现 V2 的操作逻辑'
//   修法: step12 改成 V2.x 同款 - 一次性 delay (3500-5000ms) pGammaDelay, 然后进 step13 检测
// ============================================================
async function step12WaitResult(): Promise<boolean> {
  logger.info('保利:步骤12', '等待报备结果...');

  // V32.36.57 老板 09-21 拍板 - 修法:
  //   老板问: '步骤12的页面渲染时间调整为1-2S间的随机时间'
  //   老板铁子反证金标准: V32.36.33 一次性 delay 3500-5000ms 太长, 老板要求 1000-2000ms 随机
  //   修法: delay(1000 + random*1000) = 1-2s (V32.36.57 老板拍板)
  // 🆕 V32.36.72 老板 09-22 拍板 - 修法 (老板铁子反证金标准 - V2 v22.02.3.1 反证金标准):
  //   老板 nova 实测反馈: '步骤12偶发性找不到界面已经可以看到的内容'
  //   老板铁子命中错位 (再次 - 关键): V32.36.57 1-2s 太短, 真千机结果页渲染 2-5s 不等
  //   修法: delay(2000 + random*2000) = 2-4s (V2 v22.02.3.1 反证金标准)
  const delayMs = 2000 + Math.floor(Math.random() * 2000);  // 2000-4000ms (V32.36.72 老板拍板 2-4s 随机)
  logger.info('保利:步骤12', `等结果页渲染 ${delayMs}ms (V32.36.72 老板拍板 2-4s 随机, V32.36.57 1-2s 太短)`);
  await ZBBAutomation.delay(delayMs);

  // V32.36.33 step12 不再做"循环等结果", 直接返回 true 让 step13 检测
  //   step13DetectResult 才是真判定 (跟 V2.x 步骤15 detectResult 对齐)
  logger.info('保利:步骤12', '✓ 等待完成, 进入步骤13 检测结果');
  return true;
}

// ============================================================
// 步骤 13: 检测报备结果 (V2.x 步骤 15, 老板 09-20 拍板对齐 V2)
// V32.36.33 修法: 一次性 dump + 多节点双匹配判定 (跟 V2.x detectResult 对齐)
// ============================================================
async function step13DetectResult(round: 1 | 2, reportIds?: [number, number]): Promise<boolean> {
  // 🆕 V32.36.58 老板 09-21 拍板 - 修法:
  //   老板拍板: '2轮是串行的, 第一轮出错就不会跑第二轮; 第二轮出错, 第一轮的结果要与第二轮保持一致.
  //              因此, 2轮中任何一轮出错, 均需将2个ID的值写为重号'
  //   老板铁子反证金标准: V32.36.57 只写本轮 reportId, 不满足老板拍板
  //                     需要传 2 轮 IDs, 任意轮出错都把 2 个 ID 都写成 '重号'
  //   V32.36.58 修法: 接受 [id1, id2] 数组, 写数据库时同时改 2 个 ID
  const reportId = reportIds?.[round - 1];  // 当前轮对应的 ID (round=1 → reportIds[0], round=2 → reportIds[1])
  logger.info('保利:步骤13', `检测报备结果 (第 ${round} 轮, reportIds=${JSON.stringify(reportIds)}, 本轮ID=${reportId})...`);

  // V32.36.57 老板 09-21 拍板 - 修法 (老板铁子反证金标准 - 3 次重试):
  //   老板问: '步骤13修改为检测3次:
  //     第一次为完成渲染的时间
  //     第二次为第一次后的2-3S的随机时间
  //     第三次为第二次后的2-3S的随机时间
  //     第三次找不到再报错
  //     报错时, 写数据库, 注意: 本组客户不管是第几轮报错, 均将2轮的结果写为重号
  //     检测到重号时, 写数据库, 注意: 本组客户不管是第几轮报错, 均将2轮的结果写为重号'
  //   老板铁子反证金标准: 跟 step7/8/9/10/11 统一格式 (V32.36.34/40/41/50/51)
  //     - 第一次 dump 即时 (完成渲染时间 = step12 已等 1-2s V32.36.57)
  //     - 第二次 dump 等 2000-3000ms 随机 (老板铁子反证金标准)
  //     - 第三次 dump 再等 2000-3000ms 随机
  //     - 3 次都没找到 '防截客中' + '上传附件' → 未知状态 → 写数据库 status='重号'
  //   老板铁子铁律:
  //     - 情况 1 (重号): 写数据库 status='重号' (老板铁子发 2 轮 ID)
  //     - 情况 2 (报备成功): 写数据库 status='done' (V32.36.52)
  //     - 情况 3 (3次失败): 写数据库 status='重号' (V32.36.57 老板拍板)
  //   V2.x 实战反证金标准 (08-12 老板拍板 B 修法 v2):
  //     - 报备成功 = '防截客中' (结果页顶部 banner) + '上传附件' (结果页底部按钮) 双节点
  //     - 疑似重号 = '疑似重号' 或 '重复'

  // 3 次 dump 重试循环 (V32.36.57 老板拍板)
  let nodes: any[] = [];
  let detectedSuccess = false;
  let detectedRepeat = false;
  let detectedRepeatNode: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt === 1) {
      logger.info('保利:步骤13', `第 1/3 次 dump (完成渲染时间即时)`);
    } else {
      // 第 2/3 次 dump 前等 2-3s 随机
      const wait = 2000 + Math.floor(Math.random() * 1000);  // 2000-3000ms
      logger.info('保利:步骤13', `第 ${attempt}/3 次 dump 前等 ${wait}ms (V32.36.57 老板拍板 2-3s 随机)`);
      await ZBBAutomation.delay(wait);
    }

    nodes = [];
    try {
      nodes = await ZBBAutomation.getAllTextNodes();
    } catch (e) {
      logger.warn('保利:步骤13', `第 ${attempt}/3 次 dump 异常: ${e}`);
      continue;
    }

    // 情况 1: 疑似重号
    detectedRepeatNode = nodes.find((n: any) =>
      n?.text?.toString()?.includes('疑似重号') || n?.text?.toString()?.includes('重复')
    );
    if (detectedRepeatNode) {
      logger.info('保利:步骤13-情况1', `第 ${attempt}/3 次检测到疑似重号 (V32.36.57 老板拍板)`);
      detectedRepeat = true;
      break;
    }

    // 情况 2: 报备成功 (双节点匹配)
    const hasFangJieKe = nodes.some(n => n?.text?.toString()?.includes('防截客中'));
    const hasShangChuanFuJian = nodes.some(n => n?.text?.toString()?.includes('上传附件'));
    if (hasFangJieKe && hasShangChuanFuJian) {
      logger.info('保利:步骤13-情况2', `第 ${attempt}/3 次报备成功 (双节点匹配: 防截客中=${hasFangJieKe}, 上传附件=${hasShangChuanFuJian})`);
      detectedSuccess = true;
      break;
    }

    logger.warn('保利:步骤13', `第 ${attempt}/3 次未检测到结果, 继续重试`);
  }

  // 情况 1 命中: 疑似重号 + 写数据库 status='重号'
  if (detectedRepeat) {
    logger.info('保利:步骤13-情况1', '疑似重号, 启动震动+弹窗');
    // 🆕 V32.36.81 老板 09-22 拍板: 标记重号, execute() 弹窗文案用"重号了"
    lastBaoliFailReason = '重号';
    orchestrator.send('BAOLI_INTERVENE');
    // V32.36.58 老板 09-21 拍板: 检测到重号, 写数据库 2 个 ID 都改成 status='重号'
    //   老板铁子反证金标准: '2轮中任何一轮出错, 均需将2个ID的值写为重号'
    //   修法: reportIds 是 [id1, id2] 数组, 同时写 2 个
    if (reportIds !== undefined) {
      for (const id of reportIds) {
        try {
          await markReportDone(id, '重号');
          logger.info('保利:步骤13-情况1', `✓ 数据库状态更新: ID=${id} status='重号' (V32.36.58 老板拍板 2 轮均写重号)`);
        } catch (e) {
          logger.warn('保利:步骤13-情况1', `数据库更新失败 ID=${id}: ${e}`);
        }
      }
    }
    return false;
  }

  // 情况 2 命中: 报备成功 + 写数据库 status='done' (V32.36.52)
  if (detectedSuccess) {
    logger.info('保利:步骤13-情况2', `报备成功 (双节点匹配: 防截客中=true, 上传附件=true)`);

    // V32.36.52 老板 09-21 装机实测 - 修法 (老板拍板 写数据库):
    //   老板拍板: '在这里增加一个写数据库的动作, 将 [千机:步骤4] [X] ID=Y 客户=李晓梅 项目=保利X 和颂 状态=baoli 状态改为成功'
    //   老板反证金标准: step13-情况2 报备成功后, 把对应的 report ID 状态从 pending 改成 done
    //   修法: 用 markReportDone(id, 'done') (V4 database.ts:158 已有函数)
    //     - runBaoliRound 接受 reportId 参数 (从 runBaoliFlow 传过来)
    //     - step13-情况2 报备成功后调 markReportDone(reportId, 'done')
    if (reportId !== undefined) {
      try {
        await markReportDone(reportId, 'done');
        logger.info('保利:步骤13-情况2', `✓ 数据库状态更新: ID=${reportId} status=done (V32.36.52 老板拍板)`);
      } catch (e) {
        logger.warn('保利:步骤13-情况2', `数据库更新失败 ID=${reportId}: ${e}`);
      }
    } else {
      logger.warn('保利:步骤13-情况2', 'reportId 为空, 跳过数据库更新 (旧调用方未传 reportId)');
    }

    // 情况 2-1: 上滑屏幕 (V32.36.35 老板 09-20 装机实测 - 修法):
    //   老板 11:35 实测: V4 上滑太多了, V2 是 18% 短上滑 (55% → 37%)
    //   V4 scrollUpPPlus 默认 56% 长上滑 (84% → 28%), 老板说'上滑太多了'
    //   修法: step13-情况2-1 上滑幅度改用 V2.x 同款 (55% → 37%) - 直接 inline, 不调 scrollUpPPlus
    //   V2.x 反证 client/services/BaoliService.ts L2085-2086 humanSwipeDp(55% → 37%)
    logger.info('保利:步骤13-情况2', '上滑屏幕 (V32.36.35 V2.x 同款 55% → 37% 短上滑)');
    const swipeOk = await humanSwipeWithBounceDp(
      centerXDp(),
      Math.round(screenHeightDp() * 0.55),  // V2 同款起点: 屏下 55%
      centerXDp(),
      Math.round(screenHeightDp() * 0.37),  // V2 同款终点: 屏上 37%
      500
    );
    logger.info('保利:步骤13-情况2', `humanSwipeWithBounceDp 上滑结果: ${swipeOk}`);

    // 情况 2-2: 找 Y 值最小的二维码 (V32.36.37 老板 09-20 新逻辑, 老板反证金标准)
    //   老板 09-20 拍板: 'V2 老逻辑错了, 用新逻辑 - 找所有 Image 节点 + Y 升序 + 点第一个'
    //   V32.36.35 + V32.36.36 错位 (老板铁子): 用 V2 老逻辑 'text.includes(上传附件)' + +dp(167) 偏移
    //     - V2 v22.02.60 老板反证: 二维码 (636, 791) vs 上传附件 (290, 512) 不在同一水平, +500px 偏错
    //   V32.36.37 新逻辑 (老板反证金标准):
    //     1. dump getAllTextNodes 拿所有节点
    //     2. 过滤 className='android.widget.Image' + 尺寸 40-100px (二维码尺寸)
    //     3. 按 bounds.top 升序排序 (Y 最小 = 最新报备 = 最顶部)
    //     4. 点第一个的 centerX/centerY (零抖动, 不偏移)
    //   老板 nova 09-20 11:30 dump 验证: 3 个 Image 节点
    //     - Image #1 (banner): [999,319][1038,370] 39x51 (宽<40 不过滤)
    //     - Image #2 (新报备 11:51:21): [912,1156][996,1243] 84x87 ✅
    //     - Image #3 (旧报备 11:35:26): [912,1918][996,2005] 84x87 ✅
    //   按 Y 排序后: #2 是第一个 (Y 最小), 应该点 #2 的 centerX=954, centerY=1199
    logger.info('保利:步骤13-情况2', 'V32.36.37 老板新逻辑 - 找 Y 最小 Image 二维码');
    let qrClicked = false;
    try {
      const allNodes = await ZBBAutomation.getAllTextNodes();

      // 老板反证金标准 #1: 过滤 className='android.widget.Image' 或 type='image' (V32.36.38 native 扩展)
      // V32.36.48 老板 09-20 装机实测 - 修法 (老板铁子反证金标准):
      //   老板 nova 9:45:27 log: V32.36.38b isImage 返回 type='image' 但 centerX=-210 (错的)
      //   老板铁子反证金标准: V4 native 现有 collectTextNodesRecursive 加 isImage 返回有问题 (centerX 算错)
      //   修法: 不用 getAllTextNodes 过滤 type='image', 改用新方法 getAllImageNodes
      //   E470 adb dump 实测: Image #2 [912,1195][996,1282] centerX=954, centerY=1238 (对的)
      const imageNodesRaw = await ZBBAutomation.getAllImageNodes();
      const images = imageNodesRaw;
      logger.info('保利:步骤13-情况2', `dump 找到 ${images.length} 个 Image 节点 (V32.36.48 getAllImageNodes)`);

      // V32.36.45 老板 09-20 装机实测 - 诊断 log (老板铁子命中错位, V32.36.44 用 bounds 推算还是 0 个):
      //   老板铁子反证金标准: 老板 nova 9:45:27 log 显示旧 getAllTextNodes 返回 centerX=-210 (不可见)
      //   V32.36.48 新 getAllImageNodes 用自己的 rect, 应该返回真实 centerX=954
      if (images.length > 0) {
        const sample = images[0];
        logger.info('保利:步骤13-情况2', `首个 Image 节点数据: ${JSON.stringify(sample)}`);
      } else {
        logger.warn('保利:步骤13-情况2', 'V32.36.48 getAllImageNodes 0 个候选 (跟 E470 adb dump 不一致 - 待排查)');
      }

      // V32.36.44 老板 09-20 装机实测 - 修法 (老板铁子命中错位):
      //   老板铁子错位: V32.36.38b native 加了 width/height 字段, TS 端用 (n as any).width
      //   真实情况: V4 TS A11yNode interface 没声明 width/height, RN bridge 序列化时可能丢失
      //             老板 nova log: dump 找到 85 个 Image 节点, 二维码候选 0 个 -> 全部 width/height 是 undefined
      //   真因: V4 native V32.36.38b 的 type='image' 节点, RN bridge 没把 width/height 传到 TS 端
      //   修法: 用 V4 A11yNode 已有的 bounds 字段 (L11 interface 已声明) 推算 width/height
      //     - bounds = { left, top, right, bottom } (V4 native L2680 getBoundsInScreen 已有)
      //     - width = bounds.right - bounds.left
      //     - height = bounds.bottom - bounds.top
      //   老板铁子铁律: 不依赖 RN bridge 序列化的未声明字段, 用已声明的 bounds 推算
      //
      // V32.36.48 老板 09-20 装机实测 - 修法 (老板铁子反证金标准):
      //   native 端 getAllImageNodes 已经过滤 40-150 范围, TS 端不再过滤 width/height
      //   只按 Y 升序排序 + 取第一个
      //   修法 (老板铁子反证金标准): 跟 V32.36.37 老板新逻辑一致 (Y 最小 = 最新报备)
      const qrCandidates = images;
      logger.info('保利:步骤13-情况2', `二维码候选 (native 已过滤 40-150): ${qrCandidates.length} 个`);

      // 老板反证金标准 #3: 按 X 值最大 + Y 值最小排序 (老板 09-22 nova 实测反证金标准)
      // V32.36.37 旧逻辑: Y 升序排序 (top 越小越靠上 = 最新报备)
      //   老板铁子反证金标准 - 老板铁子命中错位 (再次 - 关键):
      //   老板 nova 11:15 实测: 最新报备二维码在屏幕右上角 (X 大, Y 小)
      //   V32.36.37 'Y 最小' 只能保证在顶部, 但不一定在最右
      //   老板拍板: '点击 x 值最大, y 值最小 的二维码' (屏幕右上角)
      // V32.36.71 老板 09-22 拍板 - 修法:
      //   排序规则: X 值最大 + Y 值最小
      //   老板铁子反证金标准: 真千机的'最新报备'二维码固定在屏幕右上角
      //   修法: 按 (x 值越大, y 值越小) 排序, 取第一个
      qrCandidates.sort((a: any, b: any) => {
        // 主要排序: X 值越大越优先 (老板铁子反证金标准 - 屏幕右上角)
        // 兜底: X 相等时, Y 值越小越优先 (老板铁子反证金标准)
        const xDiff = (b.centerX ?? 0) - (a.centerX ?? 0);  // X 降序 (老板拍板 - X 最大优先)
        if (xDiff !== 0) return xDiff;
        return (a.centerY ?? 0) - (b.centerY ?? 0);  // Y 升序 (X 相同时, Y 最小优先)
      });

      // 🆕 V32.36.70 老板 09-22 拍板 - 打印前 5 个二维码候选 (方便老板看 log 调试)
      const top5 = qrCandidates.slice(0, 5);
      top5.forEach((qr: any, idx: number) => {
        logger.info('保利:步骤13-情况2', `二维码候选[${idx + 1}/5] @ (${qr.centerX}, ${qr.centerY}) size=${qr.width}x${qr.height} top=${qr.top}`);
      });

      // 老板反证金标准 #4: 点第一个 (X 最大, Y 最小 = 屏幕右上角最新报备), 零抖动
      if (qrCandidates.length > 0) {
        const firstQr = qrCandidates[0];
        logger.info('保利:步骤13-情况2', `X 最大+Y 最小二维码 @ (${firstQr.centerX}, ${firstQr.centerY}) (V32.36.71 老板拍板屏幕右上角最新报备)`);
        await ZBBAutomation.click(firstQr.centerX, firstQr.centerY);  // 零抖动
        // V32.36.49 老板 09-21 装机实测 - 修法 (老板拍板):
        //   老板问: '点击二维码和三指下滑是同一时间进行的, 调整为, 点击二维码之后等待3-4S间的随机时间, 然后再执行三指下滑'
        //   老板反证金标准: 之前 tap + 三指下滑之间没等, 太快了
        //   修法: 点击二维码后等 3000-4000ms 随机, 再执行三指下滑
        // 🆕 V32.36.94 老板 09-23 拍板: 改 1-2s 随机 (老板 nova 09:40 实测 3943ms 偏长)
        const qrWait = 1000 + Math.floor(Math.random() * 1000);  // 1000-2000ms
        logger.info('保利:步骤13-情况2', `点击二维码后等 ${qrWait}ms (V32.36.94 老板拍板 1-2s 随机)`);
        await ZBBAutomation.delay(qrWait);
        qrClicked = true;
      } else {
        logger.warn('保利:步骤13-情况2', '没找到二维码候选, 跳过点二维码');
      }
    } catch (e) {
      logger.warn('保利:步骤13-情况2', `dump 找二维码异常: ${e}`);
    }

    if (!qrClicked) {
      logger.warn('保利:步骤13-情况2', '二维码点击失败, 但继续流程');
    }

    // 情况 2-2-2: V32.36.36 老板拍板 - V2 同款 showToast 提示老板去截图
    //   V2.x BaoliService.ts L2169 v22.02.34 老板实战反证金标准:
    //     showToast('✅ 已完成报备, 请选择正确二维码截图. 记得核对姓名及电话!')
    //   修法: V4 ZBBAutomation.showToast 待 V32.36.37+ 加, V32.36.36 暂时不调 (老板铁子铁律: 不引入未实现 API)
    //   注: V2 也是 showToast 在步骤15-情况2-步骤8 (后续) 不在 2-2 这里, V32.36.37+ 调整位置
    logger.info('保利:步骤13-情况2', 'V2 同款 showToast 待 V32.36.37+ 整合 (V32.36.36 不引入未实现 API)');

    // 情况 2-3: 三指下滑触发系统截图 (V32.36.35 老板 09-20 拍板 - 新增)
    //   老板拍板: '增加点击二维码和三指下滑的操作'
    //   V2.x 反证 client/services/BaoliService.ts L1686-1704 v21.13-v21.22 三指下滑:
    //     - threeFingerSwipeDown(80, 600, 400) - dp 起点 80dp, 终点 600dp, 400ms
    //     - nova (JEF-AN00) dispatchGesture 不生效 (V2.x 实战反证 08-12)
    //     - 失败 retry 1 次 (第二次通常成功 v21.22 老板拍板)
    // 🆕 V32.36.75 老板 09-22 拍板 - 修法 (老板铁子反证金标准 - vivo 逻辑):
    //   老板 nova 14:42 实测反馈: '学习V2的三指下滑操作, 核对与这里的差异'
    //   V32.36.35 调 scrollDownPPlus (单指下滑) != V2 真三指下滑
    //   老板拍板: '不使用 nova 的逻辑 (无限等 GO), 使用 vivo 的逻辑 (真三指下滑)'
    //   修法: 调 native ZBBAutomation.threeFingerSwipeDown (跟 V2 v21.17 一致)
    //   + 调 native checkScreenshotSaved 验证截图真保存 (V2 v22.02.30 反证金标准)
    logger.info('保利:步骤13-情况2', '三指下滑触发系统截图 (V32.36.75 老板拍板 vivo 逻辑, 跟 V2 v21.17 一致)');
    let swipeSuccess = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt > 1) {
          logger.info('保利:步骤13-情况2', `第 ${attempt}/2 次三指下滑 (V32.36.75 v21.22 retry)`);
          await ZBBAutomation.delay(500);
        }
        // V32.36.75 调 native 真三指下滑 (跟 V2 v21.17 一致, 80dp→600dp=4*80→4*600=320,2400 px on density=4)
        // V2 v21.17: threeFingerSwipeDown(80, 600, 400) - dp 起点 80, 终点 600, duration 400ms
        // V32.36.75: 调 native threeFingerSwipeDown(320, 2400, 400) - px 起点 320, 终点 2400
        // 🆕 V32.36.95 老板 09-23 拍板: 改坐标
        //   X: 25%/50%/75% -> 30%/50%/70%
        //   Y 起/止: 320/2400 -> 500/1500 (短一些)
        //   duration: 400ms -> 600ms (慢一些)
        const screenWidth = 1080;  // nova 1080x2400 实测
        const startPx = 500;
        const endPx = 1500;
        const durationMs = 600;
        // 🆕 V32.36.94 老板 09-23 拍板: 列出三指下滑的起止坐标 (老板原话: '列出三只下滑的起止坐标')
        //   native 三指 X 按屏幕百分比 (AccessibilityServiceImpl.kt:1774 xPercent default)
        //   三指同步下滑 (v21.14 老板拍板, 同时开始/结束, 拟人化只保留 X ±10dp 偏移)
        const fingerXList = [screenWidth * 0.3, screenWidth * 0.5, screenWidth * 0.7];
        logger.info('保利:步骤13-情况2', `三指下滑 (native) 起止坐标 (V32.36.95 老板拍板 30/50/70%, 500→1500, 600ms):`);
        fingerXList.forEach((x, i) => {
          logger.info('保利:步骤13-情况2', `  第 ${i + 1} 指: (${x.toFixed(0)}, ${startPx}) → (${x.toFixed(0)}, ${endPx}), duration=${durationMs}ms`);
        });
        const threeFingerOk = await ZBBAutomation.threeFingerSwipeDown(startPx, endPx, durationMs);
        swipeSuccess = threeFingerOk;
        logger.info('保利:步骤13-情况2', `三指下滑 (native) 第 ${attempt}/2 次: success=${threeFingerOk}`);
        if (threeFingerOk) break;
      } catch (e) {
        logger.warn('保利:步骤13-情况2', `第 ${attempt}/2 次三指下滑异常: ${e}`);
      }
    }
    if (!swipeSuccess) {
      logger.warn('保利:步骤13-情况2', 'V32.36.75 三指下滑 2 次都失败, 走 fallback - 老板手动截图');
    } else {
      // V32.36.75 加 checkScreenshotSaved 验证截图真保存 (V2 v22.02.30 反证金标准)
      await ZBBAutomation.delay(2500);  // 等系统截图保存 (Android 截图落盘通常 1-3s)
      try {
        const screenshotCheck = await ZBBAutomation.checkScreenshotSaved();
        if (screenshotCheck.saved) {
          logger.info('保利:步骤13-情况2', `✓ V32.36.75 截图验证成功: ${screenshotCheck.filePath} (V2 v22.02.30 反证金标准)`);
        } else {
          logger.warn('保利:步骤13-情况2', `V32.36.75 三指下滑 SUCCESS 但截图未保存 (8s 内没找到 PNG), 走 fallback - 老板手动截图`);
          swipeSuccess = false;
        }
      } catch (e) {
        logger.warn('保利:步骤13-情况2', `V32.36.75 checkScreenshotSaved 异常: ${e}`);
      }
    }
    if (!swipeSuccess) {
      logger.warn('保利:步骤13-情况2', '三指下滑 2 次都失败 (V2.x nova 实战反证 - 老板手动截图)');
    }

    // 情况 2-4: 等截图保存 + 老板手动截图兜底
    // 🆕 V32.36.84 老板 09-22 拍板: 5000ms 太长, 改 2-3s 随机 (老板 nova 实测截图保存够快)
    logger.info('保利:步骤13-情况2', '等待截图保存 (V2.x v21.17 5000ms → V32.36.84 老板拍板 2-3s 随机)');
    await ZBBAutomation.delay(2000 + Math.floor(Math.random() * 1000));

    // V32.36.43 老板 09-20 装机实测 - 修法 (老板拍板 B):
    //   老板问: 'tap 返回键 返回的是哪个界面?'
    //   老板铁子反证: 报备结果页 → pressKey.back() → 项目详情页 (跟 V2.x v22.02.24 反证金标准一致)
    //                  但 V32.36.42 第二轮逻辑假设'页面已经在项目详情页', 如果多按返回键会跳出项目页
    //   修法: 按返回键 + dump 验证是否在项目详情页 (有项目名 + '报备' 按钮)
    //     - 最多按 2 次 (防跳出项目页)
    //     - 每次按完 dump 验证, 没找到项目页 → 退出 (让 V32.36.42 第二轮 fail 报错)
    //   V2.x 反证金标准: v22.02.24 (08-12 老板拍板) - '不按返回键, 让用户在保利小程序继续操作下一轮'
    //                    但 V32.36.42 第二轮需要页面在项目详情页, 所以保留按返回键 (跟 V2.x 不同)
    //
    // V32.36.54 老板 09-21 拍板 - 修法 (老板铁子反证金标准 - 修正 V32.36.53 错误):
    //   老板问: '第一轮要按返回键 (现在没按), 但不执行步骤14!'
    //   老板铁子命中错位: V32.36.53 把第一轮改成不按返回键, 跟老板拍板新逻辑冲突
    //   老板铁子反证金标准: V32.36.43 老板拍板 B '两轮都按返回键' 仍然有效
    //                     区别: 步骤14 只在 round=2 step13完成后调用 (第一轮不调)
    //   修法 (老板铁子反证金标准): 恢复 V32.36.43 两轮都按返回键 + dump 验证项目详情页
    //     - 第一轮按返回键 + dump 验证 (跟 V32.36.43 一致)
    //     - 第二轮按返回键 + dump 验证 (跟 V32.36.43 一致)
    //     - 第一轮不调步骤14 (V32.36.53 老板拍板)
    //     - 第二轮调步骤14 (V32.36.53 老板拍板)
    let onProjectPage = false;
    for (let backCount = 1; backCount <= 3; backCount++) {
      await pressKey.back();
      await ZBBAutomation.delay(1000);

      // dump 验证是否在项目详情页 (有项目名 + '报备' 按钮)
      let checkNodes: any[] = [];
      try {
        checkNodes = await ZBBAutomation.getAllTextNodes();
      } catch (e) {
        logger.warn('保利:步骤13-情况2', `dump 验证项目页异常: ${e}`);
      }
      const hasReportBtn = checkNodes.some((n: any) =>
        n?.text?.toString()?.includes('报备')
      );
      const hasProjectName = checkNodes.some((n: any) =>
        n?.text?.toString()?.includes('缦城和颂') ||
        n?.text?.toString()?.includes('山水和颂') ||
        n?.text?.toString()?.includes('和煦')
      );
      if (hasReportBtn && hasProjectName) {
        onProjectPage = true;
        logger.info('保利:步骤13-情况2', `✓ 第${round}轮按返回键 ${backCount} 次后到达项目详情页 (V32.36.54 老板拍板恢复 V32.36.43)`);
        break;
      } else {
        logger.warn('保利:步骤13-情况2', `按返回键 ${backCount} 次, 未到项目详情页 (报备按钮=${hasReportBtn}, 项目名=${hasProjectName})`);
      }
    }
    if (!onProjectPage) {
      logger.warn('保利:步骤13-情况2', `按 3 次返回键都没到项目详情页 (V32.36.54 - 第${round}轮 - 步骤14 ${round === 2 ? '会fail' : '不调用'})`);
    }

    return true;
  }

  logger.info('保利:步骤13', '3 次都没检测到结果, 报错');
  // 🆕 V32.36.81 老板 09-22 拍板: 3次失败也标记"重号" (老板原话: '情况 3 也按重号处理')
  lastBaoliFailReason = '重号';
  // V32.36.58 老板 09-21 拍板: 3 次失败 → 报错 + 写数据库 2 个 ID 都改成 status='重号'
  //   老板铁子反证金标准: '2轮中任何一轮出错, 均需将2个ID的值写为重号'
  //   修法: reportIds 是 [id1, id2] 数组, 同时写 2 个
  if (reportIds !== undefined) {
    for (const id of reportIds) {
      try {
        await markReportDone(id, '重号');
        logger.info('保利:步骤13-情况3', `✓ 数据库状态更新: ID=${id} status='重号' (V32.36.58 老板拍板 3次失败 2轮均写重号)`);
      } catch (e) {
        logger.warn('保利:步骤13-情况3', `数据库更新失败 ID=${id}: ${e}`);
      }
    }
  } else {
    logger.warn('保利:步骤13-情况3', 'reportIds 为空, 跳过数据库更新 (旧调用方未传 reportIds)');
  }
  return false;
}

// ============================================================
// 步骤 14: 第二轮截图后上传到千机 (V32.36.53 老板 09-21 拍板 - V2 反证金标准)
//   老板铁子反证金标准: V2.x handleSuccessCase(round=2) L2122-2280+
//   V4 V32.36.43 现状: 步骤8-a 按返回键 (V32.36.53 移到 round===2)
//   V32.36.53 新增: 步骤14 系列 (7 步独立顶级函数, 删除原 V2 步骤8-b Home 键)
//     - 14-1: 打开千机 (launchApp) + 7.5-9s 冷启动
//     - 14-2: dump 找"报备有效" + 兜底 dp(294, 690)
//     - 14-3: 震动 + Toast 提示
//     - 14-4: dump 找"+添加框" + 兜底 dp(83, 396)
//     - 14-5: dump 相册选前2张 (ImageView)
//     - 14-6: dump 找"完成" + 点击
//     - 14-7: Toast 二次确认
//   老板铁子铁律: 步骤14 只在 round=2 step13完成后调用
// ============================================================
async function step14UploadScreenshot(customer: CustomerInfo): Promise<boolean> {
  logger.info('保利:步骤14', '第二轮截图后上传千机 (V32.36.53 老板拍板 V2 反证金标准)');

  try {
    // 步骤 14-1: 打开千机 (跟 V4 千机-步骤1 stepOpenQianji 完全一致)
    //   老板铁子反证金标准 (V32.36.55 老板 09-21 拍板):
    //     - 用 launchAppWithAmStart (V2.x 实测, V4 native 已实现 AccessibilityServiceImpl.kt:2149)
    //     - 用 qianjiPackage() / qianjiMainActivity() env 函数 (跟 BuildConfig 同步)
    //     - try-catch + 1 次重试 (V2 v22.02.32 实测)
    //     - fallback launchApp (兼容 mock 模式)
    //   老板铁子铁律: 跟千机-步骤1 完全一致, 避免 launchApp 失败 (V32.36.53 launchApp 返回 false bug)
    logger.info('保利:步骤14-1', '打开千机 (跟千机-步骤1 一致 launchAppWithAmStart)...');

    // 🆕 V32.36.55: 跟千机-步骤1 一致 - 用 env 函数取包名 + mainActivity
    const qianjiPkg = qianjiPackage();
    const qianjiAct = qianjiMainActivity();
    logger.info('保利:步骤14-1', `package=${qianjiPkg}, mainActivity=${qianjiAct}`);

    // 🆕 V32.36.55: 跟千机-步骤1 一致 - 优先 launchAppWithAmStart, fallback launchApp
    // @ts-ignore - launchAppWithAmStart 是 V2.x 实测, V4 native 已实现
    const launchWithAm = (ZBBAutomation as any).launchAppWithAmStart
      ?? (ZBBAutomation as any).launchApp; // fallback 到旧 launchApp (兼容 mock)

    let launched = false;
    try {
      launched = await launchWithAm(qianjiPkg, qianjiAct);
      if (launched) {
        logger.info('保利:步骤14-1', '千机已启动, 等待界面加载...');
        // V32.36.56 老板 09-21 拍板 - 修法: 14-1 时间间隔 7.5-9s → 2-3s (老板铁子反证金标准 - 老板手动模式已开, 不需要等冷启动)
        await ZBBAutomation.delay(2000 + Math.floor(Math.random() * 1000));  // 2-3s (V32.36.56 老板拍板)
      } else {
        throw new Error('千机启动失败 (launchWithAm 返回 false)');
      }
    } catch (error) {
      // 🆕 V32.36.55: 跟千机-步骤1 一致 - 重试 1 次 (V2 v22.02.32 实测)
      logger.warn('保利:步骤14-1', `启动失败, 准备重试: ${error}`);
      await ZBBAutomation.delay(1000);
      try {
        launched = await launchWithAm(qianjiPkg, qianjiAct);
        if (!launched) throw new Error('千机启动失败 (重试)');
        // V32.36.56 老板 09-21 拍板 - 修法: 14-1 retry 时间间隔也改成 2-3s (跟首次一致)
        await ZBBAutomation.delay(2000 + Math.floor(Math.random() * 1000));
      } catch (retryError) {
        logger.warn('保利:步骤14-1', `重试也失败, 跳过步骤14: ${retryError}`);
        // 老板铁子铁律: 步骤14 是辅助功能, 失败不影响流程
        return false;
      }
    }

    logger.info('保利:步骤14-1', '✓ 千机已打开 (V32.36.55 跟千机-步骤1 一致)');

    // 步骤 14-2: dump 找"报备有效" (V2 L2149-2161 步骤8-d)
    // 🆕 V32.36.74 老板 09-22 拍板 - 修法 (老板铁子反证金标准 - 跟千机步骤 3 一致):
    //   老板 nova 14:42 log: '核对代码, 这一步如果找不到报备有效, 有上滑操作吗?'
    //   老板铁子命中错位 (再次 - 关键): V32.36.73 步骤 14-2 只有 1 次 dump + hardcode 兜底
    //   老板铁子反证金标准: 跟千机步骤 3 (findWithRecovery + 上滑重试 3 次) 不一致
    //   修法: 改用 findWithRecovery, dump 3 次 + 上滑 + dump 2 次 + 兜底 hardcode
    // 🆕 V32.36.83 老板 09-22 拍板: 步骤 14-2 找"报备有效"之前, 先 dump 解析 varD 跟 customer (C) 对比
    //   老板 nova 14:42 log: '核对代码, 这一步如果找不到报备有效, 有上滑操作吗?'
    //   老板拍板:
    //     - 一致 → 继续找"报备有效"
    //     - 不一致 → 弹窗"小主,本次报备的客户与千机现在显示的客户不一致,请手动核对!!" 永不超时
    //   老板反证: 千机可能缓存了别的客户/千机没刷新 → 报备错了客户会扣绩效
    logger.info('保利:步骤14-2', 'dump 解析 varD, 跟 customer (C) 对比 (V32.36.83)');
    try {
      const step14VarDNodes = await ZBBAutomation.getAllTextNodes();
      // 🆕 V32.36.89 老板 09-22 拍板: varD 跟 varA 是同一个界面 (mock 千机首页), 复用 parseVariableAFromNodes
      //   之前 V32.36.87 错用 parseVariableCFromClipboard, 老板拍板'D 和 A 是一样的界面, 可以复用同一个逻辑'
      const varD = parseVariableAFromNodes(step14VarDNodes);
      logger.info('保利:步骤14-2', `varD 解析: projectName='${varD.projectName}', customerName='${varD.customerName}', phone='${varD.phone}'`);
      logger.info('保利:步骤14-2', `customer (C): projectName='${customer.projectName}', customerName='${customer.customerName}', phone='${customer.phone}'`);
      const compareResultD = compareCustomer(
        { projectName: varD.projectName, customerName: varD.customerName, phone: varD.phone },
        { projectName: customer.projectName, customerName: customer.customerName, phone: customer.phone }
      );
      if (!compareResultD.isMatch) {
        const diffMsgD = compareResultD.diffs.map(d => `${d.field}: '${d.aValue}' vs '${d.bValue}'`).join('; ');
        logger.warn('保利:步骤14-2', `✗ 千机 varD 跟 customer 不一致! diff: ${diffMsgD}`);
        // 🆕 V32.36.91 老板 09-23 拍板: varD 不一致 → 阻塞主流程 + 只一轮弹窗
        //   老板原话: '如果C和D的数据不一致,需要阻塞流程. 但只需要一轮弹窗+震动!'
        //   V32.36.83 之前设计: return true 不阻塞 (设计错了, 老板 09-23 拍板改)
        //   V32.36.91 修法: return false 阻塞 + 设 lastBaoliFailReason='varD不一致' + raiseAlert 永不超时
        //     - execute() 看到 reason='varD不一致' 跳过二次弹窗 (跟 V32.36.90 剪贴板不一致同款机制)
        lastBaoliFailReason = 'varD不一致';
        await raiseAlert('小主,本次报备的客户与千机现在显示的客户不一致,请手动核对!!', 30000, true);
        return false;
      }
      logger.info('保利:步骤14-2', '✓ varD 跟 customer 一致, 继续找"报备有效"');
    } catch (e) {
      logger.warn('保利:步骤14-2', `varD 对比异常 (不影响流程, 继续找报备有效): ${e}`);
    }

    logger.info('保利:步骤14-2', 'dump 找"报备有效" (V32.36.74 老板拍板 findWithRecovery 上滑重试)...');
    let baobeiYouxiaoNode: any = null;
    try {
      // 🆕 V32.36.78 老板 09-22 拍板 - 修法 (老板铁子反证金标准 - 真根因):
      //   V32.36.74~77 baobeiYouxiaoNode = await findWithRecovery(...) 是错的!
      //   findWithRecovery 返回 boolean, 赋值给 baobeiYouxiaoNode 会**覆盖** finder 内部赋值的节点对象
      //   执行顺序:
      //     1) finder 第 1 次命中: baobeiYouxiaoNode = 节点对象 (含 centerX=854)
      //     2) finder 返 true, findWithRecovery 返 true (boolean)
      //     3) 外层 baobeiYouxiaoNode = true → 覆盖! 节点对象丢了
      //     4) 后续 baobeiYouxiaoNode.centerX = true.centerX = undefined
      //   老板 nova 16:47 log 反证: (undefined, undefined) 跟 V32.36.73 单次 dump 成功的差异,
      //     不在 A11y 抢树, 不在节点 bounds, 而在 V32.36.74 引入的赋值覆盖 bug
      //   修法: 外层只 await 不接返回值, 节点对象由 finder 内部赋值
      await findWithRecovery(
        '保利:步骤14-2:报备有效',
        async () => {
          // findWithRecovery 要求 finder 返回 boolean
          const nodes = await ZBBAutomation.getAllTextNodes();
          // 🆕 V32.36.77 老板 09-22 拍板 - 修法:
          //   老板 nova 15:57 log: 找到 '报备有效' 但 (undefined, undefined)
          //   老板铁子命中错位根因: nova EMUI 10 + 15 个 A11y 服务抢同一棵树
          //     → 其他 service recycle 后, ZBB 拿到的节点 centerX/Y 是 undefined 或 0
          //   修法: finder 内过滤掉坐标无效节点 (centerX > 0 && centerY > 0),
          //     不让 findWithRecovery 拿到"假命中"的占位节点
          const found = nodes.find((n: any) =>
            n?.text?.toString()?.includes('报备有效') &&
            typeof n.centerX === 'number' && n.centerX > 0 &&
            typeof n.centerY === 'number' && n.centerY > 0
          );
          baobeiYouxiaoNode = found ?? null;  // 同时存到外部变量
          return !!found;
        },
        async () => {
          // 恢复动作: 上滑 (跟千机步骤 3 同款)
          await swipe.up();
          await ZBBAutomation.delay(1500);
        }
      );
      if (baobeiYouxiaoNode) {
        // V32.36.74 修法: baobeiYouxiaoNode 已在 finder 内赋值 (findWithRecovery 找到时已写入)
        logger.info('保利:步骤14-2', `找到"报备有效" @ (${baobeiYouxiaoNode.centerX}, ${baobeiYouxiaoNode.centerY})`);
        // 🆕 V32.36.79 老板 09-22 拍板 - 修法:
        //   老板 nova 16:56 log: 找到"报备有效" @ (854, 1879) 坐标生效
        //   老板拍板 2 件事:
        //     1) 点击用小幅拟人化 (click.byNode 'precise' 模式, ±2px 抖动, 比直接 ZBBAutomation.click 更像人)
        //     2) 兜底坐标改成 nova 实测 (854, 1879), 不再用 V2 v19.90 D13 vivo 实测 (587, 1379)
        //   V32.36.78 修赋值覆盖 bug 后 finder 拿到的就是真实坐标,
        //     不需要走 centerX>0 兜底分支, 但保留作双保险
        if (baobeiYouxiaoNode.centerX > 0 && baobeiYouxiaoNode.centerY > 0) {
          // 拟人化点击 (precise 模式: ±2px 抖动)
          await click.byNode(baobeiYouxiaoNode, 'precise');
        } else {
          // 兜底用 nova 实测坐标 (854, 1879)px = dp(427, 940) (density=480 scale=3.00 → dp=(854/2, 1879/2))
          //   老板 nova 16:56 log 反证: V2 v19.90 D13 vivo 实测 (587, 1379)px 在 nova 上点错位置
          logger.warn('保利:步骤14-2', `找到节点但坐标无效 (centerX=${baobeiYouxiaoNode.centerX}, centerY=${baobeiYouxiaoNode.centerY}), 兜底用 nova 实测 (854, 1879)px [V32.36.79 老板拍板修法]`);
          await ZBBAutomation.click(854, 1879);
        }
      } else {
        // 兜底用 nova 实测坐标 (854, 1879)px (老板 nova 16:56 实测)
        logger.warn('保利:步骤14-2', '未找到"报备有效" (findWithRecovery 上滑后仍未找到), 兜底用 nova 实测 (854, 1879)px [V32.36.79]');
        await ZBBAutomation.click(854, 1879);
      }
    } catch (e) {
      logger.warn('保利:步骤14-2', `dump 异常: ${e}, 兜底用 nova 实测 (854, 1879)px`);
      await ZBBAutomation.click(854, 1879);
    }
    // V2 v19.90 D16: 等弹窗动画 3-4.5s (×1.5)
    await ZBBAutomation.delay(3000 + Math.floor(Math.random() * 1500));

    // 步骤 14-3: 震动 + Toast 提示 (V2 L2163-2169 步骤8-e)
    logger.info('保利:步骤14-3', '震动 + Toast 提示');
    try {
      await ZBBAutomation.startPulseVibration();
    } catch (e) {
      logger.warn('保利:步骤14-3', `startPulseVibration 异常: ${e}`);
    }
    try {
      await ZBBAutomation.showToast('✅ 已完成报备,请选择正确二维码截图。记得核对姓名及电话!');
    } catch (e) {
      logger.warn('保利:步骤14-3', `showToast 异常: ${e}`);
    }

    // 步骤 14-4: dump 找"添加" (V32.36.61 老板 09-22 拍板 - 修法)
    //   老板 nova 09-22 16:49 实测: 当前页面 = "请添加带看二维码" 弹窗
    //   添加框 Button: content-desc="添加框，点击进入相册"
    //     - 子节点: text="+" (TextView) + text="添加" (TextView) — 两个独立 TextView
    //   V32.36.59 错位: 找 content-desc="添加框" — 老板 nova dump 失败
    //   V32.36.61 老板拍板: 找 text="添加" (TextView 节点, 不是 Button 父节点)
    //   老板铁子反证金标准: text="添加" 在子 TextView, 需要单独找
    logger.info('保利:步骤14-4', 'dump 找"添加" (V32.36.61 老板拍板 text 方案)...');
    const addBoxNodes = await ZBBAutomation.getAllTextNodes();
    // 老板铁子反证金标准 (V32.36.61 老板拍板): 找 text='添加' 节点
    let addBoxNode: any = addBoxNodes.find((n: any) =>
      n?.text?.toString()?.trim() === '添加'
    );
    // 兜底 1: 找 content-desc="添加框"
    if (!addBoxNode) {
      addBoxNode = addBoxNodes.find((n: any) =>
        n?.contentDesc?.toString()?.includes('添加框')
      );
      if (addBoxNode) logger.info('保利:步骤14-4', 'text="添加" 没找到, 兜底用 content-desc="添加框"');
    }
    // 兜底 2: 找 Button class + text='+'
    if (!addBoxNode) {
      addBoxNode = addBoxNodes.find((n: any) =>
        n?.text?.toString()?.trim() === '+' &&
        n?.class?.toString()?.includes('Button')
      );
      if (addBoxNode) logger.info('保利:步骤14-4', 'text="添加" + content-desc 都没找到, 兜底用 text="+" Button');
    }
    if (addBoxNode) {
      logger.info('保利:步骤14-4', `找到"添加" @ (${addBoxNode.centerX}, ${addBoxNode.centerY}) text=${addBoxNode.text}`);
      await ZBBAutomation.click(addBoxNode.centerX, addBoxNode.centerY);
    } else {
      // V32.36.59 兜底: hardcode px(202, 1269) [nova dump bounds=[90,1152][315,1386] 中心点]
      logger.warn('保利:步骤14-4', 'text/content-desc/Button 都没找到, 兜底用 px(202, 1269) [nova dump]');
      await ZBBAutomation.click(202, 1269);
    }
    // V2 v19.90 D16: Gamma 2000-3500 → 3000-5250 (×1.5 保稳)
    await ZBBAutomation.delay(3000 + Math.floor(Math.random() * 2250));

    // 步骤 14-5: dump 相册选前2张 (V32.36.59 老板 09-21 拍板 - V2 v19.90 D14/D15 反证金标准)
    //   V2 v19.90 D14/D15 老板拍板: 真千机选图算法完全重写
    //     - 原代码: find(/图片|已选图片/.test(text|desc)) + slice(0,2) → 永远找不到 (ImageView 无文字)
    //     - 真千机: 缩略图是 android.widget.ImageView 219x219 网格 3 列 × N 行
    //     - 真千机 rid: gallery_layout_count_tv (计数器 text='1'/'2'/'3')
    //   V2 反证金标准 (L2203-2210 完整代码):
    //     - filter cls='android.widget.ImageView' && w >= 218 && h >= 218
    //     - sort Y升序 + X升序 (左上角最优先)
    //     - slice(0, 2) 取前 2 张
    //   老板铁子反证金标准 (V32.36.59 老板拍板):
    //     - V4 getAllImageNodes (V32.36.48 新方法) 字段: width/height (不是 V2 的 w/h)
    //     - V4 native 限定 40-150 范围太小 (跟 V2 的 218+ 反证金标准不符)
    //     - JS 端做 size filter 补偿 (width >= 200 && height >= 200)
    //     - 兼容大小缩小的旧版相册 (兜底 width >= 100 && height >= 100)
    logger.info('保利:步骤14-5', 'dump Image 节点 + V2 v19.90 D14 过滤 (V32.36.59 老板拍板反证金标准)');
    const imageNodesRaw = await ZBBAutomation.getAllImageNodes();

    // V2 反证金标准 (L2203-2210):
    //   1. 过滤 class='android.widget.ImageView' (V4 native 已做, 不用 JS 过滤)
    //   2. 过滤大小 w >= 218 && h >= 218 (V4 native 限定 40-150, JS 端补 200+ 过滤)
    //   3. 排序 Y升序 + X升序 (左上角最优先)
    //   4. 取前 2 张
    const imageNodes = [...imageNodesRaw]
      .filter((n: any) => n.width >= 200 && n.height >= 200)  // V32.36.59 JS 端补 V2 大小过滤
      .sort((a: any, b: any) => a.centerY - b.centerY || a.centerX - b.centerX);  // V2 v19.90 D14 排序

    // 兜底: 200+ 没找到, 试 100+ (兼容老旧设备/老旧版本相册)
    let selectedImages: any[] = imageNodes.slice(0, 2);
    if (selectedImages.length < 2) {
      logger.warn('保利:步骤14-5', `200+ 过滤只找到 ${imageNodes.length} 张, 试 100+ 兜底`);
      const imageNodesFallback = [...imageNodesRaw]
        .filter((n: any) => n.width >= 100 && n.height >= 100)
        .sort((a: any, b: any) => a.centerY - b.centerY || a.centerX - b.centerX);
      selectedImages = imageNodesFallback.slice(0, 2);
    }

    if (selectedImages.length < 2) {
      logger.warn('保利:步骤14-5', `只找到 ${selectedImages.length} 张图, 需要 2 张 (V32.36.59 老板拍板反证金标准)`);
      logger.warn('保利:步骤14-5', `dump 总 Image 数=${imageNodesRaw.length}, 各 Image size=${JSON.stringify(imageNodesRaw.map((n:any) => ({w:n.width, h:n.height, cls:n.className})))}`);
    }
    for (let i = 0; i < selectedImages.length; i++) {
      const img = selectedImages[i];
      logger.info('保利:步骤14-5', `选中第 ${i + 1}/2 张图 @ (${img.centerX}, ${img.centerY}) size=${img.width}x${img.height} class=${img.className}`);
      await ZBBAutomation.click(img.centerX, img.centerY);
      // 🆕 V32.36.80 老板 09-22 拍板 - 修法:
      //   老板 nova 16:56 log 时间间隔反证: 选 2 张图间隔 2s, 选完图到 dump 发送间隔 5s
      //   老板拍板: 改为 1-2s 随机 (更拟人, 更快, 不浪费 5s)
      //   V2 v19.90 D16 旧值 2250-3750 (×1.5 保稳) 在 nova 上偏长
      await ZBBAutomation.delay(1000 + Math.floor(Math.random() * 1000));
    }
    // 🆕 V32.36.80 老板拍板: 选完2张后等 1-2s 让选图状态刷新 (旧 1500-2500 也偏长)
    await ZBBAutomation.delay(1000 + Math.floor(Math.random() * 1000));

    // 步骤 14-5b: 点"发送" (V32.36.62 老板 09-22 拍板 - 新增步骤)
    //   老板 nova 10:22 实测: 选完2张图后, 实际需要点"发送", 不是直接"完成"
    //   V2 v19.90 D13 老板拍板: 真千机是 "发送" 按钮, 然后等 2-3s 后弹 "完成" 按钮
    //   修法: 插入 14-5b 步骤, dump 找"发送" + click
    logger.info('保利:步骤14-5b', 'dump 找"发送" + 点击 (V32.36.62 老板拍板新增)');
    const sendNodes = await ZBBAutomation.getAllTextNodes();
    let sendNode: any = sendNodes.find((n: any) =>
      n?.text?.toString()?.trim() === '发送' ||
      n?.contentDesc?.toString()?.trim() === '发送'
    );
    if (sendNode) {
      logger.info('保利:步骤14-5b', `找到"发送" @ (${sendNode.centerX}, ${sendNode.centerY})`);
      await ZBBAutomation.click(sendNode.centerX, sendNode.centerY);
    } else {
      // 兜底: hardcode px(540, 2200) [千机底部]
      logger.warn('保利:步骤14-5b', '没找到"发送", 兜底用 px(540, 2200) [千机底部]');
      await ZBBAutomation.click(540, 2200);
    }
    // V32.36.62 老板拍板: 等 2-3s 让"发送"响应 + 弹"完成"按钮
    await ZBBAutomation.delay(2000 + Math.floor(Math.random() * 1000));

    // 步骤 14-6: dump 找"确认" + 点击 (V32.36.64 老板 09-22 拍板 - 修法)
    //   老板 nova 10:33 实测: 步骤 14-6 实际节点是 "确认", 不是 "完成/上传"
    //   老板铁子反证金标准: V32.36.56/62 错位找 "完成/上传", 老板 nova 永远找不到
    //   修法: 改为找 "确认" (老板拍板实测), content-desc 找 "确认" 兜底
    //   🆕 V32.36.65 老板 09-22 拍板: 点"确认"前先打印当前界面 (方便老板看)
    logger.info('保利:步骤14-6', 'dump 找"确认" + 点击 (V32.36.64 老板拍板)');
    const step146StartTexts = await judge.dumpScreenTexts(30);
    logger.info('保利:步骤14-6', `点前 dump 节点数=${step146StartTexts.length}`);
    if (step146StartTexts.length > 0) {
      step146StartTexts.forEach((t, idx) => logger.info('保利:步骤14-6', `  [${idx + 1}] ${t}`));
    }
    const finishNodes = await ZBBAutomation.getAllTextNodes();
    let finishNode: any = finishNodes.find((n: any) =>
      n?.text?.toString()?.trim() === '确认' ||  // V32.36.64 老板拍板: 找"确认"
      n?.contentDesc?.toString()?.trim() === '确认'
    );
    // 兜底: 找 content-desc="确认"
    if (!finishNode) {
      finishNode = finishNodes.find((n: any) =>
        n?.contentDesc?.toString()?.includes('确认')
      );
      if (finishNode) logger.info('保利:步骤14-6', 'text="确认" 没找到, 兜底用 content-desc 包含"确认"');
    }
    if (finishNode) {
      logger.info('保利:步骤14-6', `找到"确认" @ (${finishNode.centerX}, ${finishNode.centerY}) text=${finishNode.text} desc=${finishNode.contentDesc}`);
      await ZBBAutomation.click(finishNode.centerX, finishNode.centerY);
    } else {
      // 兜底 hardcode (老板 nova 实测后填)
      logger.warn('保利:步骤14-6', '未找到"确认", 兜底用 px(540, 2200) [千机底部]');
      await ZBBAutomation.click(540, 2200);
    }
    // 🆕 V32.36.67 老板 09-22 拍板: 点"确认"后等 1.5-2.5s 随机, 让"确认"响应
    const confirmDelay = 1500 + Math.floor(Math.random() * 1000);
    logger.info('保利:步骤14-6', `点"确认"后等 ${confirmDelay}ms (V32.36.67 老板拍板 1.5-2.5s 随机)`);
    await ZBBAutomation.delay(confirmDelay);

    // 🆕 V32.36.65 老板 09-22 拍板: 点"确认"后, 下滑屏幕刷新当前界面
    //   老板铁子反证金标准: 千机列表通常有分页或延迟, 不下滑可能漏看新客户
    //   修法: swipe(540, 800→540, 1800) = 手指从上往下滑 (下滑手势, 内容向上滚 = 刷新)
    // 🆕 V32.36.69 老板 09-22 拍板 - 紧急修法 (老板铁子命中错位再次):
    //   老板铁子反证金标准: V32.36.65 → V32.36.68 都写 '上滑', 实际手势 swipe(540,1800→540,800) 也是上滑手势
    //   老板 nova 11:44 反馈: '需要的是下滑刷新, 不是上滑操作!'
    //   修法: 改 swipe(540, 800, 540, 1800, 500) = 手指从上往下滑 (下滑手势)
    logger.info('保利:步骤14-6', '下滑屏幕刷新当前界面 (V32.36.65 + V32.36.69 老板拍板)');
    await ZBBAutomation.swipe(540, 800, 540, 1800, 500);  // 手指从上往下滑 (下滑手势)
    await ZBBAutomation.delay(1000 + Math.floor(Math.random() * 1000));  // 1-2s 随机
    // 打印刷新后界面
    const step146AfterTexts = await judge.dumpScreenTexts(30);
    logger.info('保利:步骤14-6', `刷新后 dump 节点数=${step146AfterTexts.length}`);
    if (step146AfterTexts.length > 0) {
      step146AfterTexts.forEach((t, idx) => logger.info('保利:步骤14-6', `  [${idx + 1}] ${t}`));
    }
    // V32.36.56 老板拍板: 等 2-3s 让"完成"按钮响应
    await ZBBAutomation.delay(2000 + Math.floor(Math.random() * 1000));

    // 步骤 14-7: Toast 二次确认 (V32.36.56 老板 09-21 拍板 - 实施)
    logger.info('保利:步骤14-7', 'Toast 二次确认 (V32.36.56 老板拍板实施)');
    try {
      await ZBBAutomation.showToast('✅ 已选择 2 张截图并上传');
    } catch (e) {
      logger.warn('保利:步骤14-7', `showToast 异常: ${e}`);
    }

    logger.info('保利:步骤14', '✓ 步骤14 完成 (V32.36.53 V2 反证金标准)');
    return true;
  } catch (e) {
    logger.warn('保利:步骤14', `步骤14 异常: ${e}`);
    return false;
  }
}
