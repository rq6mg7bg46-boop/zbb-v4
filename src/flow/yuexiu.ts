/**
 * V4 越秀端流程 (V32.36.112 老板 09-24 拍板 - 应用 6 点反馈)
 *
 * 老板拍板 V32.36.112 (基于老板 6 点反馈):
 *   1. 千机端复用现有流程, 只在关键步骤 (千机步骤 5 项目类型判断) 做调整
 *   2. 越秀步骤编号从 1 开始 (独立编号, 不延续千机步骤 8)
 *   3. 补充 V2 步骤 5.5 B 方案 (查找"推荐购房"+"查看更多"有 A/B 两种情况)
 *   4. dump + 取客户节点顺序: 先粘贴电话 → 从数据库拿客户姓名 → 再粘贴姓名
 *      确认: V2 步骤 9.5 从 DB 拿客户, V4 由 Orchestrator 端路由传 customer (统一机制)
 *   5. 清理用 V4 滑动刷新替代 V2 exitMiniProgram (老板 09-13 实战反证)
 *   6. 越秀 + 保利共用 V4 expo-sqlite, 客户只写一次 (千机步骤 6 写库, 越秀步骤 14 只更新)
 */

import { orchestrator } from '@/core/stateMachine';
import { click, longPress, judge, pressKey, swipe } from '@/operations';
import { ZBBAutomation } from '@/native';
import { logger } from '@/utils/logger';
import { raiseAlert } from '@/services/alert';
import { markReportDone } from '@/services/database';
import { findWithRecovery } from './retryUtils';
import { verifyAndRecover } from './verify';
import { guessGenderFromName } from './q1q2Logic';
import { runZbbWorkflowAuto } from './index';
import type { CustomerInfo } from './qianji';
import { px, centerXDp } from '@/utils/DpUtil';
import { qianjiPackage, qianjiMainActivity } from '@/config/env';

const APP_PACKAGES = {
  WECHAT_WORK: 'com.tencent.wework',
};

const YUEXIU_MINIAPP_FALLBACK_Y_DP = 400;
const FALLBACK_RECOMMEND_TAB_X_DP = 32.4;
const FALLBACK_RECOMMEND_TAB_Y_DP = 249.5;
const FALLBACK_VIEW_BTN_X_DP = 130.9;
const FALLBACK_VIEW_BTN_Y_DP = 331.6;

// ============================================================
// 越秀流程主入口
// ============================================================
export async function runYuexiuFlow(customer: CustomerInfo): Promise<boolean> {
  logger.info('app', `========== 越秀流程开始 (客户=${customer.customerName}) ==========`);

  try {
    if (!await yuexiuStep1OpenWechat()) throw new Error('越秀:1 打开企业微信失败');
    if (!await yuexiuStep2ClickWorkbench()) throw new Error('越秀:2 找不到工作台');
    if (!await yuexiuStep3FindYuexiuMiniApp()) throw new Error('越秀:3 找不到越秀地产悦秀会');
    await yuexiuStep4WaitMiniAppLoad();

    const mode = await yuexiuStep5CheckViewMore();
    if (mode === 'A') {
      if (!await yuexiuStep6AClickViewMore()) throw new Error('越秀:6A 点查看更多失败');
    } else {
      if (!await yuexiuStep6BFallback()) throw new Error('越秀:6B 兜底流程失败');
    }

    if (!await yuexiuStep7ClickRecommend()) throw new Error('越秀:7 找不到去推荐');

    const verifyOk = await yuexiuStep8VerifyRecommendPage();
    if (!verifyOk) logger.warn('越秀:8', '验证推荐页失败 (best-effort, 继续)');

    // 越秀:9 dump + 取客户 (Orchestrator 已传 customer)
    logger.info('越秀:9', `dump 界面 + 取客户 (来自 Orchestrator): ${customer.customerName} ${customer.phoneLast4}`);

    if (!await yuexiuStep10InputPhone(customer)) throw new Error('越秀:10 输入手机号失败');
    if (!await yuexiuStep11InputName(customer)) throw new Error('越秀:11 输入姓名失败');
    if (!await yuexiuStep12SelectGender(customer)) logger.warn('越秀:12', '选性别失败 (best-effort, 继续)');

    const inputOk = await yuexiuStep13VerifyInput(customer);
    if (!inputOk) logger.warn('越秀:13', '验证输入内容失败 (best-effort, 继续)');

    if (!await yuexiuStep14ClickSubmit()) throw new Error('越秀:14 点立即推荐失败');

    const baobeiMode = await yuexiuStep15DetectResult(customer);
    if (baobeiMode === 'timeout') throw new Error('越秀:15 报备结果超时');

    const feedbackOk = await yuexiuStep16Feedback(customer, baobeiMode);
    if (!feedbackOk) throw new Error('越秀:16 一致性校验失败');

    await yuexiuStep17CleanupAndComplete();

    return true;
  } catch (error: any) {
    logger.error('越秀', `'流程失败:' ${error}`);
    await raiseAlert(`小主,越秀流程异常,请手动处理! (${error})`, 30000, true);
    orchestrator.send('YUEXIU_INTERVENE');
    return false;
  }
}

// 越秀:1 打开企业微信
async function yuexiuStep1OpenWechat(): Promise<boolean> {
  logger.info('越秀:1', '打开企业微信');
  try {
    await ZBBAutomation.launchApp(APP_PACKAGES.WECHAT_WORK);
    await ZBBAutomation.delay(3000);
    return true;
  } catch (e: any) {
    logger.warn('越秀:1', `launchApp 失败, 重试: ${e}`);
    try {
      await ZBBAutomation.delay(1000);
      await ZBBAutomation.launchApp(APP_PACKAGES.WECHAT_WORK);
      await ZBBAutomation.delay(3000);
      return true;
    } catch (e2: any) {
      logger.error('越秀:1', `launchApp 2 次都失败: ${e2}`);
      return false;
    }
  }
}

// 越秀:2 点击"工作台" (V32.36.108 跨端复用: 2 次查找 + 1-2s 随机)
async function yuexiuStep2ClickWorkbench(): Promise<boolean> {
  logger.info('越秀:2', '点击工作台...');
  let ok = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    ok = await click.byText('工作台');
    if (ok) break;
    const wait = 1000 + Math.floor(Math.random() * 1000);
    logger.warn('越秀:2', `第 ${attempt}/2 次没找到工作台, 等 ${wait}ms 重试`);
    await ZBBAutomation.delay(wait);
  }
  if (!ok) {
    logger.info('越秀:2', '找不到工作台');
    return false;
  }
  await ZBBAutomation.delay(2000);
  return true;
}

// 越秀:3 查找"越秀地产悦秀会" (5 次循环上滑)
async function yuexiuStep3FindYuexiuMiniApp(): Promise<boolean> {
  logger.info('越秀:3', '查找越秀地产悦秀会...');
  await ZBBAutomation.delay(4000 + Math.random() * 2000);

  let ok = await findWithRecovery('越秀:3 首次', async () => click.byText('越秀地产悦秀会'));
  if (ok) {
    logger.info('越秀:3', '找到越秀地产悦秀会 (attempt=1)');
    await ZBBAutomation.delay(3000 + Math.random() * 1000);
    return true;
  }

  for (let i = 0; i < 5; i++) {
    logger.info('越秀:3', `第 ${i + 1} 次上滑后查找越秀地产悦秀会`);
    await swipe.up();
    await ZBBAutomation.delay(2000 + Math.random() * 500);
    ok = await findWithRecovery(`越秀:3 第${i+1}次`, async () => click.byText('越秀地产悦秀会'));
    if (ok) {
      logger.info('越秀:3', `第 ${i + 1} 次上滑后找到越秀地产悦秀会`);
      await ZBBAutomation.delay(3000 + Math.random() * 1000);
      return true;
    }
  }

  // 兜底: dp(180, 400) → click.byCoords 接 dp
  logger.warn('越秀:3', `5 次循环都未找到, 兜底用 dp(${centerXDp()}, ${YUEXIU_MINIAPP_FALLBACK_Y_DP})`);
  await click.byCoords(centerXDp(), YUEXIU_MINIAPP_FALLBACK_Y_DP);
  await ZBBAutomation.delay(3000 + Math.random() * 1000);
  return true;  // 兜底当成功, 让后续步骤验证
}

// 越秀:4 等小程序首页渲染 (V2 步骤5 verifyAndRecover 老板 09-13 拍板禁跑, V4 跳过)
async function yuexiuStep4WaitMiniAppLoad(): Promise<boolean> {
  logger.info('越秀:4', '等小程序首页渲染 (V2 步骤5 verifyAndRecover 老板 09-13 拍板禁跑)');
  await ZBBAutomation.delay(3000 + Math.random() * 1000);
  return true;
}

// 越秀:5 检索"推荐购房"+"查看更多" (A/B 方案分支) V2 步骤 5.5
async function yuexiuStep5CheckViewMore(): Promise<'A' | 'B'> {
  logger.info('越秀:5', '检索"推荐购房"+"查看更多" (V32.36.112 A/B 方案)');
  await ZBBAutomation.delay(2000);

  const nodes = await ZBBAutomation.getAllTextNodes();
  const allText = nodes.map(n => n.text || '').join('|');
  const hasRecommendPurchase = allText.includes('推荐购房');
  const hasViewMoreBtn = allText.includes('查看更多');

  logger.info('越秀:5', `has推荐购房=${hasRecommendPurchase}, has查看更多=${hasViewMoreBtn}`);

  if (hasRecommendPurchase && hasViewMoreBtn) {
    logger.info('越秀:5', '情况A → 6A');
    return 'A';
  }
  logger.info('越秀:5', '情况B → 6B');
  return 'B';
}

// 越秀:6A 情况A: 点"查看更多"
async function yuexiuStep6AClickViewMore(): Promise<boolean> {
  logger.info('越秀:6A', '点"查看更多" (情况A)');
  await ZBBAutomation.delay(2000);
  return await findWithRecovery('越秀:6A', async () => click.byText('查看更多'));
}

// 越秀:6B 情况B: 兜底流程 "推荐赚佣"→ 弹窗"前往查看"
async function yuexiuStep6BFallback(): Promise<boolean> {
  logger.info('越秀:6B', '兜底流程: 点"推荐赚佣"→ 弹窗"前往查看" (V2 步骤5.6-5.9)');

  logger.info('越秀:6B-1', `点"推荐赚佣" dp(${FALLBACK_RECOMMEND_TAB_X_DP}, ${FALLBACK_RECOMMEND_TAB_Y_DP})`);
  await click.byCoords(FALLBACK_RECOMMEND_TAB_X_DP, FALLBACK_RECOMMEND_TAB_Y_DP);

  const delay1 = 1000 + Math.floor(Math.random() * 1000);
  logger.info('越秀:6B-2', `等弹窗 ${delay1}ms`);
  await ZBBAutomation.delay(delay1);

  logger.info('越秀:6B-3', `点弹窗"前往查看" dp(${FALLBACK_VIEW_BTN_X_DP}, ${FALLBACK_VIEW_BTN_Y_DP})`);
  await click.byCoords(FALLBACK_VIEW_BTN_X_DP, FALLBACK_VIEW_BTN_Y_DP);

  const delay2 = 1000 + Math.floor(Math.random() * 1000);
  await ZBBAutomation.delay(delay2);
  const nodes = await ZBBAutomation.getAllTextNodes();
  logger.info('越秀:6B-4', `点击后 dump 节点数=${nodes.length}`);
  return true;
}

// 越秀:7 点"去推荐" (Y值最大)
async function yuexiuStep7ClickRecommend(): Promise<boolean> {
  logger.info('越秀:7', '点"去推荐" (Y值最大)');
  const nodes = await ZBBAutomation.getAllTextNodes();
  const recommendNodes = nodes.filter((n: any) => n.text === '去推荐' && n.centerX && n.centerY);
  if (recommendNodes.length === 0) {
    logger.warn('越秀:7', '未找到"去推荐"');
    return false;
  }
  const target = recommendNodes.reduce((max: any, n: any) =>
    (n.centerY ?? 0) > (max.centerY ?? 0) ? n : max
  );
  logger.info('越秀:7', `找到"去推荐" @ (${target.centerX}, ${target.centerY}), 点击`);
  await click.byNode(target);
  await ZBBAutomation.delay(2000);
  return true;
}

// 越秀:8 验证推荐页 (V2 步骤 8.5 verifyAndRecover)
async function yuexiuStep8VerifyRecommendPage(): Promise<boolean> {
  logger.info('越秀:8', '验证推荐页 fingerprint (V2 步骤 8.5 verifyAndRecover)');
  try {
    const nodes = await ZBBAutomation.getAllTextNodes();
    const result = await verifyAndRecover('推荐赚佣', { maxRetries: 1, timeoutMs: 5000 });
    if (result.ok) {
      logger.info('越秀:8', '验证推荐页 ✓');
      return true;
    }
    logger.warn('越秀:8', `验证推荐页失败: ${result.reason || 'unknown'}`);
    return false;
  } catch (e: any) {
    logger.warn('越秀:8', `verifyAndRecover 异常: ${e}`);
    return false;
  }
}

// 越秀:10 输入手机号 (longPress 粘贴, V32.36.104 2-2.5s 随机)
async function yuexiuStep10InputPhone(customer: CustomerInfo): Promise<boolean> {
  logger.info('越秀:10', `输入手机号 (longPress 粘贴): ${customer.phoneLast4}`);

  // 找手机号输入框 (优先 "请输入手机号" → fallback "手机号")
  let ok = await findWithRecovery('越秀:10', async () => click.byText('请输入手机号'));
  if (!ok) {
    logger.warn('越秀:10', '未找到"请输入手机号", 尝试"手机号"');
    ok = await findWithRecovery('越秀:10 alt', async () => click.byText('手机号'));
    if (!ok) {
      logger.error('越秀:10', '未找到手机号输入框');
      return false;
    }
    await longPress.byText('手机号', 1500);
  } else {
    await longPress.byText('请输入手机号', 1500);
  }

  const pasteMenuDelay = 2000 + Math.floor(Math.random() * 500);
  logger.info('越秀:10', `等粘贴菜单 ${pasteMenuDelay}ms (V32.36.104 2-2.5s 随机)`);
  await ZBBAutomation.delay(pasteMenuDelay);

  return await click.byText('粘贴');
}

// 越秀:11 输入姓名
async function yuexiuStep11InputName(customer: CustomerInfo): Promise<boolean> {
  logger.info('越秀:11', `输入姓名: ${customer.customerName}`);
  let ok = await findWithRecovery('越秀:11', async () => click.byText('请输入姓名'));
  if (!ok) {
    logger.warn('越秀:11', '未找到"请输入姓名", 尝试"姓名"');
    ok = await findWithRecovery('越秀:11 alt', async () => click.byText('姓名'));
    if (!ok) {
      logger.error('越秀:11', '未找到姓名输入框');
      return false;
    }
  }
  await ZBBAutomation.delay(500);
  logger.info('越秀:11', `已点击姓名输入框, 等 native input 输入 ${customer.customerName}`);
  await ZBBAutomation.delay(1000);
  return true;
}

// 越秀:12 选性别 (3 层判断 - 末字字典 + 兜底男)
async function yuexiuStep12SelectGender(customer: CustomerInfo): Promise<boolean> {
  logger.info('越秀:12', `选性别: ${customer.customerName}`);
  const gender = guessGenderFromName(customer.customerName);
  const genderText = gender === 'female' ? '女' : '男';  // unknown → 兜底男
  logger.info('越秀:12', `推断 ${gender} → 选"${genderText}"`);
  return await click.byText(genderText);
}

// 越秀:13 验证输入内容
async function yuexiuStep13VerifyInput(customer: CustomerInfo): Promise<boolean> {
  logger.info('越秀:13', '验证输入内容 (姓名 + 手机号末4)');
  const nodes = await ZBBAutomation.getAllTextNodes();
  const nameFound = nodes.some((n: any) => n.text === customer.customerName);
  const phoneFound = nodes.some((n: any) => n.text?.endsWith(customer.phoneLast4 || ''));
  logger.info('越秀:13', `姓名"${customer.customerName}" ${nameFound ? '✓' : '✗'}, 手机号末4"${customer.phoneLast4}" ${phoneFound ? '✓' : '✗'}`);
  return nameFound && phoneFound;
}

// 越秀:14 点"立即推荐"
async function yuexiuStep14ClickSubmit(): Promise<boolean> {
  logger.info('越秀:14', '点"立即推荐"');
  return await findWithRecovery('越秀:14', async () => click.byText('立即推荐'));
}

// 越秀:15 检测报备结果 + 更新 DB (V32.36.52 markReportDone)
async function yuexiuStep15DetectResult(customer: CustomerInfo): Promise<'valid' | 'invalid' | 'timeout'> {
  logger.info('越秀:15', '检测报备结果 (3 路分支)');
  await ZBBAutomation.delay(3000);

  let baobeiMode: 'valid' | 'invalid' | 'timeout' = 'timeout';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const nodes = await ZBBAutomation.getAllTextNodes();
    if (nodes.some((n: any) => n.text?.includes('报备有效'))) {
      baobeiMode = 'valid';
      logger.info('越秀:15', `第 ${attempt}/3 次检测到"报备有效"`);
      break;
    }
    if (nodes.some((n: any) => n.text?.includes('报备无效') || n.text?.includes('重号'))) {
      baobeiMode = 'invalid';
      logger.info('越秀:15', `第 ${attempt}/3 次检测到"报备无效"`);
      break;
    }
    logger.info('越秀:15', `第 ${attempt}/3 次未检测到, 等 1.5s`);
    await ZBBAutomation.delay(1500);
  }

  // V32.36.112 反馈 6: 越秀 + 保利共用 expo-sqlite, markReportDone 复用 V32.36.52
  // 注意: CustomerInfo 没有 reportId 字段, 用 reportIds[0] (跟 baoli 同款)
  try {
    const reportId = customer.reportIds?.[0];
    if (reportId !== undefined) {
      if (baobeiMode === 'valid') {
        await markReportDone(reportId, 'done');
        logger.info('越秀:15', `markReportDone(${reportId}) ✓ done`);
      } else if (baobeiMode === 'invalid') {
        await markReportDone(reportId, '重号');
        logger.info('越秀:15', `markReportDone(${reportId}) ✓ 重号`);
      } else {
        logger.warn('越秀:15', 'timeout, 不写 DB');
      }
    } else {
      logger.warn('越秀:15', 'CustomerInfo.reportIds 为空, 跳过 markReportDone');
    }
  } catch (e: any) {
    logger.warn('越秀:15', `markReportDone 异常 (best-effort): ${e}`);
  }

  return baobeiMode;
}

// 越秀:16 反馈 (拉千机 + 一致性校验 + 点"报备有效/无效" + 自动 Dialog)
async function yuexiuStep16Feedback(customer: CustomerInfo, baobeiMode: 'valid' | 'invalid'): Promise<boolean> {
  logger.info('越秀:16', `反馈 (baobeiMode=${baobeiMode})`);

  // 越秀:16-A: 返回 + Home
  logger.info('越秀:16-A', 'tap 返回 + Home (V2 v22.02.12 实战反证)');
  try {
    await pressKey.back();
    await ZBBAutomation.delay(1000);
  } catch (e: any) {
    logger.warn('越秀:16-A', `pressKey.back 异常 (best-effort): ${e}`);
  }
  try {
    await pressKey.home();
    await ZBBAutomation.delay(1500);
  } catch (e: any) {
    logger.warn('越秀:16-A', `pressKey.home 异常 (best-effort): ${e}`);
  }

  // 越秀:16-B: 拉起千机
  logger.info('越秀:16-B', '打开千机 (launchAppWithAmStart)');
  try {
    const pkg = qianjiPackage();
    const act = qianjiMainActivity();
    const launchWithAm = (ZBBAutomation as any).launchAppWithAmStart ?? ZBBAutomation.launchApp;
    await launchWithAm(pkg, act);
    await ZBBAutomation.delay(5000);
  } catch (e: any) {
    logger.error('越秀:16-B', `launchAppWithAmStart 失败: ${e}`);
    return false;
  }

  // 越秀:16-前置: 一致性校验
  logger.info('越秀:16-前置', '一致性校验: 姓名 + 手机号末4');
  const nodes = await ZBBAutomation.getAllTextNodes();
  const nameFound = nodes.some((n: any) => n.text === customer.customerName);
  const phoneFound = nodes.some((n: any) => n.text?.endsWith(customer.phoneLast4 || ''));
  logger.info('越秀:16-前置', `姓名"${customer.customerName}" ${nameFound ? '✓' : '✗'}, 手机号末4"${customer.phoneLast4}" ${phoneFound ? '✓' : '✗'}`);

  if (!nameFound || !phoneFound) {
    logger.error('越秀:16-前置', '✗ 一致性校验失败, 弹 Dialog');
    await raiseAlert('小主，这个客户和已经报备的不一致，请核对！', 30000, true);
    return false;  // 让 catch 走 raiseAlert + YUEXIU_INTERVENE
  }
  logger.info('越秀:16-前置', '✓ 一致性校验通过');

  // 越秀:16-B: 找"报备有效" / "报备无效"
  const buttonText = baobeiMode === 'invalid' ? '报备无效' : '报备有效';
  logger.info('越秀:16-B', `找"${buttonText}"`);
  const ok = await findWithRecovery('越秀:16-B', async () => click.byText(buttonText));
  if (ok) {
    logger.info('越秀:16-B', `已点"${buttonText}"`);
  } else {
    logger.warn('越秀:16-B', `未找到"${buttonText}", 跳过`);
  }

  // 越秀:16-B2: 自动处理 Dialog
  await ZBBAutomation.delay(2000);
  if (baobeiMode === 'valid') {
    logger.info('越秀:16-B2', '找"确定" (报备有效 Dialog)');
    const confirmOk = await click.byText('确定');
    if (confirmOk) {
      await ZBBAutomation.delay(2000);
    } else {
      logger.warn('越秀:16-B2', '未找到"确定"');
    }
  } else {
    logger.info('越秀:16-B2', '找"客户在开发商系统已存在" (报备无效 Dialog)');
    const reasonOk = await click.byText('客户在开发商系统已存在');
    if (reasonOk) {
      await ZBBAutomation.delay(1000);
      logger.info('越秀:16-B3', '找"提交"');
      const submitOk = await click.byText('提交');
      if (submitOk) {
        await ZBBAutomation.delay(2000);
      } else {
        logger.warn('越秀:16-B3', '未找到"提交"');
      }
    } else {
      logger.warn('越秀:16-B2', '未找到"客户在开发商系统已存在"');
    }
  }

  return true;
}

// 越秀:17 清理 (V4 下滑刷新替代 V2 exitMiniProgram) + YUEXIU_COMPLETE + inline hook
async function yuexiuStep17CleanupAndComplete(): Promise<void> {
  logger.info('越秀:17', '清理 (V4 下滑刷新替代 V2 exitMiniProgram, V32.36.65+69 老板拍板)');

  // 越秀:17-A: 下滑刷新当前界面
  logger.info('越秀:17-A', '下滑屏幕刷新当前界面 (V32.36.65+69 + V32.36.96 老板拍板)');
  await ZBBAutomation.swipe(px(180), px(267), px(180), px(600), 500);
  await ZBBAutomation.delay(1000 + Math.floor(Math.random() * 1000));
  const nodes = await ZBBAutomation.getAllTextNodes();
  logger.info('越秀:17-A', `刷新后 dump 节点数=${nodes.length}`);

  // 越秀:17-B: YUEXIU_COMPLETE
  orchestrator.send('YUEXIU_COMPLETE');
  logger.info('app', '========== 越秀流程完成 ==========');

  // 越秀:17-C: inline hook 调下一组 (V32.36.111 移植)
  logger.info('越秀', '越秀完成 → 调 runZbbWorkflowAuto 检测下一组 (V32.36.112 老板拍板)');
  try {
    const autoResult = await runZbbWorkflowAuto();
    logger.info('越秀', `runZbbWorkflowAuto 完成: totalRuns=${autoResult.totalRuns}`);
  } catch (autoErr: any) {
    logger.warn('越秀', `runZbbWorkflowAuto 异常 (best-effort): ${autoErr}`);
  }
}
