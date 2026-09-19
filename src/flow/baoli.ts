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
import { scrollUpPPlus, scrollDownPPlus, pPlusDelay } from '@/utils/PPlusSwipe'; // 🆕 V32.36.11 P+ 拟人化 (V2.x BaoliService 反证)

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
  const step8 = await step8SelectProject(projectName);
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
  const ok = await click.byText('报备');
  if (!ok) {
    logger.info('保利:步骤5', '找不到报备按钮');
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

  // 写剪贴板
  await ZBBAutomation.setClipboardText(
    `${customer.customerName} ${customer.customerGender} ${customer.phoneLast4}`
  );

  // 找"粘贴完整客户信息..."节点
  const pasteNode = await a11y.findByText('粘贴');
  if (!pasteNode) {
    logger.info('保利:步骤6', '找不到粘贴节点');
    return false;
  }

  // 长按输入框 3000ms (老板实测)
  const inputNode = await a11y.findByViewId('input') || pasteNode;
  await longPress.byNode(inputNode, 3000);
  await ZBBAutomation.delay(1500);

  // tap 粘贴
  const pasteOk = await click.byText('粘贴');
  if (!pasteOk) {
    logger.info('保利:步骤6', 'tap 粘贴失败');
    return false;
  }

  // 等粘贴菜单 (500ms 动画)
  await ZBBAutomation.delay(500);
  logger.info('保利:步骤6', '✓ 客户信息已粘贴');
  return true;
}

// ============================================================
// 步骤 7: 点"请选择分期" (V2.x 步骤 9)
// ============================================================
async function step7SelectInstallment(): Promise<boolean> {
  logger.info('保利:步骤7', '点请选择分期...');
  const ok = await click.byText('请选择分期');
  if (!ok) {
    logger.info('保利:步骤7', '找不到分期选项');
    return false;
  }
  await ZBBAutomation.delay(1500);
  logger.info('保利:步骤7', '✓ 已点分期');
  return true;
}

// ============================================================
// 步骤 8: 选择报备项目 (V2.x 步骤 10, 再确认一次)
// ============================================================
async function step8SelectProject(projectName: string): Promise<boolean> {
  logger.info('保利:步骤8', `选择报备项目: ${projectName}...`);
  const ok = await click.byText(projectName);
  if (!ok) return false;
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
  const ok = await click.byText('报备');
  if (!ok) return false;
  await ZBBAutomation.delay(2000);
  logger.info('保利:步骤11', '✓ 已点报备');
  return true;
}

// ============================================================
// 步骤 12: 等待报备结果 (V2.x 步骤 14)
// ============================================================
async function step12WaitResult(): Promise<boolean> {
  logger.info('保利:步骤12', '等待报备结果...');

  // 等"报备成功"或"重号"出现
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await judge.isScreenText('报备成功')) return true;
    if (await judge.isScreenText('重号')) return true;
    await ZBBAutomation.delay(500);
  }

  logger.info('保利:步骤12', '超时 15s');
  return false;
}

// ============================================================
// 步骤 13: 检测报备结果 (V2.x 步骤 15)
// 实测: 情况 1=重号 → 老板介入, 情况 2=成功 → 上滑 + 上传附件 + 等截图
// ============================================================
async function step13DetectResult(round: 1 | 2): Promise<boolean> {
  logger.info('保利:步骤13', `检测报备结果 (第 ${round} 轮)...`);

  // 情况 1: 重号
  if (await judge.isScreenText('重号')) {
    logger.info('保利:步骤13-情况1', '疑似重号, 启动震动+弹窗');
    orchestrator.send('BAOLI_INTERVENE'); // 老板介入
    return false;
  }

  // 情况 2: 成功
  if (await judge.isScreenText('报备成功')) {
    logger.info('保利:步骤13-情况2', '报备成功, 上滑 + 等截图');

    // 情况 2-1: 上滑屏幕 (V32.36.11 老板 09-02 修, 改 humanSwipeWithBounceDp)
    //   V2.x 反证 client/services/BaoliService.ts L178-189 humanSwipeWithBounceDp (P+ 拟人化)
    //   V2.x v22.02.30 老板装机实测 swipe (dispatchGesture) 在企微 OK
    //   V4 V32.36.9 swipeShell 老板装机实测失败 → 改回 V2.x 同款
    //   duration 主滑 1000ms (慢一点, 等截图动画) + 回弹 300ms
    const swipeOk = await scrollUpPPlus();  // 默认 500ms 起步
    logger.info('保利:步骤13-情况2', `humanSwipeWithBounceDp 上滑结果: ${swipeOk}`);

    // 情况 2-2: 找"上传附件"坐标
    const uploadNode = await a11y.findByText('上传附件');
    if (uploadNode && uploadNode.centerX !== undefined && uploadNode.centerY !== undefined) {
      await click.byCoords(uploadNode.centerX + 500, uploadNode.centerY);
    }

    // 情况 2-3: 等待老板截图
    logger.info('保利:步骤13-情况2-3', '等待老板截图...');
    await ZBBAutomation.delay(5000);

    // tap 返回键
    await pressKey.back();

    return true;
  }

  logger.info('保利:步骤13', '未知状态');
  return false;
}
