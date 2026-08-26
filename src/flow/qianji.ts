/**
 * V4.x 千机端 → 保利流程 (老板实战反证金标准 08-22, 08-23 重排)
 *
 * 实战经验铁证 (V2.x QianjiService + BaoliService 真实代码):
 * - 千机端步骤 1-6: 打开千机 → 识别界面 → 找报备审核 → 解析客户 (用 A11y, 不用 OCR)
 *                 → 写库 → 复制号码
 * - 保利流程 13 步骤 (V4.x 老板 08-23 拍板连续编号):
 *                 打开企业微信 → 工作台 → 云和家经纪云 → 找项目 → 点报备 → 粘贴 → 分期
 *                 → 选项目 → 确认 → 智能识别 → 报备 → 等结果 → 检测结果 (两轮报备)
 *
 * 业务流程 = 只调 operations method + orchestrator.send()
 */

import { orchestrator, OrchState } from '@/core/stateMachine';
import { click, longPress, a11y, judge, rollback, pressKey, threeFingerSwipe, swipe } from '@/operations';
import { HumanLevel } from '@/utils/HumanOffset';
import ZBBAutomation from '@/native';
import type { A11yNode } from '@/native';
import { verifyAndRecover, waitForScreenWithRollback } from './verify';
import { APP_PACKAGES, qianjiPackage, qianjiMainActivity } from '@/config/env';
import { writeReport, writeBaoliDouble } from '@/services/database';
import { compareCustomer, formatCompareResult } from '@/utils/compareCustomer';
import { raiseAlert, showToast, notifyNoReport } from '@/services/alert';
import { withFlowRetry, quickCheck, findWithRecovery, waitForScreenChange, RetryFlowError } from './retryUtils';

// ============================================================
// 常量 (08-24)
// ============================================================
// 🆕 08-24: 删本地 APP_PACKAGES / QIANJI_MAIN_ACTIVITY (改用 @/config/env)
// qianji.ts:24/29 hardcoded 'com.qianji.client' 是错的 (老板 08-24 拍板修复)
//   真千机包名 = com.lianjia.anchang (V2.x V22.x 实战, MEMORY.md §5)
//   真千机 MainActivity = com.lianjia.link.platform.main.MainActivity (V2.x, AutomationModule.kt:936 注释)
//   千机 launcher 图标 = com.lianjia.app.icon.activity.APlusIconActivity (误用, 只到 launcher 桌面不进业务页)
// 老板拍板 a=方案A: 编译时切换, 包名从 gradle.properties 注入, JS 跟 native 同步

// ============================================================
// 类型 (08-24 实战反证金标准)
// ============================================================
export interface CustomerInfo {
  // 🆕 08-25 老板拍板 B 方案: 保利 10 字段,后续加越秀/招商 patch
  companyName: string;        // 公司名称 (例: 贝壳)
  customerName: string;       // 客户姓名 (例: 张先生)
  customerGender: '男' | '女';// 客户性别
  phone: string;              // 客户联系方式 (例: 158****6577)
  phonePart1: string;         // 前 3 位 (例: 158)
  phonePart2: string;         // 中间 4 位 (例: **** 符号保留)
  phonePart3: string;         // 后 3 位 (例: 6577)
  phoneLast4: string;         // 数字后 4 位 (用于 ID/检索)
  projectName: string;        // 报备项目 (例: 保利缦城和颂)
  projectType: string;        // 🆕 08-25 改 string (支持保利/越秀/招商等)
  propertyType: string;       // 物业类型 (例: 住宅)
  reportTime: string;         // 报备提交时间 (例: 2026/08/14 13:12)
  expectedVisitTime: string;  // 预计到访时间 (例: 2026-08-14 13:52)
  agent: string;              // 经纪人姓名 (例: 陈建行)
  agentPhone: string;         // 经纪人电话 (文档无, V4 兼容保留)
  agentNote: string;          // 经纪人备注 (例: 空)
  city: string;               // 城市 (文档无, V4 兼容保留)
}

// ============================================================
// 千机端步骤 1: 打开千机 (🆕 08-24 老板拍板: 用 launchAppWithAmStart)
// ============================================================
export async function stepOpenQianji(): Promise<void> {
  console.log('[千机:步骤1] 正在打开千机...');

  // 🆕 08-24: 包名 + MainActivity 都从 env 模块读 (跟 BuildConfig 同步)
  // 实战反证金标准 (V2.x AutomationModule.kt:936): 必须启动 .MainActivity, 不是 .APlusIconActivity
  const qianjiPkg = qianjiPackage();
  const qianjiAct = qianjiMainActivity();
  console.log(`[千机:步骤1] package=${qianjiPkg}, mainActivity=${qianjiAct}`);

  // 🆕 08-24 (老板拍板: 用 launchAppWithAmStart):
  //   V4 旧 launchApp() 只走 getLaunchIntentForPackage (返回 launcher 图标 APlusIconActivity)
  //   V2.x 实战反证 launchAppWithAmStart(package, activity) 才进真业务页 MainActivity
  // @ts-ignore - launchAppWithAmStart 是 V2.x 实战反证金标准, V4 native 已实现 (AccessibilityServiceImpl.kt:2141)
  const launchWithAm = (ZBBAutomation as any).launchAppWithAmStart
    ?? (ZBBAutomation as any).launchApp; // fallback 到旧 launchApp (兼容 mock)

  let launched = false;
  try {
    launched = await launchWithAm(qianjiPkg, qianjiAct);

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
    launched = await launchWithAm(qianjiPkg, qianjiAct);
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

  // 🆕 08-25 老板拍板 B 方案: 保利 10 字段全填 (公司/物业/备注 + phone 三段拆 + projectName)
  const phoneRaw = extractValue(lines, '客户联系方式') || extractValue(lines, '联系方式') || '';
  const phoneDigits = phoneRaw.match(/\d+/g)?.join('') || '';
  const phoneLast4 = phoneDigits.slice(-4);

  // 拆 phone 三段 (前 3 / 中间 4 / 后 3, 数字部分)
  // 例: "158****6577" → phonePart1="158", phonePart2="****"(符号保留), phonePart3="6577"
  let phonePart1 = '', phonePart2 = '', phonePart3 = '';
  const phoneMatch = phoneRaw.match(/^(\d{3})(\*{4}|\d{4})(\d{3,4})$/);
  if (phoneMatch) {
    phonePart1 = phoneMatch[1];
    phonePart2 = phoneMatch[2];
    phonePart3 = phoneMatch[3];
  } else {
    // fallback: 按位置切
    phonePart1 = phoneDigits.slice(0, 3);
    phonePart3 = phoneDigits.slice(-3);
  }

  const customerInfo: CustomerInfo = {
    companyName: extractValue(lines, '公司名称') || '',
    customerName: extractValue(lines, '客户姓名') || extractValue(lines, '姓名') || '',
    customerGender: extractGender(lines) ?? '男', // 默认男 (兜底)
    phone: phoneRaw,
    phonePart1,
    phonePart2,
    phonePart3,
    phoneLast4,
    projectName: extractValue(lines, '报备项目') || '',
    projectType: detectProjectType(lines), // 🆕 08-25: 保利/越秀/招商/未知
    propertyType: extractValue(lines, '物业类型') || '',
    reportTime: extractValue(lines, '报备提交时间') || '',
    expectedVisitTime: extractValue(lines, '预计到访时间') || '',
    agent: extractValue(lines, '经纪人姓名') || '',
    agentPhone: extractValue(lines, '经纪人电话') || '',
    agentNote: extractValue(lines, '经纪人备注') || '',
    city: extractValue(lines, '城市') || '',
  };

  console.log(`[千机:步骤4] 解析结果: 客户=${customerInfo.customerName} 电话=${customerInfo.phone} phoneLast4=${customerInfo.phoneLast4} 项目=${customerInfo.projectType} 性别=${customerInfo.customerGender}`);

  // 验证 phoneLast4 必须是 4 位数字
  if (!/^\d{4}$/.test(customerInfo.phoneLast4)) {
    throw new Error(`phoneLast4 不合法: "${customerInfo.phoneLast4}" (必须是 4 位数字)`);
  }

  return customerInfo;
}

// ============================================================
// 千机端步骤 5: 写库 (保利双写 / 越秀/招商单写)
// 实战反证金标准 (08-25 老板拍板文档):
//   - 保利需要写 2 条数据 2 个 ID (缦城和颂 + 山水和颂, 其他信息一致)
//   - 越秀/招商/其他 单写 1 条
// ============================================================
export async function stepWriteToReports(customer: CustomerInfo): Promise<number | number[]> {
  console.log(`[千机:步骤5] 写入 reports 表 (${customer.projectType}): 客户=${customer.customerName}`);

  if (customer.projectType === 'baoli') {
    // 保利双写 (08-25 老板拍板文档实战反证金标准)
    const [id1, id2] = await writeBaoliDouble(customer);
    return [id1, id2];
  } else {
    // 越秀/招商/其他: 单写
    const id = await writeReport(customer);
    return id;
  }
}

// ============================================================
// 千机端步骤 6: 点联系方式的 * 复制脱敏号码
// 实战经验铁证: V2.x V15 老版本叫步骤 4.5 (中间编号); V4 连续编号改步骤 6
//              保利端不复制 (用 customerInfo.phone), 越秀端要复制 (点 * 触发)
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

// 千机端 8 步骤状态变量 (08-25 老板拍板 全修方案: 修法3 三次不一致报警)
let _mismatchRetryCount = 0;
const MISMATCH_MAX_RETRIES = 3;

// ============================================================
// 千机端完整 7 步骤流程 (08-25 老板拍板 修法3: 步骤3+4 合并 + 重新编号)
//
// 实战反证金标准文档 (08-25 老板拍板):
//   1. 打开千机 (停留 1.5-2s)
//   2. A11y 找"报备待审核"+数字检查+下滑刷新+解析变量A (3 字段: 项目/姓名/电话)
//   3. A11y 找"转发"(含上滑重试) + 找到后点"转发"(中等偏移 1.5-2s) ← 合并
//   4. A11y 找"公司名称" + 解析变量 B (10 字段) + A vs B 对比 + 写库
//   5. A11y 找"转发" + 点转发 (中等偏移 1.5-2s)
//   6. A11y 找"复制" + 点复制 (中等偏移 1.5-2s)
//   7. 拉起企业微信 (后续保利端两轮报备从这里接手)
// ============================================================
// 千机端流程入口 (08-25 老板拍板 C 方案: 用 withFlowRetry 包装重试)
//   - 内层 runQianjiFlowInner 抛 RetryFlowError → 自动重试整条流程
//   - 内层 raiseAlert + return null → 算失败,触发整条重试 (返回 + 重新进入)
//   - 重试 3 次都失败 → raiseAlert 等老板手动
//   - 真异常 → 立即 raiseAlert
// ============================================================
export async function runQianjiFlow(): Promise<CustomerInfo | null> {
  return withFlowRetry('千机端', runQianjiFlowInner, async () => {
    // 整条重试前的恢复动作: 返回 + 等动画
    console.log('[千机端] 整条重试前 → 返回键 + 等 1s');
    await pressKey.back();
    await ZBBAutomation.delay(1000);
  });
}

async function runQianjiFlowInner(): Promise<CustomerInfo | null> {
  console.log('========== 千机端流程开始 (7 步骤) ==========');

  try {
    // ============ 步骤 1: 打开千机 (有界面变化, 1-2s 首轮 + 重试) ============
    await stepOpenQianji();
    const step1Ok = await waitForScreenChange(
      '千机:步骤1',
      async () => await judge.isScreenText('报备待审核')
    );
    if (!step1Ok) {
      console.warn('[千机:步骤1] 未找到"报备待审核", 1 轮退出操作 (home+多功能+垃圾箱) 重新进入');
      await pressKey.home();
      await ZBBAutomation.delay(500);
      await pressKey.recent();
      await ZBBAutomation.delay(800);
      await pressKey.trash();
      await ZBBAutomation.delay(1000);
      await stepOpenQianji();
      const step1RetryOk = await waitForScreenChange(
        '千机:步骤1 (重进后)',
        async () => await judge.isScreenText('报备待审核')
      );
      if (!step1RetryOk) {
        throw new RetryFlowError('步骤1: 重进后仍未找到"报备待审核"');
      }
    }

    // ============ 步骤 2: A11y 找"报备待审核"下数字 + 数字=0 下滑刷新 + 解析变量 A ============
    // 类型 A: 无界面变化 (复用步骤 1 的节点缓存, 直接读)
    const step2Nodes = await ZBBAutomation.getAllTextNodes();
    const step2ReportCount = readReportCountFromNodes(step2Nodes);
    console.log(`[千机:步骤2] 报备数量=${step2ReportCount}`);

    if (step2ReportCount === 0) {
      console.log('[千机:步骤2] 报备数量=0, 下滑刷新');
      await swipe.down();
      await ZBBAutomation.delay(1500);
      const refreshedNodes = await ZBBAutomation.getAllTextNodes();
      const refreshedCount = readReportCountFromNodes(refreshedNodes);
      console.log(`[千机:步骤2] 刷新后报备数量=${refreshedCount}`);
      if (refreshedCount === 0) {
        console.log('[千机:步骤2] 刷新后仍=0, 提示用户并结束本轮');
        await notifyNoReport();
        await pressKey.back();
        return null;
      }
    }

    const varA = parseVariableAFromNodes(step2Nodes);
    console.log(`[千机:步骤2] 变量 A: 项目=${varA.projectName}, 姓名=${varA.customerName}, 电话=${varA.phone}`);

    // ============ 步骤 3: A11y 找"转发" (有界面变化, findWithRecovery + 上滑恢复) ============
    console.log('[千机:步骤3] A11y 找"转发"...');
    const step3Ok = await findWithRecovery(
      '千机:步骤3:转发',
      async () => !!(await a11y.findByText('转发')),
      async () => {
        await swipe.up();
        await ZBBAutomation.delay(1500);
      }
    );
    if (!step3Ok) {
      throw new RetryFlowError('步骤3: 上滑3次仍未找到"转发"');
    }
    console.log(`[千机:步骤3] 找到"转发", 点击 (中等偏移 NORMAL 档)`);
    await click.byText('转发', { level: HumanLevel.NORMAL });
    await ZBBAutomation.delay(1800);

    // ============ 步骤 4: A11y 找"公司名称" + 解析变量 B(10字段) + A vs B 对比 + 写库 ============
    // 类型 B: 有界面变化 (转发页加载), 1-2s 首轮 + 重试
    const step4NodesFound = await waitForScreenChange(
      '千机:步骤4:公司名称',
      async () => {
        const nodes = await ZBBAutomation.getAllTextNodes();
        return nodes.some(n => n.text?.includes('公司名称'));
      }
    );
    if (!step4NodesFound) {
      throw new RetryFlowError('步骤4: 等待"公司名称"超时');
    }

    const step4Nodes = await ZBBAutomation.getAllTextNodes();
    const varB = parseVariableBFromNodes(step4Nodes);

    // A vs B 对比 (修法4: 只比 3 字段: 项目/姓名/电话)
    const compareResult = compareCustomer(
      { projectName: varA.projectName, customerName: varA.customerName, phone: varA.phone },
      { projectName: varB.projectName, customerName: varB.customerName, phone: varB.phone },
    );
    console.log(`[千机:步骤4] A vs B 对比: ${formatCompareResult(compareResult)}`);

    if (!compareResult.isMatch) {
      _mismatchRetryCount++;
      const diffMsg = compareResult.diffs.map(d => `${d.field}: A="${d.aValue}" vs B="${d.bValue}"`).join('; ');
      console.warn(`[千机:步骤4] 不一致 (${_mismatchRetryCount}/${MISMATCH_MAX_RETRIES}): ${diffMsg}`);
      await pressKey.back();
      await ZBBAutomation.delay(1000);

      if (_mismatchRetryCount >= MISMATCH_MAX_RETRIES) {
        // 3 次不一致 → return null (不 raiseAlert, 让 HomeScreen 统一弹窗)
        const dialogMessage = '小主,流程出问题了(千机端首页vs转发页连续3次不一致),请你手动处理';
        console.error(`[千机:步骤4] ${dialogMessage}`);
        console.error(`[千机:步骤4] 差异详情: ${diffMsg}`);
        _mismatchRetryCount = 0;
        return null;
      }

      // 未达上限 → 抛 RetryFlowError 让 withFlowRetry 重试整条
      throw new RetryFlowError(`步骤4: A vs B 不一致 (${_mismatchRetryCount}/${MISMATCH_MAX_RETRIES})`);
    }

    // 对比成功 → 重置计数 + 直接用 varB 写库
    _mismatchRetryCount = 0;
    console.log(`[千机:步骤4] ✓ A vs B 一致, 直接用 varB 写库 (3 字段: 项目/姓名/电话)`);

    const writeResult = await stepWriteToReports(varB);
    if (Array.isArray(writeResult)) {
      console.log(`[千机:步骤4] 保利双写: ID=${writeResult.join(',')}`);
    } else {
      console.log(`[千机:步骤4] 单写: ID=${writeResult}`);
    }

    // ============ 步骤 5: A11y 找"转发" + 点转发 (有界面变化) ============
    console.log('[千机:步骤5] A11y 找"转发" (第二次, 进对象选择页)...');
    const step5Ok = await findWithRecovery(
      '千机:步骤5:转发',
      async () => !!(await a11y.findByText('转发'))
    );
    if (!step5Ok) {
      throw new RetryFlowError('步骤5: 未找到"转发"');
    }
    console.log(`[千机:步骤5] 找到"转发", 点击 (中等偏移 NORMAL 档)`);
    await click.byText('转发', { level: HumanLevel.NORMAL });
    await ZBBAutomation.delay(1800);

    // ============ 步骤 6: A11y 找"复制" + 点复制 (有界面变化) ============
    console.log('[千机:步骤6] A11y 找"复制"...');
    const step6Ok = await findWithRecovery(
      '千机:步骤6:复制',
      async () => !!(await a11y.findByText('复制'))
    );
    if (!step6Ok) {
      throw new RetryFlowError('步骤6: 未找到"复制"');
    }
    console.log(`[千机:步骤6] 找到"复制", 点击 (中等偏移 NORMAL 档)`);
    await click.byText('复制', { level: HumanLevel.NORMAL });
    await ZBBAutomation.delay(1800);

    // ============ 步骤 7: 拉起企业微信 (后续保利端两轮报备从这里接手) ============
    console.log('[千机:步骤7] 拉起企业微信 (后续保利端接力)');
    await ZBBAutomation.launchApp(APP_PACKAGES.WECHAT_WORK);
    await ZBBAutomation.delay(2000);

    console.log('========== 千机端流程完成 ==========');
    return varB;
  } catch (error) {
    // RetryFlowError 抛出, 让 withFlowRetry 处理 (返回 + 重进 + 重试整条)
    if (error instanceof RetryFlowError) {
      throw error;
    }
    // 真异常 → return null (不 raiseAlert, 让 HomeScreen 统一弹窗)
    console.error('[千机端] 流程失败:', error);
    return null;
  }
}

// ============================================================
// 保利端 13 步骤流程: 真实实现在 ./baoli.ts (V4.x 老板 08-23 拍板连续编号)
// 本文件只定义千机端流程, 保利端从 './baoli' 导入
// ============================================================

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

function extractGender(lines: string[]): '男' | '女' | null {
  for (const line of lines) {
    if (line.includes('先生')) return '男';
    if (line.includes('女士') || line.includes('小姐') || line.includes('太太')) return '女';
  }
  return null;
}

/**
 * 检测项目类型 (08-25 老板拍板 B 方案: 保利/越秀/招商等)
 *
 * 实战反证金标准:
 *   - 项目名含 "保利" → 'baoli' (默认, V2.x V22.x 实战反证金标准)
 *   - 含 "越秀" → 'yuexiu' (07-09 老板拍板双支持)
 *   - 含 "招商" → 'zhaoshang' (08-25 后续扩展)
 *   - 其他/未识别 → 'unknown' (上层 Orchestrator 跳过 + 提示用户)
 */
function detectProjectType(lines: string[]): string {
  const allText = lines.join(' ');
  if (allText.includes('保利')) return 'baoli';
  if (allText.includes('越秀')) return 'yuexiu';
  if (allText.includes('招商')) return 'zhaoshang';
  return 'unknown';
}

/**
 * 读"报备待审核"下方的数字 (08-25 V2.x 实战反证金标准: ±200px + X ±200px)
 *
 * 实战反证金标准 (V2.x v22.02.35 QianjiService.ts:469-485):
 *   - 旧方案 v19.9 bug: 硬 px 坐标 nova 历史值 (107, 680) → vivo 真机偏移 ~226px 落空
 *   - 修法: 语义匹配"报备待审核"label, 下方 ±200px + X ±200px 范围内最近的纯数字节点
 *   - 实战反证金标准偏差: 我之前 ±30px 太严, 跨机型失败 (mock 千机界面 layout 跟 nova 不同)
 *
 * @returns 数字 (找不到返 0, 实战反证金标准: 永远不返 -1, 0 触发下滑刷新)
 */
function readReportCountFromNodes(nodes: A11yNode[]): number {
  const labelNode = nodes.find(n => n.text?.includes('报备待审核'));
  if (!labelNode) return 0; // 找不到关键字, 兜底返 0 (实战反证金标准: 0 = 无报备, 走下滑刷新路径)

  // V2.x 实战反证金标准: label 下方 ±200px + X ±200px 范围内最近的纯数字节点
  const pendingNode = nodes.find(n =>
    n !== labelNode &&
    /^\d+$/.test((n.text || '').trim()) &&
    Math.abs((n.centerX ?? 0) - (labelNode.centerX ?? 0)) < 200 &&
    (n.centerY ?? 0) > (labelNode.centerY ?? 0) &&
    (n.centerY ?? 0) < (labelNode.centerY ?? 0) + 200
  );

  if (pendingNode) {
    return parseInt(pendingNode.text!.trim(), 10);
  }

  // 找不到数字 → 兜底返 0 (不返 -1)
  return 0;
}

/**
 * 解析变量 A (08-25 老板拍板 A+B 方案: 轻量级,只用于 A vs B 对比)
 *
 * 实战反证金标准 (08-25):
 *   - varA 只解析 3 字段 (项目名/姓名/电话), 用于 A vs B 对比
 *   - varA 不参与写库, 对比成功后直接用 varB 写库
 *   - mock 千机首页 a11y 节点是整句 "客户姓名 陈杰，点击复制" / "联系方式 192****7209"
 *   - 首页没 "报备项目:" key 节点, 项目名直接是卡片标题 "保利缦城和颂"
 *
 * @returns 仅返回 { projectName, customerName, phone } 3 字段
 */
function parseVariableAFromNodes(nodes: A11yNode[]): { projectName: string; customerName: string; phone: string } {
  const lines = assembleKeyValueLines(nodes);

  let projectName = '';
  let customerName = '';
  let phoneRaw = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 项目名: 先尝试"报备项目:" key:value 形式
    if (!projectName && trimmed.includes('报备项目')) {
      const m = trimmed.match(/报备项目\s*[:：]?\s*(.+)$/);
      if (m) {
        projectName = m[1].trim();
        continue;
      }
    }

    // 项目名 fallback (08-25 实战反证金标准):
    //   mock 千机首页"保利缦城和颂"是独立卡片标题节点 (红字),
    //   不带"报备项目:"前缀, 也不带"保利"前缀 (可能直接是"保利缦城和颂")
    //   → 节点 text 匹配 (保利|越秀|招商) + 后面跟项目名 = 提取
    //   排除 false positive: "公司名称: 贝壳" / "客户姓名: 陈杰" 等
    if (!projectName) {
      // 实战反证金标准: 项目名通常 4-12 字, 不能太长 (排除地址/句子)
      const m = trimmed.match(/^((?:保利|越秀|招商)[\u4e00-\u9fa5]{1,15})$/);
      if (m) {
        projectName = m[1].trim();
        continue;
      }
    }

    // 客户姓名
    if (!customerName && trimmed.includes('客户姓名')) {
      let name = trimmed.replace(/客户姓名\s*[:：]?\s*/g, '').trim();
      name = name.replace(/[，,]\s*点击复制.*$/, '').trim();
      name = name.replace(/点击复制.*$/, '').trim();
      customerName = name;
      continue;
    }

    // 联系方式 (mock 用空格 "联系方式 192****7209", 真千机用 ":" / ":")
    if (!phoneRaw && trimmed.includes('联系方式')) {
      const m = trimmed.match(/联系方式\s*[:：]?\s*(.+)$/);
      if (m) {
        phoneRaw = m[1].trim();
        phoneRaw = phoneRaw.replace(/[，,]\s*点击复制.*$/, '').trim();
        phoneRaw = phoneRaw.replace(/点击复制.*$/, '').trim();
      }
    }
  }

  return { projectName, customerName, phone: phoneRaw };
}

/**
 * 解析变量 B (08-25 老板拍板文档步骤5b: 10 字段全解析)
 *
 * 字段 (保利示例):
 *   公司名称: 贝壳
 *   客户姓名: 张先生
 *   客户性别: 男
 *   客户联系方式: 158****6577
 *   报备项目: 保利缦城和颂
 *   物业类型: 住宅
 *   报备提交时间: 2026/08/14 13:12
 *   预计到访时间: 2026-08-14 13:52
 *   经纪人姓名: 陈建行
 *   经纪人备注:
 *
 * 跟步骤4 的 stepParseCustomerInfo 复用 assembleKeyValueLines + extractValue
 */
function parseVariableBFromNodes(nodes: A11yNode[]): CustomerInfo {
  const lines = assembleKeyValueLines(nodes);

  // 复用 step4 的解析逻辑
  const phoneRaw = extractValue(lines, '客户联系方式') || extractValue(lines, '联系方式') || '';
  const phoneDigits = phoneRaw.match(/\d+/g)?.join('') || '';
  const phoneLast4 = phoneDigits.slice(-4);

  let phonePart1 = '', phonePart2 = '', phonePart3 = '';
  const phoneMatch = phoneRaw.match(/^(\d{3})(\*{4}|\d{4})(\d{3,4})$/);
  if (phoneMatch) {
    phonePart1 = phoneMatch[1];
    phonePart2 = phoneMatch[2];
    phonePart3 = phoneMatch[3];
  } else {
    phonePart1 = phoneDigits.slice(0, 3);
    phonePart3 = phoneDigits.slice(-3);
  }

  return {
    companyName: extractValue(lines, '公司名称') || '',
    customerName: extractValue(lines, '客户姓名') || extractValue(lines, '姓名') || '',
    customerGender: extractGender(lines) ?? '男',
    phone: phoneRaw,
    phonePart1,
    phonePart2,
    phonePart3,
    phoneLast4,
    projectName: extractValue(lines, '报备项目') || '',
    projectType: detectProjectType(lines),
    propertyType: extractValue(lines, '物业类型') || '',
    reportTime: extractValue(lines, '报备提交时间') || '',
    expectedVisitTime: extractValue(lines, '预计到访时间') || '',
    agent: extractValue(lines, '经纪人姓名') || '',
    agentPhone: extractValue(lines, '经纪人电话') || '',
    agentNote: extractValue(lines, '经纪人备注') || '',
    city: extractValue(lines, '城市') || '',
  };
}
