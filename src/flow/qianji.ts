/**
 * V4.x 千机端 → 保利流程 (老板实战反证金标准 08-22)
 *
 * 实战经验铁证 (V2.x QianjiService + BaoliService 真实代码):
 * - 千机端步骤 1-6: 打开千机 → 识别界面 → 找报备审核 → 解析客户 (用 A11y, 不用 OCR)
 *                 → 写库 → 复制号码
 * - 保利流程 25 步骤: 打开企业微信 → 工作台 → 云和家经纪云 → 报备 (第一轮 + 第二轮)
 *
 * 业务流程 = 只调 operations method + orchestrator.send()
 */

import { orchestrator, OrchState } from '@/core/stateMachine';
import { click, longPress, a11y, judge, rollback, pressKey, threeFingerSwipe } from '@/operations';
import ZBBAutomation from '@/native';
import type { A11yNode } from '@/native';
import { verifyAndRecover, waitForScreenWithRollback } from './verify';

// ============================================================
// 常量 (V2.x APP_PACKAGES 实战反证金标准)
// ============================================================
const APP_PACKAGES = {
  QIANJI: 'com.qianji.client',
  WECHAT_WORK: 'com.tencent.wework',
  BAOLI_MINIAPP: 'cloudfamily', // 云和家经纪云
};

const QIANJI_MAIN_ACTIVITY = 'com.qianji.client.MainActivity';

// ============================================================
// 类型
// ============================================================
export interface CustomerInfo {
  customerName: string;
  phone: string;
  phoneLast4: string;
  agent: string;
  agentPhone: string;
  projectType: 'baoli' | 'yuexiu';
  customerGender: '男' | '女';
  reportTime: string;
  expectedVisitTime: string;
  city: string;
}

// ============================================================
// 千机端步骤 1: 打开千机
// ============================================================
export async function stepOpenQianji(): Promise<void> {
  console.log('[千机:步骤1] 正在打开千机...');

  let launched = false;
  try {
    launched = await ZBBAutomation.launchApp(APP_PACKAGES.QIANJI);

    if (launched) {
      console.log('[千机:步骤1] 千机已启动, 等待界面加载...');
      await ZBBAutomation.delay(3000);
    } else {
      throw new Error('千机启动失败');
    }
  } catch (error) {
    console.warn(`[千机:步骤1] 启动失败, 准备重试: ${error}`);
    // 重试 1 次 (V2.x v22.02.32 实战反证金标准: force-stop 后重试)
    await ZBBAutomation.delay(1000);
    launched = await ZBBAutomation.launchApp(APP_PACKAGES.QIANJI);
    if (!launched) throw new Error('千机启动失败 (重试)');
    await ZBBAutomation.delay(3000);
  }

  console.log('[千机:步骤1] ✓ 千机已打开');
}

// ============================================================
// 千机端步骤 2: 识别当前界面 (用 A11y getAllTextNodes)
// ============================================================
export async function stepRecognizeInterface(): Promise<A11yNode[]> {
  console.log('[千机:步骤2] 正在识别当前界面...');
  await ZBBAutomation.delay(2500);

  const textNodes = await ZBBAutomation.getAllTextNodes();
  console.log(`[千机:步骤2] 界面文本节点 (共 ${textNodes.length} 个)`);

  // 过滤业务关键节点
  const businessNodes = textNodes.filter(node =>
    node.text && node.text.trim().length > 0 && node.centerX > 0 && node.centerY > 0
  );

  businessNodes.forEach((node) => {
    console.log(`[千机:步骤2] "${node.text}" at (${Math.round(node.centerX)}, ${Math.round(node.centerY)})`);
  });

  console.log(`[千机:步骤2] ✓ 界面识别完成 (${businessNodes.length} 个有效节点)`);
  return businessNodes;
}

// ============================================================
// 千机端步骤 3: 找"报备审核"并点击
// ============================================================
export async function stepFindReportReview(): Promise<void> {
  console.log('[千机:步骤3] 找"报备审核"...');

  const verifyResult = await verifyAndRecover('报备审核', {
    timeoutMs: 8000,
    maxRetries: 2,
  });

  if (!verifyResult.ok) {
    throw new Error('找不到报备审核, 千机端 step3 失败');
  }

  const clicked = await click.byText('报备审核');
  if (!clicked) {
    throw new Error('点击"报备审核"失败');
  }

  await ZBBAutomation.delay(2000);
  console.log('[千机:步骤3] ✓ 已点"报备审核"');
}

// ============================================================
// 千机端步骤 4: 解析客户信息 (用 lastTextNodes, 不用 OCR)
// 实战反证金标准: 千机不能读剪贴板 → 用 A11y 节点解析
// ============================================================
export async function stepParseCustomerInfo(
  textNodes: A11yNode[],
): Promise<CustomerInfo> {
  console.log('[千机:步骤4] 解析客户信息 (用 A11y 树节点, 不用 OCR)...');

  // 拼装 key-value 行 (匹配 Y 坐标)
  const lines = assembleKeyValueLines(textNodes);
  console.log(`[千机:步骤4] 拼装后行数: ${lines.length}`);

  // 解析各字段
  const customerInfo: CustomerInfo = {
    customerName: extractValue(lines, '客户姓名') || extractValue(lines, '姓名') || '',
    phone: extractValue(lines, '联系方式') || '',
    phoneLast4: '',
    agent: extractValue(lines, '经纪人') || '',
    agentPhone: '',
    projectType: lines.some(l => l.includes('越秀')) ? 'yuexiu' : 'baoli',
    customerGender: extractGender(lines),
    reportTime: extractValue(lines, '报备时间') || '',
    expectedVisitTime: extractValue(lines, '预计到访') || '',
    city: extractValue(lines, '城市') || '',
  };

  // 提取 phoneLast4
  const phoneDigits = customerInfo.phone.match(/\d+/g)?.join('') || '';
  customerInfo.phoneLast4 = phoneDigits.slice(-4);

  // 兜底: 性别默认男
  if (!customerInfo.customerGender) {
    customerInfo.customerGender = '男';
  } else if (customerInfo.customerGender !== '男' && customerInfo.customerGender !== '女') {
    customerInfo.customerGender = '男';
  }

  console.log(`[千机:步骤4] 解析结果: 客户=${customerInfo.customerName} 电话=${customerInfo.phone} phoneLast4=${customerInfo.phoneLast4} 项目=${customerInfo.projectType} 性别=${customerInfo.customerGender}`);

  // 验证 phoneLast4 必须是 4 位数字
  if (!/^\d{4}$/.test(customerInfo.phoneLast4)) {
    throw new Error(`phoneLast4 不合法: "${customerInfo.phoneLast4}" (必须是 4 位数字)`);
  }

  return customerInfo;
}

// ============================================================
// 千机端步骤 5: 写库 (保利 / 越秀)
// 实战经验铁证: 保利 + 越秀都写库, 后续 Orchestrator refreshAndGetNextPending 用
// ============================================================
export async function stepWriteToReports(customer: CustomerInfo): Promise<number> {
  console.log(`[千机:步骤5] 写入 reports 表 (${customer.projectType}): 客户=${customer.customerName}`);

  // V4.x TODO: 接 expo-sqlite 写库
  // 当前 S2.2 阶段先 mock, 后续 S3 业务增强接入 CustomerTable
  const mockId = Math.floor(Math.random() * 100000) + 1;
  console.log(`[千机:步骤5] ✓ 已写库, ID=${mockId} (mock, 后续 S3 接 expo-sqlite)`);
  return mockId;
}

// ============================================================
// 千机端步骤 6: 点联系方式的 * 复制脱敏号码
// 实战经验铁证: 步骤 4.5 (V15), 保利端不复制, 越秀端要复制
// ============================================================
export async function stepCopyPhoneNumber(customer: CustomerInfo): Promise<void> {
  console.log('[千机:步骤6] 点 * 复制脱敏号码...');

  if (customer.projectType === 'yuexiu') {
    // 越秀端: 点 * 触发复制
    const copyOk = await ZBBAutomation.clickByText?.('*', false);
    if (copyOk) {
      // 等待"已复制到剪贴板"通知
      await waitForScreenWithRollback('已复制到剪贴板', 5000);
      console.log('[千机:步骤6] ✓ 已复制脱敏号码');
    }
  } else {
    // 保利端: 不复制 (老板实战反证金标准: 保利端不复制脱敏号码, 用 customerInfo.phone)
    console.log('[千机:步骤6] 保利端跳过复制 (用 customerInfo.phone)');
  }
}

// ============================================================
// 千机端完整流程 (V4.x 实战反证金标准)
// ============================================================
export async function runQianjiFlow(): Promise<CustomerInfo | null> {
  console.log('========== 千机端流程开始 ==========');

  try {
    // Step 1: 打开千机
    await stepOpenQianji();

    // Step 2: 识别界面 (A11y 节点, 不是 OCR)
    const textNodes = await stepRecognizeInterface();

    // Step 3: 找报备审核
    await stepFindReportReview();

    // Step 4: 解析客户信息 (用 A11y 节点, 不用 OCR) — 老板实战反证金标准
    const customer = await stepParseCustomerInfo(textNodes);

    // Step 5: 写库
    const customerId = await stepWriteToReports(customer);

    // Step 6: 复制号码 (越秀端)
    await stepCopyPhoneNumber(customer);

    console.log(`========== 千机端流程完成 (ID=${customerId}) ==========`);
    return customer;
  } catch (error) {
    console.error('[千机端] 流程失败:', error);
    return null;
  }
}

// ============================================================
// 保利端 25 步骤流程 (后续 S2.3 实现)
// ============================================================
export async function runBaoliFlow(customer: CustomerInfo): Promise<boolean> {
  console.log(`========== 保利端流程开始 (客户=${customer.customerName}) ==========`);
  // TODO: 步骤 1-25 (V2.x BaoliService 实战反证金标准)
  // 1. 打开企业微信
  // 2. 点击工作台
  // 3. 上滑查找"云和家经纪云"
  // 4. 找"郑州保利山水和颂"
  // 4.5. 点底部"报备"按钮
  // 7. 长按输入框 + 粘贴客户信息
  // 9. 点"请选择分期"
  // 10. 选择报备项目
  // 11-14. 确认 → 智能识别 → 报备 → 等结果
  // 15. 检测报备结果 (第一轮)
  // 16-25. 第二轮报备
  console.log('[保利端] TODO: S2.3 实现 25 步骤');
  return false;
}

// ============================================================
// 工具函数: A11y 节点拼装 key-value 行
// 实战反证金标准: 同行 Y 坐标匹配
// ============================================================
function assembleKeyValueLines(nodes: A11yNode[]): string[] {
  if (!nodes || nodes.length === 0) return [];
  // 按 Y 排序
  const sorted = [...nodes].sort((a, b) => (a.centerY ?? 0) - (b.centerY ?? 0));
  // 同行 Y 坐标差 < 30px 视为同行, 用空格拼接
  const lines: string[] = [];
  let currentLine = '';
  let currentY = -1;
  for (const node of sorted) {
    if (currentY < 0 || Math.abs((node.centerY ?? 0) - currentY) < 30) {
      currentLine += ' ' + (node.text || '');
      currentY = node.centerY ?? 0;
    } else {
      lines.push(currentLine.trim());
      currentLine = node.text || '';
      currentY = node.centerY ?? 0;
    }
  }
  if (currentLine) lines.push(currentLine.trim());
  return lines;
}

function extractValue(lines: string[], key: string): string | null {
  for (const line of lines) {
    if (line.includes(key + ':') || line.includes(key + '：')) {
      const parts = line.split(/[:：]/);
      if (parts.length >= 2) {
        return parts.slice(1).join(':').trim();
      }
    }
  }
  return null;
}

function extractGender(lines: string[]): '男' | '女' | '' {
  for (const line of lines) {
    if (line.includes('先生')) return '男';
    if (line.includes('女士') || line.includes('小姐') || line.includes('太太')) return '女';
  }
  return '';
}
