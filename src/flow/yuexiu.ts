/**
 * V4 越秀端流程 (V32.36.114 老板 09-24 拍板 - 应用 4 点反馈)
 *
 * 老板拍板 V32.36.114 反馈:
 *   1. 千机步骤3依旧点击转发。在变量A解析出"越秀"时，不做A、B对比，仿照V2点击"联系方式"后的电话
 *      → 千机端 qianji.ts:340 已修 (V32.36.114): varA 含"越秀" → 跳过"找转发" → 仿 V2 tapPhoneMaskAndWaitForCopy + 写库
 *   2. 在工作台查找"越秀地产悦秀会"的方式参考V4 保利端查找"云和家经纪云"的逻辑
 *      → 越秀:3 已用 scrollUpPPlus + judge.isScreenText (V32.36.113), 跟 baoli 步骤 3 同款
 *   3. 删除"越秀:4"，后续的序号重新调整
 *      → 越秀:4 整体删除, 越秀:5-17 → 越秀:4-16
 *   4. 越秀:4 (原 5) 检索失败时打印当前界面的节点
 *      → 新 越秀:4 失败时 dump 所有节点 (text + centerX/Y)
 *
 * V32.36.114 步骤编号 (从 1 开始, 越秀:4 已删, 重新排序):
 *   越秀:1   打开企业微信
 *   越秀:2   点击"工作台" (V32.36.108 跨端复用: 2 次查找 + 1-2s 随机)
 *   越秀:3   查找"越秀地产悦秀会" (V32.36.113 + baoli 步骤 3 同款: scrollUpPPlus + judge.isScreenText)
 *   越秀:4   检索"推荐购房"+"查看更多" (V2 步骤 5.5 A/B 方案分支 + 失败时 dump 节点) ← 原越秀:5
 *   越秀:5A  情况A: 点"查看更多" (V2 步骤 6) ← 原越秀:6A
 *   越秀:5B  情况B: 兜底流程 "推荐赚佣"→ 弹窗"前往查看" (V2 步骤 5.6-5.9) ← 原越秀:6B
 *   越秀:6   点"去推荐" (V2 步骤 8, Y值最大) ← 原越秀:7
 *   越秀:7   验证推荐页 (V2 步骤 8.5 verifyAndRecover) ← 原越秀:8
 *   越秀:8   dump + 取客户 (Orchestrator 传入 customer) ← 原越秀:9
 *   越秀:9   输入手机号 (longPress 粘贴, V32.36.104 2-2.5s 随机) ← 原越秀:10
 *   越秀:10  输入姓名 (V2 步骤 11) ← 原越秀:11
 *   越秀:11  选性别 (3 层判断, q1q2Logic.ts guessGenderFromName) ← 原越秀:12
 *   越秀:12  验证输入内容 (V2 步骤 12) ← 原越秀:13
 *   越秀:13  点"立即推荐" (V2 步骤 13) ← 原越秀:14
 *   越秀:14  检测报备结果 + 更新 DB (3 路分支 + markReportDone V32.36.52) ← 原越秀:15
 *   越秀:15  反馈 (拉千机 + 一致性校验 + 点"报备有效/无效" + 自动 Dialog, V2 步骤 15) ← 原越秀:16
 *   越秀:16  清理 (V4 下滑刷新替代 V2 exitMiniProgram, V32.36.65+69) + YUEXIU_COMPLETE + inline hook 调下一组 (V32.36.111 + V32.36.114) ← 原越秀:17
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
import { scrollUpPPlus, scrollUpPPlusLite, pPlusDelay } from '@/utils/PPlusSwipe'; // 🆕 V32.36.113 + V32.36.121 老板 09-25 拍板: 学习 V4 保利 P+ 拟人化上滑

const APP_PACKAGES = {
  WECHAT_WORK: 'com.tencent.wework',
};

const YUEXIU_MINIAPP_FALLBACK_Y_DP = 400;
// ★ V32.36.126 老板 09-29 拍板: 删 hardcode 常量 (实测跟 dump 节点不一致)
//   改用 dump 节点 click.byNode 替代 byCoords hardcode
// const FALLBACK_RECOMMEND_TAB_X_DP = 32.4;   // V32.36.126 删
// const FALLBACK_RECOMMEND_TAB_Y_DP = 249.5;  // V32.36.126 删
// const FALLBACK_VIEW_BTN_X_DP = 130.9;       // V32.36.126 删
// const FALLBACK_VIEW_BTN_Y_DP = 331.6;       // V32.36.126 删

// ============================================================
// 越秀流程主入口
// ============================================================
export async function runYuexiuFlow(customer: CustomerInfo): Promise<boolean> {
  logger.info('app', `========== 越秀流程开始 (客户=${customer.customerName}) ==========`);

  try {
    if (!await yuexiuStep1OpenWechat()) throw new Error('越秀:1 打开企业微信失败');
    if (!await yuexiuStep2ClickWorkbench()) throw new Error('越秀:2 找不到工作台');
    if (!await yuexiuStep3FindYuexiuMiniApp()) throw new Error('越秀:3 找不到越秀地产悦秀会');

    // 🆕 V32.36.114 老板 09-24 拍板: 删除越秀:4 (V2 步骤5 verifyAndRecover 老板 09-13 拍板禁跑)
    //   原 越秀:5 → 新 越秀:4
    const mode = await yuexiuStep4CheckViewMore();
    if (mode === 'A') {
      if (!await yuexiuStep5AClickViewMore()) throw new Error('越秀:5A 点查看更多失败');
    } else {
      if (!await yuexiuStep5BFallback()) throw new Error('越秀:5B 兜底流程失败');
    }

    if (!await yuexiuStep6ClickRecommend(customer)) throw new Error('越秀:6 找不到去推荐');

    const verifyOk = await yuexiuStep7VerifyRecommendPage();
    if (!verifyOk) logger.warn('越秀:7', '验证推荐页失败 (best-effort, 继续)');

    // 🆕 V32.36.130 老板 09-29 拍板: 步骤 8 加 dump 逻辑, 步骤 9 拉 +86 节点坐标做 longPress 粘贴
    //   老板 dump 实测: +86 节点 bounds=[114,1705][234,1780], EditText bounds=[303, 1705][996,1783]
    //   老板拍板: x+190 = +86 到 EditText 距离 (114+190=304 ≈ EditText left 303)
    //   相对位置不变 → 跨两次界面 dump 坐标变化也能稳定触发 longPress
    const phoneAnchor = await yuexiuStep8DumpPhoneAnchor();
    if (!phoneAnchor) throw new Error('越秀:8 找不到 +86 节点,无法长按粘贴');

    if (!await yuexiuStep9InputPhone(customer, phoneAnchor)) throw new Error('越秀:9 输入手机号失败');
    if (!await yuexiuStep10InputName(customer)) throw new Error('越秀:10 输入姓名失败');
    if (!await yuexiuStep11SelectGender(customer)) logger.warn('越秀:11', '选性别失败 (best-effort, 继续)');

    const inputOk = await yuexiuStep12VerifyInput(customer);
    if (!inputOk) logger.warn('越秀:12', '验证输入内容失败 (best-effort, 继续)');

    if (!await yuexiuStep13ClickSubmit()) throw new Error('越秀:13 点立即推荐失败');

    const baobeiMode = await yuexiuStep14DetectResult(customer);
    if (baobeiMode === 'timeout') throw new Error('越秀:14 报备结果超时');

    const feedbackOk = await yuexiuStep15Feedback(customer, baobeiMode);
    if (!feedbackOk) throw new Error('越秀:15 一致性校验失败');

    await yuexiuStep16CleanupAndComplete();

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

// 越秀:3 查找"越秀地产悦秀会" (V32.36.113 + baoli 步骤 3 同款: scrollUpPPlus + judge.isScreenText)
async function yuexiuStep3FindYuexiuMiniApp(): Promise<boolean> {
  logger.info('越秀:3', '查找越秀地产悦秀会...');
  // 🆕 V32.36.121 老板 09-25 拍板: 4-6s 太久, 改 1-2s 随机 (跟 baoli 步骤 3 同款 pPlusDelay)
  await ZBBAutomation.delay(1000 + Math.random() * 1000);

  // 🆕 V32.36.113 老板 09-24 拍板: 学习 V4 保利 P+ 拟人化上滑
  // 🆕 V32.36.121 老板 09-25 拍板: scrollUpPPlus 默认 (180,672)→(180,224) 上滑太多, 改用 scrollUpPPlusLite (180,672)→(180,424) 滑 248dp
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await judge.isScreenText('越秀地产悦秀会');
    if (found) {
      logger.info('越秀:3', `✓ 第 ${attempt + 1} 次找到越秀地产悦秀会 (judge.isScreenText)`);
      const ok = await click.byText('越秀地产悦秀会');
      if (ok) {
        await ZBBAutomation.delay(3000 + Math.random() * 1000);
        return true;
      }
    }
    // V32.36.121 改用 scrollUpPPlusLite (上滑 31% 屏, 不再 56% 屏)
    const swipeOk = await scrollUpPPlusLite();
    logger.info('越秀:3', `scrollUpPPlusLite 上滑结果: ${swipeOk} (attempt ${attempt + 1})`);
    // V32.36.121 老板拍板: pPlusDelay(1000, 1000) = 1-2s 随机
    await pPlusDelay(1000, 1000);
  }

  // 兜底: dp(180, 400)
  logger.warn('越秀:3', `5 次循环都未找到, 兜底用 dp(${centerXDp()}, ${YUEXIU_MINIAPP_FALLBACK_Y_DP})`);
  await click.byCoords(centerXDp(), YUEXIU_MINIAPP_FALLBACK_Y_DP);
  await ZBBAutomation.delay(3000 + Math.random() * 1000);
  return true;
}

// 越秀:4 (原越秀:5) 检索"推荐购房"+"查看更多" + 失败时 dump 节点 (V32.36.114 老板拍板)
async function yuexiuStep4CheckViewMore(): Promise<'A' | 'B'> {
  logger.info('越秀:4', '检索"推荐购房"+"查看更多" (V32.36.112 A/B 方案) + 失败时打印节点');
  await ZBBAutomation.delay(2000);

  // 🆕 V32.36.118 老板 09-25 反证: 老板 nova dump 节点数=8 全在屏幕顶部, 底部"推荐购房"/"查看更多"没 dump 出来
  //   老板 nova 截图显示底部有"推荐购房"+"查看更多" (@ ~1395px 起始), 但 dump 只读到顶栏"更多"/"关闭"按钮
  //   真因: WebView dump 截断了底部内容 (顶栏节点坐标 (835,199)/(981,199) 全 < 200px 范围)
  //   修法: 第 1 次 dump 不命中 → scrollUpPPlus 让底部内容进视口 → 再 dump
  let nodes = await ZBBAutomation.getAllTextNodes();
  let allText = nodes.map(n => n.text || '').join('|');
  let hasRecommendPurchase = allText.includes('推荐购房');
  let hasViewMoreBtn = allText.includes('查看更多');

  if (!hasRecommendPurchase && !hasViewMoreBtn) {
    logger.info('越秀:4', `第 1 次 dump 不命中, 触发 scrollUpPPlus 让底部内容进视口 (V32.36.118 老板反证)`);
    await scrollUpPPlus();
    await pPlusDelay(1500, 500);
    nodes = await ZBBAutomation.getAllTextNodes();
    allText = nodes.map(n => n.text || '').join('|');
    hasRecommendPurchase = allText.includes('推荐购房');
    hasViewMoreBtn = allText.includes('查看更多');
  }

  logger.info('越秀:4', `has推荐购房=${hasRecommendPurchase}, has查看更多=${hasViewMoreBtn}`);

  // 🆕 V32.36.114 老板 09-24 拍板反馈 4: 检索失败时打印当前界面的节点
  //   老板原话: '"LOG [16:57:46] [越秀:5] 检索"推荐购房"+"查看更多" 打印当前界面的节点'
  //   老板 nova 16:57:49 反证: 检索全 false 但不知道界面有什么, 需要打印 dump
  //   修法: 不管 A/B 都打印节点数 + 节点详情 (便于诊断"为什么检索失败")
  logger.info('越秀:4', `当前界面 dump 节点数=${nodes.length}`);
  nodes.slice(0, 50).forEach((n, idx) => {
    logger.info('越秀:4', `  [${idx + 1}] text="${n.text}" desc="${n.contentDesc || ''}" @ (${n.centerX}, ${n.centerY})`);
  });
  if (nodes.length > 50) {
    logger.info('越秀:4', `  ... 还有 ${nodes.length - 50} 个节点省略`);
  }

  if (hasRecommendPurchase && hasViewMoreBtn) {
    logger.info('越秀:4', '情况A → 5A');
    return 'A';
  }
  logger.info('越秀:4', '情况B → 5B');
  return 'B';
}

// 越秀:5A (原越秀:6A) 情况A: 点"查看更多"
async function yuexiuStep5AClickViewMore(): Promise<boolean> {
  logger.info('越秀:5A', '点"查看更多" (情况A)');
  await ZBBAutomation.delay(2000);
  return await findWithRecovery('越秀:5A', async () => click.byText('查看更多'));
}

// 越秀:5B (原越秀:6B) 情况B: 兜底流程
async function yuexiuStep5BFallback(): Promise<boolean> {
  logger.info('越秀:5B', '兜底流程: 点"推荐赚佣"→ 弹窗"前往查看" (V2 步骤5.6-5.9)');

  // ★ V32.36.126 老板 09-29 拍板: 5B-1 dump 找"推荐赚佣" 节点, 替代 hardcode dp(32.4, 249.5)
  //   老板 nova 12:39 实测: dump 节点 @ (133, 421) 跟 hardcode (97, 749) 不一致
  //   修法: dump 一次 + find 节点 + click.byNode (替代 byCoords hardcode)
  const nodes1 = await ZBBAutomation.getAllTextNodes();
  const recommendNode = nodes1.find((n: any) =>
    n?.text === '推荐赚佣' && n.centerX > 0 && n.centerY > 0
  );
  if (!recommendNode) {
    logger.warn('越秀:5B-1', 'V32.36.126 未找到"推荐赚佣"节点, return false');
    return false;
  }
  logger.info('越秀:5B-1', `点"推荐赚佣" @ (${recommendNode.centerX}, ${recommendNode.centerY}) [V32.36.126 dump 节点, 替代 hardcode dp(32.4, 249.5)]`);
  await click.byNode(recommendNode);

  // ★ V32.36.127 老板 09-29 拍板: 等弹窗时间太短, 改 2000-2500ms 随机
  //   原: 1000 + random*1000 = 1000-1999ms (老板 nova 12:50 实测 1277ms 太短)
  //   改: 2000 + random*500 = 2000-2499ms (老板原话: '增加1-1.5S间的随机时间' = 1000+1000~1500)
  const delay1 = 2000 + Math.floor(Math.random() * 500);
  logger.info('越秀:5B-2', `等弹窗 ${delay1}ms (V32.36.127 老板拍板: 2000-2500ms 随机)`);
  await ZBBAutomation.delay(delay1);

  // ★ V32.36.128 老板 09-29 拍板: dump 失败重试 3 次, 每次 dump 前等弹窗浮层渲染
  //   老板 nova 14:57 实测: 2204ms 后 dump 拿不到"前往查看" 节点, 但屏幕已显示该弹窗
  //   真因: 弹窗浮层 WebView 渲染慢, dump 时 A11y 树还没注入弹窗节点
  //   修法: 3 次循环, 每次 dump 前等 1000-2000ms 随机 (给弹窗浮层渲染时间), 命中就 break
  let viewBtnNode: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // ★ V32.36.128 dump 前等弹窗浮层渲染
    const popupDelay = 1000 + Math.floor(Math.random() * 1000);
    logger.info('越秀:5B-3', `第 ${attempt}/3 次 dump, 先等 ${popupDelay}ms (V32.36.128 等弹窗浮层渲染)`);
    await ZBBAutomation.delay(popupDelay);
    const nodes2 = await ZBBAutomation.getAllTextNodes();
    viewBtnNode = nodes2.find((n: any) =>
      n?.text === '前往查看' && n.centerX > 0 && n.centerY > 0
    );
    if (viewBtnNode) {
      logger.info('越秀:5B-3', `✓ 第 ${attempt}/3 次找到"前往查看" @ (${viewBtnNode.centerX}, ${viewBtnNode.centerY})`);
      break;
    }
    logger.warn('越秀:5B-3', `第 ${attempt}/3 次未找到"前往查看" 节点, ${attempt < 3 ? '重试' : '走正中 ±10dp 兜底'}`);
  }
  // 🆕 V32.36.129 老板 09-29 拍板: dump 失败 → 屏幕正中 ±10dp 拟人化兜底
  //   老板 nova 实测: 弹窗任意位置点击都能触发"前往查看" handler (弹窗是全屏 mask, 按钮只是视觉层)
  //   修法: 屏幕正中 dp(180, 400) + ±10dp 拟人化 (DpUtil centerXDp/centerYDp 兜底坐标, 跨机型兼容)
  if (!viewBtnNode) {
    const fallbackX = 180 + Math.floor((Math.random() - 0.5) * 20);  // 170-190 dp (±10)
    const fallbackY = 400 + Math.floor((Math.random() - 0.5) * 20);  // 390-410 dp (±10)
    logger.info('越秀:5B-3', `V32.36.129 dump 兜底: 屏幕正中 ±10dp dp(${fallbackX}, ${fallbackY}) (老板 nova 实测: 弹窗任意位置都能进入下一步)`);
    await click.byCoords(fallbackX, fallbackY);
  } else {
    logger.info('越秀:5B-3', `点弹窗"前往查看" @ (${viewBtnNode.centerX}, ${viewBtnNode.centerY}) [V32.36.126 dump 节点, 替代 hardcode dp(130.9, 331.6)]`);
    await click.byNode(viewBtnNode);
  }

  const delay2 = 1000 + Math.floor(Math.random() * 1000);
  await ZBBAutomation.delay(delay2);
  const nodes = await ZBBAutomation.getAllTextNodes();
  logger.info('越秀:5B-4', `点击后 dump 节点数=${nodes.length}`);
  return true;
}

// 越秀:6 (原越秀:7) 点"去推荐" - 🆕 V32.36.122 老板 09-25 拍板: 找项目右下方的去推荐
async function yuexiuStep6ClickRecommend(customer: CustomerInfo): Promise<boolean> {
  logger.info('越秀:6', `点"去推荐" (项目=${customer.projectName} 右下方第一个) - V32.36.122 老板拍板`);

  // 🆕 V32.36.122 老板 09-25 拍板:
  //   老板原话: '这里要点击的是位于"越秀金水云启"（px值为（x,y））右下方的第一个"去推荐"（px值为（x1,y1)), 即 x1>x 且 y 值最大'
  //   老板 nova 09:03 dump 反证: 越秀"推荐购房"页面有多个项目（越秀郑轨金水观萃 / 越秀·金水云启 / 越秀·天悦江湾 等）
  //     每个项目都有自己"去推荐"按钮, V4 旧逻辑"Y 最大"选到了屏外/别的项目按钮
  //   真因: 多个项目 + 多个"去推荐"按钮, 必须按"项目名 X,Y"匹配, 不能简单按 Y 最大
  //   修法: 找项目名节点 → 拿到 X,Y → 在所有"去推荐"里找"X>项目X 且 Y>项目Y 且 Y-项目Y 最小"的那个
  //         兜底: 找不到 → 按 V32.36.119 重试 3 次 + 屏幕内坐标检查

  const projectName = customer.projectName || '越秀·金水云启';

  // 🆕 V32.36.119 老板 09-25 拍板: 3 次重试, 每次间隔 1-2s 随机等待
  for (let attempt = 1; attempt <= 3; attempt++) {
    const waitMs = 1000 + Math.floor(Math.random() * 1000);
    logger.info('越秀:6', `第 ${attempt}/3 次查找, 先等 ${waitMs}ms`);
    await ZBBAutomation.delay(waitMs);

    const nodes = await ZBBAutomation.getAllTextNodes();

    // 1. 找项目名节点 (V32.36.122 老板反证: 项目名 text="越秀·金水云启" 等)
    const projectNodes = nodes.filter((n: any) => n.text === projectName && n.centerX && n.centerY);
    if (projectNodes.length === 0) {
      logger.warn('越秀:6', `第 ${attempt}/3 次未找到项目名"${projectName}", 试 dump 模糊匹配`);
      // 兜底: 模糊匹配 (text.includes(projectName 核心字))
      const fuzzyNodes = nodes.filter((n: any) => {
        const t = n.text || '';
        return (projectName.includes('金水云启') ? t.includes('金水云启') : t.includes(projectName)) && n.centerX && n.centerY;
      });
      if (fuzzyNodes.length === 0) {
        logger.warn('越秀:6', `第 ${attempt}/3 次模糊匹配也没找到"${projectName}"`);
        continue;
      }
      projectNodes.push(...fuzzyNodes);
    }
    // 2. 选 Y 最大的项目名节点 (可能有重复, 如顶部 banner + 列表项)
    const project = projectNodes.reduce((max: any, n: any) =>
      (n.centerY ?? 0) > (max.centerY ?? 0) ? n : max
    );
    const projectX = project.centerX as number;
    const projectY = project.centerY as number;
    logger.info('越秀:6', `项目"${projectName}" @ px(${projectX}, ${projectY})`);

    // 3. 找所有"去推荐"按钮
    const recommendNodes = nodes.filter((n: any) => n.text === '去推荐' && n.centerX && n.centerY);
    if (recommendNodes.length === 0) {
      logger.warn('越秀:6', `第 ${attempt}/3 次未找到"去推荐"`);
      continue;
    }

    // 4. V32.36.122 老板拍板逻辑: X > 项目X 且 Y > 项目Y 且 (Y - 项目Y) 最小
    const target = recommendNodes
      .filter((n: any) => n.centerX > projectX && n.centerY > projectY)
      .reduce((min: any, n: any) => {
        if (!min) return n;
        const dCurr = (n.centerY ?? 0) - projectY;
        const dMin = (min.centerY ?? 0) - projectY;
        return dCurr < dMin ? n : min;
      }, null as any);

    if (!target) {
      // 兜底: 选 X 最大的"去推荐" (项目右侧)
      const fallbackTarget = recommendNodes.reduce((max: any, n: any) =>
        (n.centerX ?? 0) > (max.centerX ?? 0) ? n : max
      );
      const fbY_dp = Math.round((fallbackTarget.centerY as number) / 3);
      const fbX_dp = Math.round((fallbackTarget.centerX as number) / 3);
      logger.warn('越秀:6', `第 ${attempt}/3 次 X>项目X 且 Y>项目Y 没匹配, 兜底选 X 最大的"去推荐" @ px(${fallbackTarget.centerX}, ${fallbackTarget.centerY}) → dp(${fbX_dp}, ${fbY_dp})`);
      if (fbY_dp > 700) {
        logger.warn('越秀:6', `去推荐 Y=${fbY_dp}dp 接近屏幕底部 (>700), 触发 scrollUpPPlusLite`);
        await scrollUpPPlusLite();
        await ZBBAutomation.delay(1500);
        const newNodes = await ZBBAutomation.getAllTextNodes();
        const newRecommend = newNodes.filter((n: any) => n.text === '去推荐' && n.centerX && n.centerY);
        if (newRecommend.length > 0) {
          const newTarget = newRecommend
            .filter((n: any) => n.centerX > projectX && n.centerY > projectY)
            .reduce((min: any, n: any) => {
              if (!min) return n;
              const dCurr = (n.centerY ?? 0) - projectY;
              const dMin = (min.centerY ?? 0) - projectY;
              return dCurr < dMin ? n : min;
            }, null as any);
          if (newTarget) {
            const newY_dp = Math.round((newTarget.centerY as number) / 3);
            const newX_dp = Math.round((newTarget.centerX as number) / 3);
            logger.info('越秀:6', `✓ 重 dump 后找到目标 @ dp(${newX_dp}, ${newY_dp}), byCoords`);
            await click.byCoords(newX_dp, newY_dp);
            await ZBBAutomation.delay(2000);
            return true;
          }
        }
      }
      await click.byCoords(fbX_dp, fbY_dp);
      await ZBBAutomation.delay(2000);
      return true;
    }

    const targetY_dp = Math.round((target.centerY as number) / 3);
    const targetX_dp = Math.round((target.centerX as number) / 3);
    logger.info('越秀:6', `✓ 第 ${attempt}/3 次找到项目"${projectName}"右下方第一个"去推荐" @ px(${target.centerX}, ${target.centerY}) → dp(${targetX_dp}, ${targetY_dp})`);

    if (targetY_dp > 700) {
      logger.warn('越秀:6', `去推荐 Y=${targetY_dp}dp 接近屏幕底部 (>700), 触发 scrollUpPPlusLite`);
      await scrollUpPPlusLite();
      await ZBBAutomation.delay(1500);
      const newNodes = await ZBBAutomation.getAllTextNodes();
      const newProjectNodes = newNodes.filter((n: any) => n.text === projectName && n.centerX && n.centerY);
      if (newProjectNodes.length > 0) {
        const newProject = newProjectNodes.reduce((max: any, n: any) =>
          (n.centerY ?? 0) > (max.centerY ?? 0) ? n : max
        );
        const newRecommend = newNodes.filter((n: any) => n.text === '去推荐' && n.centerX && n.centerY);
        const newTarget = newRecommend
          .filter((n: any) => n.centerX > (newProject.centerX as number) && n.centerY > (newProject.centerY as number))
          .reduce((min: any, n: any) => {
            if (!min) return n;
            const dCurr = (n.centerY ?? 0) - (newProject.centerY as number);
            const dMin = (min.centerY ?? 0) - (newProject.centerY as number);
            return dCurr < dMin ? n : min;
          }, null as any);
        if (newTarget) {
          const newY_dp = Math.round((newTarget.centerY as number) / 3);
          const newX_dp = Math.round((newTarget.centerX as number) / 3);
          logger.info('越秀:6', `  重 dump: 去推荐 @ dp(${newX_dp}, ${newY_dp})`);
          await click.byCoords(newX_dp, newY_dp);
          await ZBBAutomation.delay(2000);
          return true;
        }
      }
    } else {
      await click.byCoords(targetX_dp, targetY_dp);
      await ZBBAutomation.delay(2000);
      return true;
    }
  }

  logger.error('越秀:6', '3 次都未找到, 报错');
  return false;
}

// 越秀:7 (原越秀:8) 验证推荐页 (V2 步骤 8.5 verifyAndRecover)
async function yuexiuStep7VerifyRecommendPage(): Promise<boolean> {
  logger.info('越秀:7', '验证推荐页 fingerprint (V2 步骤 8.5 verifyAndRecover)');
  try {
    const result = await verifyAndRecover('推荐赚佣', { maxRetries: 1, timeoutMs: 5000 });
    if (result.ok) {
      logger.info('越秀:7', '验证推荐页 ✓');
      return true;
    }
    logger.warn('越秀:7', `验证推荐页失败: ${result.reason || 'unknown'}`);
    return false;
  } catch (e: any) {
    logger.warn('越秀:7', `verifyAndRecover 异常: ${e}`);
    return false;
  }
}

// 越秀:8 (V32.36.130 老板 09-29 拍板: dump +86 节点, 提取 (x_dp, y_dp) 给步骤 9 做 longPress 粘贴)
// 老板 dump 实测: +86 节点 bounds=[114,1705][234,1780] (px), nova 7 5G pixelRatio=3.0 → 1dp=3px
//   拍板逻辑: +86 + 190px ≈ EditText 起点 (114+190=303 ≈ 303),相对稳定, 跨界面 dump 坐标变化也能命中
//   V2 参考 (YuexiuService.ts L892-946 步骤 5.5): dump 拿 phone InputRect bounds + byCoords longPress 兜底
//   V32.36.124 longPress byCoords 老板 nova 实测已验证 OK, 这次沿用 byCoords 不用 byText
async function yuexiuStep8DumpPhoneAnchor(): Promise<{ x_dp: number; y_dp: number } | null> {
  logger.info('越秀:8', 'dump +86 节点, 提取锚点 (V32.36.130 老板拍板)');
  await ZBBAutomation.delay(2000);

  const nodes = await ZBBAutomation.getAllTextNodes();
  const plusNode = nodes.find(n => n.text === '+86');

  if (!plusNode || !plusNode.centerX || !plusNode.centerY) {
    logger.error('越秀:8', `没找到 +86 节点 (dump 节点数=${nodes.length})`);
    return null;
  }

  // px → dp (nova 7 5G pixelRatio=3.0 → 1dp = 3px)
  const x_dp = Math.round(plusNode.centerX / 3);
  const y_dp = Math.round(plusNode.centerY / 3);
  logger.info('越秀:8', `✓ +86 节点 @ px(${plusNode.centerX}, ${plusNode.centerY}) → dp(${x_dp}, ${y_dp})`);

  return { x_dp, y_dp };
}

// 越秀:9 (V32.36.130 老板 09-29 拍板: dump +86 → longPress (x+190, y) 2s → click (x+190, y-45) → verify 粘贴成功)
//   老板原话: 1. 找到 +86 坐标 (x,y), 长按 (x+190, y) 2S; 2. 点击 (x+190, y-45), 等待 1-2s 随机
//   V32.36.124 byCoords longPress 老板 nova 实测已验证 OK, 这次沿用 byCoords 不用 byText
async function yuexiuStep9InputPhone(customer: CustomerInfo, anchor: { x_dp: number; y_dp: number }): Promise<boolean> {
  logger.info('越秀:9', `输入手机号 (longPress 粘贴菜单 byCoords, V32.36.130 老板拍板): ${customer.phoneLast4}`);

  // 老板原话: x+190 是 longPress 偏移 (px) = +63 dp, 进 EditText 区域触发粘贴菜单; click 偏移 x+180,y-55 (px) = +60, -18 dp (老板 09-29 拍板 V32.36.132: 改粘贴菜单点击位置)
  const LONGPRESS_OFFSET_X_DP = Math.round(190 / 3);  // +63 dp (longPress 触发粘贴菜单)
  const PASTE_OFFSET_X_DP = Math.round(180 / 3);  // +60 dp (click 粘贴菜单第一项, 老板 V32.36.132 拍板)
  const PASTE_OFFSET_Y_DP = -Math.round(55 / 3);  // -18 dp (粘贴菜单第一项, 老板 V32.36.132 拍板, 偏左上)
  const longPressX_dp = anchor.x_dp + LONGPRESS_OFFSET_X_DP;
  const longPressY_dp = anchor.y_dp;
  const pasteX_dp = anchor.x_dp + PASTE_OFFSET_X_DP;
  const pasteY_dp = anchor.y_dp + PASTE_OFFSET_Y_DP;

  // A: longPress 2s
  logger.info('越秀:9', `A: longPress byCoords dp(${longPressX_dp}, ${longPressY_dp}) 2000ms (V32.36.130)`);
  const longPressOk = await longPress.byCoords(longPressX_dp, longPressY_dp, 2000);
  if (!longPressOk) {
    logger.error('越秀:9', `longPress byCoords dp(${longPressX_dp}, ${longPressY_dp}) 失败`);
    return false;
  }

  // B: 等 1.5-2s 随机 (老板 09-29 拍板 V32.36.131: 1-2s 改 1.5-2s, 缩短等待上限)
  const menuDelay = 1500 + Math.floor(Math.random() * 500);
  logger.info('越秀:9', `B: ✓ longPress OK, 等粘贴菜单 ${menuDelay}ms (老板拍板 1.5-2s 随机, V32.36.131)`);
  await ZBBAutomation.delay(menuDelay);

  // C: click (x+180, y-55) 粘贴菜单第一项
  logger.info('越秀:9', `C: click 粘贴菜单 byCoords dp(${pasteX_dp}, ${pasteY_dp}) (V32.36.132 y-55px = -18dp)`);
  const pasteOk = await click.byCoords(pasteX_dp, pasteY_dp);
  if (!pasteOk) {
    logger.error('越秀:9', `click 粘贴菜单 dp(${pasteX_dp}, ${pasteY_dp}) 失败`);
    return false;
  }

  // V32.36.130 老板拍板: verify 粘贴成功 — dump EditText 看 text 是不是 11 位手机号,末4位匹配
  await ZBBAutomation.delay(1500);  // 给粘贴 1.5s 渲染
  const verifyNodes = await ZBBAutomation.getAllTextNodes();
  const editTextNode = verifyNodes.find(n => (n as any).className === 'android.widget.EditText');
  if (!editTextNode) {
    logger.error('越秀:9', `verify 失败: 找不到 EditText 节点 (dump 节点数=${verifyNodes.length})`);
    return false;
  }
  const pastedText = editTextNode.text || '';
  const phoneLast4 = customer.phoneLast4 || '';
  // 老板传 customer.phoneLast4 是末4位, 完整手机号 11 位 (1[3-9]\d{9}), 末4位匹配
  const phoneRegex = /1[3-9]\d{9}/;
  const phoneMatch = pastedText.match(phoneRegex);
  if (!phoneMatch || !phoneMatch[0].endsWith(phoneLast4)) {
    logger.error('越秀:9', `verify 失败: EditText text="${pastedText}" 未匹配 11 位手机号末4位 "${phoneLast4}"`);
    return false;
  }
  logger.info('越秀:9', `✓ verify 粘贴成功: "${phoneMatch[0]}" (末4位匹配 ${phoneLast4})`);
  return true;
}

// 越秀:10 (原越秀:11) 输入姓名 - 🆕 V32.36.124 老板 09-25 拍板: 学习 V2 byCoords
async function yuexiuStep10InputName(customer: CustomerInfo): Promise<boolean> {
  logger.info('越秀:10', `输入姓名: ${customer.customerName}`);

  // 🆕 V32.36.124 学习 V2: 改用 byCoords dp(217, 540) 直接点击姓名 EditText
  //   老板 nova dump.xml 实测: 姓名 EditText bounds [303,1570]-[996,1645] → dp 中心 (217, 540)
  //   V2 反证金标准 (YuexiuService.ts L892-946): 不依赖 placeholder 字符串
  logger.info('越秀:10', 'byCoords dp(217, 540) click 姓名 EditText (V32.36.124 学习 V2)');
  await click.byCoords(217, 540);

  await ZBBAutomation.delay(500);
  logger.info('越秀:10', `已点击姓名输入框, 等 native input 输入 ${customer.customerName}`);
  await ZBBAutomation.delay(1000);
  return true;
}

// 越秀:11 (原越秀:12) 选性别 (3 层判断 - 末字字典 + 兜底男)
async function yuexiuStep11SelectGender(customer: CustomerInfo): Promise<boolean> {
  logger.info('越秀:11', `选性别: ${customer.customerName}`);
  const gender = guessGenderFromName(customer.customerName);
  const genderText = gender === 'female' ? '女' : '男';
  logger.info('越秀:11', `推断 ${gender} → 选"${genderText}"`);
  return await click.byText(genderText);
}

// 越秀:12 (原越秀:13) 验证输入内容
async function yuexiuStep12VerifyInput(customer: CustomerInfo): Promise<boolean> {
  logger.info('越秀:12', '验证输入内容 (姓名 + 手机号末4)');
  const nodes = await ZBBAutomation.getAllTextNodes();
  const nameFound = nodes.some((n: any) => n.text === customer.customerName);
  const phoneFound = nodes.some((n: any) => n.text?.endsWith(customer.phoneLast4 || ''));
  logger.info('越秀:12', `姓名"${customer.customerName}" ${nameFound ? '✓' : '✗'}, 手机号末4"${customer.phoneLast4}" ${phoneFound ? '✓' : '✗'}`);
  return nameFound && phoneFound;
}

// 越秀:13 (原越秀:14) 点"立即推荐"
async function yuexiuStep13ClickSubmit(): Promise<boolean> {
  logger.info('越秀:13', '点"立即推荐"');
  return await findWithRecovery('越秀:13', async () => click.byText('立即推荐'));
}

// 越秀:14 (原越秀:15) 检测报备结果 + 更新 DB
async function yuexiuStep14DetectResult(customer: CustomerInfo): Promise<'valid' | 'invalid' | 'timeout'> {
  logger.info('越秀:14', '检测报备结果 (3 路分支)');
  await ZBBAutomation.delay(3000);

  let baobeiMode: 'valid' | 'invalid' | 'timeout' = 'timeout';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const nodes = await ZBBAutomation.getAllTextNodes();
    if (nodes.some((n: any) => n.text?.includes('报备有效'))) {
      baobeiMode = 'valid';
      logger.info('越秀:14', `第 ${attempt}/3 次检测到"报备有效"`);
      break;
    }
    if (nodes.some((n: any) => n.text?.includes('报备无效') || n.text?.includes('重号'))) {
      baobeiMode = 'invalid';
      logger.info('越秀:14', `第 ${attempt}/3 次检测到"报备无效"`);
      break;
    }
    logger.info('越秀:14', `第 ${attempt}/3 次未检测到, 等 1.5s`);
    await ZBBAutomation.delay(1500);
  }

  try {
    const reportId = customer.reportIds?.[0];
    if (reportId !== undefined) {
      if (baobeiMode === 'valid') {
        await markReportDone(reportId, 'done');
        logger.info('越秀:14', `markReportDone(${reportId}) ✓ done`);
      } else if (baobeiMode === 'invalid') {
        await markReportDone(reportId, '重号');
        logger.info('越秀:14', `markReportDone(${reportId}) ✓ 重号`);
      } else {
        logger.warn('越秀:14', 'timeout, 不写 DB');
      }
    } else {
      logger.warn('越秀:14', 'CustomerInfo.reportIds 为空, 跳过 markReportDone');
    }
  } catch (e: any) {
    logger.warn('越秀:14', `markReportDone 异常 (best-effort): ${e}`);
  }

  return baobeiMode;
}

// 越秀:15 (原越秀:16) 反馈 (拉千机 + 一致性校验 + 自动 Dialog)
async function yuexiuStep15Feedback(customer: CustomerInfo, baobeiMode: 'valid' | 'invalid'): Promise<boolean> {
  logger.info('越秀:15', `反馈 (baobeiMode=${baobeiMode})`);

  logger.info('越秀:15-A', 'tap 返回 + Home');
  try {
    await pressKey.back();
    await ZBBAutomation.delay(1000);
  } catch (e: any) {
    logger.warn('越秀:15-A', `pressKey.back 异常: ${e}`);
  }
  try {
    await pressKey.home();
    await ZBBAutomation.delay(1500);
  } catch (e: any) {
    logger.warn('越秀:15-A', `pressKey.home 异常: ${e}`);
  }

  logger.info('越秀:15-B', '打开千机');
  try {
    const pkg = qianjiPackage();
    const act = qianjiMainActivity();
    const launchWithAm = (ZBBAutomation as any).launchAppWithAmStart ?? ZBBAutomation.launchApp;
    await launchWithAm(pkg, act);
    await ZBBAutomation.delay(5000);
  } catch (e: any) {
    logger.error('越秀:15-B', `launchAppWithAmStart 失败: ${e}`);
    return false;
  }

  logger.info('越秀:15-前置', '一致性校验: 姓名 + 手机号末4');
  const nodes = await ZBBAutomation.getAllTextNodes();
  const nameFound = nodes.some((n: any) => n.text === customer.customerName);
  const phoneFound = nodes.some((n: any) => n.text?.endsWith(customer.phoneLast4 || ''));
  logger.info('越秀:15-前置', `姓名"${customer.customerName}" ${nameFound ? '✓' : '✗'}, 手机号末4"${customer.phoneLast4}" ${phoneFound ? '✓' : '✗'}`);

  if (!nameFound || !phoneFound) {
    logger.error('越秀:15-前置', '✗ 一致性校验失败, 弹 Dialog');
    await raiseAlert('小主，这个客户和已经报备的不一致，请核对！', 30000, true);
    return false;
  }
  logger.info('越秀:15-前置', '✓ 一致性校验通过');

  const buttonText = baobeiMode === 'invalid' ? '报备无效' : '报备有效';
  logger.info('越秀:15-B', `找"${buttonText}"`);
  const ok = await findWithRecovery('越秀:15-B', async () => click.byText(buttonText));
  if (ok) {
    logger.info('越秀:15-B', `已点"${buttonText}"`);
  } else {
    logger.warn('越秀:15-B', `未找到"${buttonText}", 跳过`);
  }

  await ZBBAutomation.delay(2000);
  if (baobeiMode === 'valid') {
    logger.info('越秀:15-B2', '找"确定"');
    const confirmOk = await click.byText('确定');
    if (confirmOk) {
      await ZBBAutomation.delay(2000);
    } else {
      logger.warn('越秀:15-B2', '未找到"确定"');
    }
  } else {
    logger.info('越秀:15-B2', '找"客户在开发商系统已存在"');
    const reasonOk = await click.byText('客户在开发商系统已存在');
    if (reasonOk) {
      await ZBBAutomation.delay(1000);
      logger.info('越秀:15-B3', '找"提交"');
      const submitOk = await click.byText('提交');
      if (submitOk) {
        await ZBBAutomation.delay(2000);
      } else {
        logger.warn('越秀:15-B3', '未找到"提交"');
      }
    } else {
      logger.warn('越秀:15-B2', '未找到"客户在开发商系统已存在"');
    }
  }

  return true;
}

// 越秀:16 (原越秀:17) 清理 (V4 下滑刷新替代 V2 exitMiniProgram) + YUEXIU_COMPLETE + inline hook
async function yuexiuStep16CleanupAndComplete(): Promise<void> {
  logger.info('越秀:16', '清理 (V4 下滑刷新替代 V2 exitMiniProgram, V32.36.65+69)');

  logger.info('越秀:16-A', '下滑屏幕刷新当前界面');
  await ZBBAutomation.swipe(px(180), px(267), px(180), px(600), 500);
  await ZBBAutomation.delay(1000 + Math.floor(Math.random() * 1000));
  const nodes = await ZBBAutomation.getAllTextNodes();
  logger.info('越秀:16-A', `刷新后 dump 节点数=${nodes.length}`);

  orchestrator.send('YUEXIU_COMPLETE');
  logger.info('app', '========== 越秀流程完成 ==========');

  logger.info('越秀', '越秀完成 → 调 runZbbWorkflowAuto 检测下一组 (V32.36.114 老板拍板)');
  try {
    const autoResult = await runZbbWorkflowAuto();
    logger.info('越秀', `runZbbWorkflowAuto 完成: totalRuns=${autoResult.totalRuns}`);
  } catch (autoErr: any) {
    logger.warn('越秀', `runZbbWorkflowAuto 异常 (best-effort): ${autoErr}`);
  }
}
