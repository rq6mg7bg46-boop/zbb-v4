/**
 * V4.x 保利流程 (老板实测 08-22, 08-23 重排)
 *
 * 实战经验铁证 (V4.x 保利连续编号 13 步骤, 老板 08-23 拍板简化):
 * - 步骤 1: 打开企业微信 (Intent)
 * - 步骤 2: 点击工作台
 * - 步骤 3: 上滑查找"云和家经纪云" (跨机型 dp 适配)
 * - 步骤 4: 找"郑州保利山水和颂"
 * - 步骤 5: 点底部"报备"按钮 (V2.x 步骤 4.5, v22.00.1 修复)
 * - 步骤 6: 找"粘贴完整客户信息..."节点 + 长按输入框 + 粘贴 (V2.x 步骤 7)
 * - 步骤 7: 点"请选择分期" (V2.x 步骤 9)
 * - 步骤 8: 选择报备项目 (V2.x 步骤 10)
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
import { px } from '@/utils/DpUtil'; // V4.x 跨机型适配 (老板拍板 08-23)

const APP_PACKAGES = {
  WECHAT_WORK: 'com.tencent.wework',
  BAOLI_MINIAPP: '云和家经纪云',
};

// 保利项目名 (V2.x BaoliService 实测)
const PROJECT_NAME_ROUND_1 = '郑州市三村杓袁7号地项目-保利缦城和颂【郑州保利和颂】';
const PROJECT_NAME_ROUND_2 = '郑州市三村杓袁7号地项目-保利山水和颂【郑州保利山水和颂】';

// ============================================================
// 保利流程主入口
// ============================================================
export async function runBaoliFlow(customer: CustomerInfo): Promise<boolean> {
  console.log(`========== 保利流程开始 (客户=${customer.customerName}) ==========`);

  orchestrator.send('QIANJI_READY'); // QianjiRefreshing → BaoliRunning

  try {
    // 第一轮报备
    const round1Ok = await runBaoliRound(customer, 1);
    if (!round1Ok) {
      console.warn('[保利] 第一轮报备失败');
      orchestrator.send('BAOLI_FAILED');
      return false;
    }

    // 第二轮报备
    const round2Ok = await runBaoliRound(customer, 2);
    if (!round2Ok) {
      console.warn('[保利] 第二轮报备失败');
      orchestrator.send('BAOLI_FAILED');
      return false;
    }

    orchestrator.send('BAOLI_COMPLETE'); // BaoliRunning → YuexiuRunning
    console.log('========== 保利流程完成 ==========');
    return true;
  } catch (error) {
    console.error('[保利] 流程失败:', error);
    orchestrator.send('BAOLI_FAILED');
    return false;
  }
}

// ============================================================
// 保利单轮 (第一轮 + 第二轮 都调这个, round 区分)
// ============================================================
async function runBaoliRound(customer: CustomerInfo, round: 1 | 2): Promise<boolean> {
  console.log(`========== 保利第 ${round} 轮开始 ==========`);

  // 步骤 1: 打开企业微信
  const step1 = await step1OpenWechat();
  if (!step1) return false;

  // 步骤 2: 点击工作台
  const step2 = await step2ClickWorkbench();
  if (!step2) return false;

  // 步骤 3: 上滑查找"云和家经纪云"
  const step3 = await step3FindMiniApp();
  if (!step3) return false;

  // 步骤 4: 找报备项目名
  const projectName = round === 1 ? PROJECT_NAME_ROUND_1 : PROJECT_NAME_ROUND_2;
  const step4 = await step4FindProject(projectName);
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

  // 步骤 8: 选择报备项目 (再确认一次)
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

  console.log(`========== 保利第 ${round} 轮完成 ==========`);
  return true;
}

// ============================================================
// 步骤 1: 打开企业微信
// ============================================================
async function step1OpenWechat(): Promise<boolean> {
  console.log('[保利:步骤1] 打开企业微信...');
  const ok = await ZBBAutomation.launchApp(APP_PACKAGES.WECHAT_WORK);
  if (!ok) {
    console.warn('[保利:步骤1] 启动失败');
    return false;
  }
  await ZBBAutomation.delay(3000);
  console.log('[保利:步骤1] ✓ 企业微信已打开');
  return true;
}

// ============================================================
// 步骤 2: 点击工作台
// ============================================================
async function step2ClickWorkbench(): Promise<boolean> {
  console.log('[保利:步骤2] 点击工作台...');
  const ok = await click.byText('工作台');
  if (!ok) {
    console.warn('[保利:步骤2] 找不到工作台');
    return false;
  }
  await ZBBAutomation.delay(2000);
  console.log('[保利:步骤2] ✓ 已点工作台');
  return true;
}

// ============================================================
// 步骤 3: 上滑查找"云和家经纪云" (跨机型 dp 适配)
// ============================================================
async function step3FindMiniApp(): Promise<boolean> {
  console.log('[保利:步骤3] 上滑查找云和家经纪云...');

  // V2.x 实战经验铁证: 步骤 3 上滑"云和家经纪云"专用 - 跨机型适配
  // nova 480dpi 1dp=3px vs vivo 320dpi 1dp=2px
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await judge.isScreenText('云和家经纪云');
    if (found) {
      console.log(`[保利:步骤3] ✓ 第 ${attempt + 1} 次找到云和家经纪云`);
      const ok = await click.byText('云和家经纪云');
      if (ok) {
        await ZBBAutomation.delay(3000);
        return true;
      }
    }
    // 上滑 (跨机型 dp 适配: V2.x 实战经验铁证 nova 480dpi 1dp=3px vs vivo 320dpi 1dp=2px)
    // V4 老板 08-23 拍板: 坐标用 dp 写, px() 自动按机型转
    await ZBBAutomation.swipe(px(180), px(500), px(180), px(267), 500);
    await ZBBAutomation.delay(1500);
  }

  console.warn('[保利:步骤3] 5 次上滑都没找到');
  return false;
}

// ============================================================
// 步骤 4: 找报备项目名
// ============================================================
async function step4FindProject(projectName: string): Promise<boolean> {
  console.log(`[保利:步骤4] 找"${projectName}"...`);

  const verifyResult = await verifyAndRecover(projectName, {
    timeoutMs: 8000,
    maxRetries: 2,
  });

  if (!verifyResult.ok) {
    console.warn(`[保利:步骤4] 找不到 ${projectName}`);
    orchestrator.send('BAOLI_INTERVENE'); // 老板介入
    return false;
  }

  const ok = await click.byText(projectName);
  if (!ok) return false;

  await ZBBAutomation.delay(2000);
  console.log(`[保利:步骤4] ✓ 已点 ${projectName}`);
  return true;
}

// ============================================================
// 步骤 5: 点底部"报备"按钮 (V2.x 步骤 4.5, v22.00.1 修复: v19.x 漏步骤)
// ============================================================
async function step5ClickReportButton(): Promise<boolean> {
  console.log('[保利:步骤5] 点底部"报备"按钮...');
  const ok = await click.byText('报备');
  if (!ok) {
    console.warn('[保利:步骤5] 找不到报备按钮');
    return false;
  }
  await ZBBAutomation.delay(2000);
  console.log('[保利:步骤5] ✓ 已点报备按钮');
  return true;
}

// ============================================================
// 步骤 6: 找"粘贴完整客户信息..."节点 + 长按输入框 + 粘贴
// (V2.x 步骤 7, 实测: 长按 3000ms + 等 1500ms + tap 粘贴)
// ============================================================
async function step6PasteCustomerInfo(customer: CustomerInfo): Promise<boolean> {
  console.log('[保利:步骤6] 长按输入框 + 粘贴客户信息...');

  // 写剪贴板
  await ZBBAutomation.setClipboardText(
    `${customer.customerName} ${customer.customerGender} ${customer.phoneLast4}`
  );

  // 找"粘贴完整客户信息..."节点
  const pasteNode = await a11y.findByText('粘贴');
  if (!pasteNode) {
    console.warn('[保利:步骤6] 找不到粘贴节点');
    return false;
  }

  // 长按输入框 3000ms (老板实测)
  const inputNode = await a11y.findByViewId('input') || pasteNode;
  await longPress.byNode(inputNode, 3000);
  await ZBBAutomation.delay(1500);

  // tap 粘贴
  const pasteOk = await click.byText('粘贴');
  if (!pasteOk) {
    console.warn('[保利:步骤6] tap 粘贴失败');
    return false;
  }

  // 等粘贴菜单 (500ms 动画)
  await ZBBAutomation.delay(500);
  console.log('[保利:步骤6] ✓ 客户信息已粘贴');
  return true;
}

// ============================================================
// 步骤 7: 点"请选择分期" (V2.x 步骤 9)
// ============================================================
async function step7SelectInstallment(): Promise<boolean> {
  console.log('[保利:步骤7] 点请选择分期...');
  const ok = await click.byText('请选择分期');
  if (!ok) {
    console.warn('[保利:步骤7] 找不到分期选项');
    return false;
  }
  await ZBBAutomation.delay(1500);
  console.log('[保利:步骤7] ✓ 已点分期');
  return true;
}

// ============================================================
// 步骤 8: 选择报备项目 (V2.x 步骤 10, 再确认一次)
// ============================================================
async function step8SelectProject(projectName: string): Promise<boolean> {
  console.log(`[保利:步骤8] 选择报备项目: ${projectName}...`);
  const ok = await click.byText(projectName);
  if (!ok) return false;
  await ZBBAutomation.delay(1500);
  console.log('[保利:步骤8] ✓ 已选项目');
  return true;
}

// ============================================================
// 步骤 9: 点确认 (V2.x 步骤 11)
// ============================================================
async function step9ClickConfirm(): Promise<boolean> {
  console.log('[保利:步骤9] 点确认...');
  const ok = await click.byText('确认');
  if (!ok) return false;
  await ZBBAutomation.delay(1500);
  console.log('[保利:步骤9] ✓ 已点确认');
  return true;
}

// ============================================================
// 步骤 10: 点智能识别 (V2.x 步骤 12)
// ============================================================
async function step10SmartRecognition(): Promise<boolean> {
  console.log('[保利:步骤10] 点智能识别...');
  const ok = await click.byText('智能识别');
  if (!ok) {
    console.warn('[保利:步骤10] 找不到智能识别');
    return false;
  }
  await ZBBAutomation.delay(3000); // 等 OCR 跑完
  console.log('[保利:步骤10] ✓ 已点智能识别');
  return true;
}

// ============================================================
// 步骤 11: 点报备 (V2.x 步骤 13)
// ============================================================
async function step11ClickReport(): Promise<boolean> {
  console.log('[保利:步骤11] 点报备...');
  const ok = await click.byText('报备');
  if (!ok) return false;
  await ZBBAutomation.delay(2000);
  console.log('[保利:步骤11] ✓ 已点报备');
  return true;
}

// ============================================================
// 步骤 12: 等待报备结果 (V2.x 步骤 14)
// ============================================================
async function step12WaitResult(): Promise<boolean> {
  console.log('[保利:步骤12] 等待报备结果...');

  // 等"报备成功"或"重号"出现
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await judge.isScreenText('报备成功')) return true;
    if (await judge.isScreenText('重号')) return true;
    await ZBBAutomation.delay(500);
  }

  console.warn('[保利:步骤12] 超时 15s');
  return false;
}

// ============================================================
// 步骤 13: 检测报备结果 (V2.x 步骤 15)
// 实测: 情况 1=重号 → 老板介入, 情况 2=成功 → 上滑 + 上传附件 + 等截图
// ============================================================
async function step13DetectResult(round: 1 | 2): Promise<boolean> {
  console.log(`[保利:步骤13] 检测报备结果 (第 ${round} 轮)...`);

  // 情况 1: 重号
  if (await judge.isScreenText('重号')) {
    console.log('[保利:步骤13-情况1] 疑似重号, 启动震动+弹窗');
    orchestrator.send('BAOLI_INTERVENE'); // 老板介入
    return false;
  }

  // 情况 2: 成功
  if (await judge.isScreenText('报备成功')) {
    console.log('[保利:步骤13-情况2] 报备成功, 上滑 + 等截图');

    // 情况 2-1: 上滑屏幕 (跨机型 dp 适配, 老板 08-23 拍板)
    await ZBBAutomation.swipe(px(180), px(500), px(180), px(267), 1000);

    // 情况 2-2: 找"上传附件"坐标
    const uploadNode = await a11y.findByText('上传附件');
    if (uploadNode && uploadNode.centerX !== undefined && uploadNode.centerY !== undefined) {
      await click.byCoords(uploadNode.centerX + 500, uploadNode.centerY);
    }

    // 情况 2-3: 等待老板截图
    console.log('[保利:步骤13-情况2-3] 等待老板截图...');
    await ZBBAutomation.delay(5000);

    // tap 返回键
    await pressKey.back();

    return true;
  }

  console.warn('[保利:步骤13] 未知状态');
  return false;
}
