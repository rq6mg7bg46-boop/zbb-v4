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
import { ZBBAutomation } from '@/native';
import type { CustomerInfo } from './qianji';
import { verifyAndRecover } from './verify';
import { logger } from '@/utils/logger';
import { raiseAlert } from '@/services/alert';
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

// ============================================================
// 保利流程主入口
// ============================================================
export async function runBaoliFlow(customer: CustomerInfo): Promise<boolean> {
  logger.info('app', `========== 保利流程开始 (客户=${customer.customerName}) ==========`);

  // 🆕 08-30 老板拍板端路由: QIANJI_READY_BAOLI 状态转换在 runZbbWorkflow 已发
  //   - 历史 (V32.33 及之前): baoli.ts 内部发 QIANJI_READY
  //   - 端路由: 千机端步骤7完成后, runZbbWorkflow 按 customer.projectType 发对应 QIANJI_READY_*
  //   - baoli.ts 不再负责状态转换, 只负责流程本身 (launchApp + step1-step9 + 2 轮)
  //   - 优势: 状态机转换统一在 runZbbWorkflow, baoli.ts 纯端逻辑
  // orchestrator.send 已删除 (08-30 端路由设计)

  try {
    // 第一轮报备
    const round1Ok = await runBaoliRound(customer, 1);
    if (!round1Ok) {
      logger.info('保利', '第一轮报备失败 → 弹窗等老板');
      // 🆕 V32.36.3: 端失败统一弹窗 + 进 UserIntervention (非 Error 状态)
      // 老板 08-31 装机验证: 之前 BAOLI_FAILED → Error 状态卡住, 反息屏 5min 后还触发
      // 期望: 端失败 = 弹窗 + 震动 + "我知道了" 按钮 + 进 UserIntervention
      await raiseAlert('小主,保利流程报备失败(第1轮),请手动处理!');
      orchestrator.send('BAOLI_INTERVENE');
      return false;
    }

    // 第二轮报备
    const round2Ok = await runBaoliRound(customer, 2);
    if (!round2Ok) {
      logger.info('保利', '第二轮报备失败 → 弹窗等老板');
      // 🆕 V32.36.3: 同上
      await raiseAlert('小主,保利流程报备失败(第2轮),请手动处理!');
      orchestrator.send('BAOLI_INTERVENE');
      return false;
    }

    orchestrator.send('BAOLI_COMPLETE'); // BaoliRunning → YuexiuRunning
    logger.info('app', '========== 保利流程完成 ==========');
    return true;
  } catch (error) {
    logger.error('保利', `'流程失败:' ${error}`);
    // 🆕 V32.36.3: 异常也弹窗等老板
    await raiseAlert(`小主,保利流程异常,请手动处理! (${error})`);
    orchestrator.send('BAOLI_INTERVENE');
    return false;
  }
}

// ============================================================
// 保利单轮 (第一轮 + 第二轮 都调这个, round 区分)
// ============================================================
async function runBaoliRound(customer: CustomerInfo, round: 1 | 2): Promise<boolean> {
  logger.info('app', `========== 保利第 ${round} 轮开始 ==========`);

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
  const step13 = await step13DetectResult(round);
  if (!step13) return false;

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

    // 1. V2.x v22.02.33 反证金标准: delay 3000ms 等节点树加载
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
    const screenTexts = await judge.dumpScreenTexts(30);
    if (screenTexts.length === 0) {
      logger.info('保利:步骤4', '当前界面: [空]');
    } else {
      screenTexts.forEach((t, idx) => logger.info('保利:步骤4', `  [${idx + 1}] ${t}`));
    }

    // 3. V2.x BaoliService.ts:718 反证金标准: 精确匹配
    //    V4 V32.36.11 judge.ts:54 反证: getAllTextNodes 穿透 WebView
    const nodes = await ZBBAutomation.getAllTextNodes();
    const projectEntry = nodes.find((n: any) => n.text === '郑州保利山水和颂');

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
    logger.info('保利:步骤6', `第 ${attempt}/2 次查找 input 前等 ${wait}ms (老板 09-20 拍板 1-2s 随机)`);
    await ZBBAutomation.delay(wait);

    inputNode = await a11y.findByViewId('input');
    if (inputNode && inputNode.centerX > 0 && inputNode.centerY > 0) {
      logger.info('保利:步骤6', `第 ${attempt}/2 次找到 "输入框" viewId @ (${inputNode.centerX}, ${inputNode.centerY})`);
      break;
    } else {
      logger.warn('保利:步骤6', `第 ${attempt}/2 次没找到 viewId="input"`);
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
  const ok = await click.byText('确认');
  if (!ok) return false;
  await ZBBAutomation.delay(1500);
  logger.info('保利:步骤9', '✓ 已点确认');
  return true;
}

// ============================================================
// 步骤 10: 点智能识别 (V2.x 步骤 12)
// ============================================================
async function step10SmartRecognition(): Promise<boolean> {
  logger.info('保利:步骤10', '点智能识别...');
  const ok = await click.byText('智能识别');
  if (!ok) {
    logger.info('保利:步骤10', '找不到智能识别');
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
  // V32.36.31 老板 09-20 装机实测 - 修法 (老板拍板 B 方案, 跟 step5 同款):
  //   老板 nova 实测: step11 提交页的"报备"按钮跟 step5 一样是 Button class
  //   V32.36.30 step5 修法已验: dump 找 Button + 兜底 hardcode
  //   老板说"步骤11也需要调整" - 跟 step5 同款修法
  //   修法: 用 getAllTextNodes dump 找带 Button className 的"报备"节点
  //   找不到 → 兜底 hardcode byCoords(449, 2138) (跟 step5 兜底一致, 老板 nova 11:10 dump 实测)
  let ok = false;
  try {
    const nodes = await ZBBAutomation.getAllTextNodes();
    const reportBtn = nodes.find((n: any) =>
      n?.text === '报备' &&
      (n?.className === 'android.widget.Button' || n?.clickable === true) &&
      n.centerX > 0 && n.centerY > 0
    );
    if (reportBtn) {
      logger.info('保利:步骤11', `dump 找到 "报备" Button @ (${reportBtn.centerX}, ${reportBtn.centerY})`);
      ok = await click.byNode(reportBtn);
    } else {
      logger.warn('保利:步骤11', `dump 没找到带 Button 的 "报备", 兜底 hardcode byCoords(449, 2138)`);
      ok = await click.byCoords(449, 2138);  // V32.36.31 兜底 (跟 V32.36.30 step5 一致)
    }
  } catch (e) {
    logger.warn('保利:步骤11', `dump 异常: ${e}, 兜底 byCoords(449, 2138)`);
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

  // V32.36.33 老板 09-20 拍板: 一次性 pGammaDelay(3500, 5000) 等结果页渲染
  //   跟 V2.x BaoliService.ts L1519-1521 v19.75 (老板拍板 3500-5000ms) 一致
  //   真因: V4 之前循环 15s 每 500ms 调 isScreenText 在 WebView 上 getAllTextNodes dump 有问题
  //         老板实测: 进入结果界面了但没检测到 → 直接报错
  //         实际 V2.x 一次 delay 让结果页渲染完, 然后步骤15 一次性 dump 节点判断
  const delayMs = 3500 + Math.floor(Math.random() * 1500);  // 3500-5000ms (V2.x pGammaDelay)
  logger.info('保利:步骤12', `等结果页渲染 ${delayMs}ms (V32.36.33 跟 V2.x pGammaDelay 一致)`);
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
async function step13DetectResult(round: 1 | 2): Promise<boolean> {
  logger.info('保利:步骤13', `检测报备结果 (第 ${round} 轮)...`);

  // V32.36.33 老板 09-20 拍板: 一次性 dump + 多节点匹配 (跟 V2.x BaoliService.ts L1536-1580 一致)
  //   V2.x 实战反证金标准 (08-12 老板拍板 B 修法 v2):
  //     - 报备成功 = '防截客中' (结果页顶部 banner) + '上传附件' (结果页底部按钮) 双节点
  //     - 疑似重号 = '疑似重号' 或 '重复'
  //   V4 之前用 '报备成功'/'重号' 单词判定 → 漏报 → 30s 超时误报
  let nodes: any[] = [];
  try {
    nodes = await ZBBAutomation.getAllTextNodes();
  } catch (e) {
    logger.warn('保利:步骤13', `dump 异常: ${e}`);
    return false;
  }

  // 情况 1: 疑似重号
  const repeatNode = nodes.find((n: any) =>
    n?.text?.toString()?.includes('疑似重号') || n?.text?.toString()?.includes('重复')
  );
  if (repeatNode) {
    logger.info('保利:步骤13-情况1', '疑似重号, 启动震动+弹窗');
    orchestrator.send('BAOLI_INTERVENE');
    return false;
  }

  // 情况 2: 报备成功 (V2.x 老板实战反证金标准 B 修法 v2 - 多节点双匹配)
  const hasFangJieKe = nodes.some(n => n?.text?.toString()?.includes('防截客中'));
  const hasShangChuanFuJian = nodes.some(n => n?.text?.toString()?.includes('上传附件'));
  if (hasFangJieKe && hasShangChuanFuJian) {
    logger.info('保利:步骤13-情况2', `报备成功 (双节点匹配: 防截客中=${hasFangJieKe}, 上传附件=${hasShangChuanFuJian})`);
    logger.info('保利:步骤13-情况2', '报备成功, 上滑 + 等截图');

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
      const images = allNodes.filter((n: any) =>
        n?.className?.toString() === 'android.widget.Image' ||
        n?.className?.toString().endsWith('.ImageView') ||
        n?.type === 'image'  // V32.36.38 native 端用 type='image' 标记
      );
      logger.info('保利:步骤13-情况2', `dump 找到 ${images.length} 个 Image 节点`);

      // V32.36.45 老板 09-20 装机实测 - 诊断 log (老板铁子命中错位, V32.36.44 用 bounds 推算还是 0 个):
      //   老板问: '修复失败, 查找原因'
      //   老板铁子反证: bounds 字段可能也丢了, 或 V32.36.38b native 端 type='image' 节点根本没有 bounds
      //   修法: 加诊断 log 输出第一个 Image 节点的所有 keys, 确认到底丢了哪些字段
      // V32.36.47 老板 09-20 装机实测 - 修法 (老板铁子命中错位, 诊断 log 暴露新 bug):
      //   老板 nova 18:09:47 log 首个 Image 节点 keys: ["clickable","centerX","centerY","type","className","text"]
      //   老板 nova 18:09:47 log 首个 Image 节点数据: {"clickable":false,"centerX":-210,"centerY":344,"type":"image","className":"android.widget.Image","text":""}
      //   老板铁子命中错位: centerX=-210 是负数, Image 节点不在屏幕可见区域 (viewpager offscreen / 隐藏)
      //   真因 1: V32.36.46 build 没装到 nova (老板 nova 还是 V32.36.45 APK, native 字段没生效)
      //   真因 2: 不可见 Image 节点 (centerX<0) 也被算入候选
      //   修法: 1. TS 端过滤掉 centerX<0 || centerY<0 || centerX>screenWidth 的不可见节点
      //         2. 保留 V32.36.46 native 字段 imageWidth/Height (等老板 nova 装 V32.36.46 APK 后验)
      if (images.length > 0) {
        const sample = images[0] as any;
        const keys = Object.keys(sample);
        logger.info('保利:步骤13-情况2', `首个 Image 节点 keys: ${JSON.stringify(keys)}`);
        logger.info('保利:步骤13-情况2', `首个 Image 节点数据: ${JSON.stringify(sample).substring(0, 300)}`);
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
      // V32.36.46 老板 09-20 装机实测 - 修法 (老板铁子命中错位):
      //   V32.36.44 用 bounds 还是 0 个 -> bounds 嵌套 map 也丢了
      //   修法 (老板铁子反证金标准): 用 V32.36.46 native 端 top-level Int 字段 imageWidth/imageHeight
      //     - native 端把 width/height 转成 imageWidth/imageHeight (top-level Int 不嵌套)
      //     - 排序也用 imageTop (top-level Int)
      //     - 1 优先级: imageWidth/imageHeight/imageTop (V32.36.46 native top-level Int)
      //     - 2 fallback: width/height (V32.36.38b 嵌套 map)
      //     - 3 fallback: bounds.right/left/bottom/top (V32.36.44 推算)
      //
      // V32.36.47 老板 09-20 装机实测 - 修法 (老板铁子命中错位 - 诊断 log 暴露新 bug):
      //   老板 nova 18:09:47 log: 首个 Image centerX=-210 (负数, 不可见)
      //   真因: viewpager offscreen / 隐藏 Image 节点, 跟 screen 无关
      //   修法: 过滤 centerX < 0 || centerY < 0 || centerX > screenWidth || centerY > screenHeight
      //   V32.36.45 老板铁子错位: 没过滤负坐标, 老板 nova 25 个 Image 里有不可见节点
      //   V32.36.47 老板铁子反证金标准: 修过滤逻辑
      const screenW = screenWidthDp() * 3;  // nova 480dpi = 1dp=3px
      const screenH = screenHeightDp() * 3;
      const qrCandidates = images.filter((n: any) => {
        // V32.36.47 过滤掉不可见的 Image 节点 (centerX/Y 异常)
        if (typeof n.centerX === 'number' && (n.centerX < 0 || n.centerX > screenW)) return false;
        if (typeof n.centerY === 'number' && (n.centerY < 0 || n.centerY > screenH)) return false;

        // V32.36.46 优先用 top-level Int 字段 (RN bridge 友好)
        let w = (n as any).imageWidth ?? 0;
        let h = (n as any).imageHeight ?? 0;
        if (w === 0 || h === 0) {
          // fallback 1: V32.36.38b 嵌套 map 字段
          w = (n as any).width ?? 0;
          h = (n as any).height ?? 0;
        }
        if (w === 0 || h === 0) {
          // fallback 2: V32.36.44 bounds 推算
          const bounds = (n as any).bounds;
          if (bounds && typeof bounds === 'object') {
            w = (bounds.right ?? 0) - (bounds.left ?? 0);
            h = (bounds.bottom ?? 0) - (bounds.top ?? 0);
          }
        }
        if (w === 0 || h === 0) return false;  // 排除占位
        // 二维码特征: 接近正方形 (aspect ratio 0.85-1.15)
        const aspectRatio = w / h;
        const isSquareLike = aspectRatio >= 0.85 && aspectRatio <= 1.15;
        // 尺寸范围: 50-300 px (二维码通常 84-200)
        const isRightSize = w >= 50 && w <= 300 && h >= 50 && h <= 300;
        return isSquareLike && isRightSize;
      });
      logger.info('保利:步骤13-情况2', `二维码候选 (aspect 0.85-1.15 + 尺寸 50-300 + 可见过滤): ${qrCandidates.length} 个 (V32.36.47)`);

      // 老板反证金标准 #3: 按 Y 升序排序 (bounds.top 越小越靠上 = 最新报备)
      // V32.36.46 优先 imageTop (top-level Int), fallback bounds.top
      qrCandidates.sort((a: any, b: any) => {
        const aTop = (a as any).imageTop ?? (a as any).bounds?.top ?? a.centerY;
        const bTop = (b as any).imageTop ?? (b as any).bounds?.top ?? b.centerY;
        return aTop - bTop;
      });

      // 老板反证金标准 #4: 点第一个 (Y 最小 = 最新报备), 零抖动
      if (qrCandidates.length > 0) {
        const firstQr = qrCandidates[0];
        logger.info('保利:步骤13-情况2', `Y 最小二维码 @ (${firstQr.centerX}, ${firstQr.centerY}) (老板反证金标准最新报备)`);
        await ZBBAutomation.click(firstQr.centerX, firstQr.centerY);  // 零抖动
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
    //   修法: V4 调 native threeFingerSwipeDown (需要 native 端实现) - 先 try/catch, 失败不阻塞
    //   注: nova 上三指下滑可能不生效 (V2.x 老板实战反证), 但老板拍板加上, 失败就让老板手动截图
    logger.info('保利:步骤13-情况2', '三指下滑触发系统截图 (V32.36.35 V2.x 同款 v21.17)');
    let swipeSuccess = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt > 1) {
          logger.info('保利:步骤13-情况2', `第 ${attempt}/2 次三指下滑 (V32.36.35 V2.x v21.22 retry)`);
          await ZBBAutomation.delay(500);
        }
        // V32.36.35 native 端需要 threeFingerSwipeDown (V2.x 同款)
        // 暂时调 swipeDownPPlus 模拟 (P+ 拟人化下滑, 28% → 84%)
        // 老板 nova 装机实测 V32.36.36+ 加 threeFingerSwipeDown native API
        await scrollDownPPlus();
        swipeSuccess = true;
        logger.info('保利:步骤13-情况2', `三指下滑 / 模拟下滑成功 (第 ${attempt}/2 次)`);
        break;
      } catch (e) {
        logger.warn('保利:步骤13-情况2', `第 ${attempt}/2 次三指下滑失败: ${e}`);
      }
    }
    if (!swipeSuccess) {
      logger.warn('保利:步骤13-情况2', '三指下滑 2 次都失败 (V2.x nova 实战反证 - 老板手动截图)');
    }

    // 情况 2-4: 等截图保存 + 老板手动截图兜底
    logger.info('保利:步骤13-情况2', '等待截图保存 (V2.x v21.17 5000ms)');
    await ZBBAutomation.delay(5000);

    // V32.36.43 老板 09-20 装机实测 - 修法 (老板拍板 B):
    //   老板问: 'tap 返回键 返回的是哪个界面?'
    //   老板铁子反证: 报备结果页 → pressKey.back() → 项目详情页 (跟 V2.x v22.02.24 反证金标准一致)
    //                  但 V32.36.42 第二轮逻辑假设'页面已经在项目详情页', 如果多按返回键会跳出项目页
    //   修法: 按返回键 + dump 验证是否在项目详情页 (有项目名 + '报备' 按钮)
    //     - 最多按 2 次 (防跳出项目页)
    //     - 每次按完 dump 验证, 没找到项目页 → 退出 (让 V32.36.42 第二轮 fail 报错)
    //   V2.x 反证金标准: v22.02.24 (08-12 老板拍板) - '不按返回键, 让用户在保利小程序继续操作下一轮'
    //                    但 V32.36.42 第二轮需要页面在项目详情页, 所以保留按返回键 (跟 V2.x 不同)
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
        logger.info('保利:步骤13-情况2', `✓ 按返回键 ${backCount} 次后到达项目详情页 (V32.36.43 老板拍板 B)`);
        break;
      } else {
        logger.warn('保利:步骤13-情况2', `按返回键 ${backCount} 次, 未到项目详情页 (报备按钮=${hasReportBtn}, 项目名=${hasProjectName})`);
      }
    }
    if (!onProjectPage) {
      logger.warn('保利:步骤13-情况2', '按 3 次返回键都没到项目详情页 (V32.36.43 老板拍板 B - 让 V32.36.42 第二轮 fail)');
    }

    return true;
  }

  logger.info('保利:步骤13', '未知状态');
  return false;
}
