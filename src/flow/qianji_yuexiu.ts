/**
 * V4 千机端 - 越秀独立流程 (V32.36.117 老板 09-24 拍板)
 *
 * 老板拍板 V32.36.117: 千机端分 2 套独立代码 (baoli / yuexiu)
 *
 * 越秀千机端步骤 3-7 (V32.36.114 + V32.36.116 老板拍板):
 *   步骤 3: 仿 V2 越秀分支 - 跳过"找转发", 从 varA 直接提取脱敏号码
 *   步骤 4: 写库 (V32.36.52 markReportDone 复用, yuexiu 单写)
 *   步骤 5: 点 * 复制脱敏号码 (V32.36.116 简化: 点 * + 等 1s, 不等屏幕通知)
 *   步骤 6: V32.36.98 按 Home 键 + 返回桌面
 *
 * 关键差异 (跟保利的本质区别):
 *   - 不走"找转发"流程 (老板 V32.36.114 拍板"不做A、B对比")
 *   - 仿 V2 QianjiService.ts:659-672 越秀分支
 *   - 脱敏号码直接从 varA.phone 提取 (V32.36.117 老板 17:20 反证: varA 已含 "联系方式 *******5484")
 *   - 不做 A/B 对比 (varA = 越秀客户唯一信息源)
 */

import { ZBBAutomation } from '@/native';
import { logger } from '@/utils/logger';
import { stepWriteToReports } from './qianji';
import { navBarHomeDp, px as dpToPxForNav } from '@/utils/DpUtil';
import type { CustomerInfo } from './qianji';

export async function runQianjiForYuexiu(varA: any): Promise<CustomerInfo | null> {
  logger.info('千机:越秀', `走越秀独立流程 (V32.36.117 老板拍板 2套分流, 仿V2)`);

  // 步骤 3: 仿 V2 越秀分支 - 从 varA 直接提取脱敏号码
  //   老板 nova 17:20 log: varA.phone = "联系方式 *******5484" (脱敏号码已在 varA 里)
  //   V32.36.114 老板拍板: 越秀不走"找转发", 仿 V2 QianjiService.ts:659-672
  const phoneRaw = varA.phone || '';
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const phoneLast4 = phoneDigits.slice(-4);
  if (!phoneLast4) {
    logger.error('千机:越秀:步骤3', `varA.phone 为空, 没法提取脱敏号码: "${phoneRaw}"`);
    return null;
  }
  logger.info('千机:越秀:步骤3', `从 varA 提取脱敏号码: phoneLast4=${phoneLast4} (V32.36.117 仿V2, 不走点 *)`);

  // 构造 customer (yuexiu)
  const customer: CustomerInfo = {
    companyName: '',
    customerName: varA.customerName,
    customerGender: '男',
    phone: phoneRaw,
    phonePart1: phoneDigits.slice(0, 3),
    phonePart2: '****',
    phonePart3: phoneDigits.slice(-3),
    phoneLast4,
    projectName: varA.projectName,
    projectType: 'yuexiu',
    propertyType: '',
    reportTime: '',
    expectedVisitTime: '',
    agent: '',
    agentPhone: '',
    agentNote: '',
    city: '',
  };

  // 步骤 4: 写库 (V32.36.52 markReportDone 复用, yuexiu 单写)
  const reportIdsRaw = await stepWriteToReports(customer);
  const reportId = Array.isArray(reportIdsRaw) ? reportIdsRaw[0] : (reportIdsRaw as number);
  customer.reportIds = [reportId, reportId];
  logger.info('千机:越秀:步骤4', `写库完成 (yuexiu): reportId=${reportId}`);

  // 步骤 5: 点 * 复制脱敏号码 (V32.36.116 简化: 点 * + 等 1s, 不等屏幕通知)
  logger.info('千机:越秀:步骤5', '点 * 复制脱敏号码 (V32.36.116 老板拍板 不等屏幕通知)');
  try {
    const copyOk = await ZBBAutomation.clickByText?.('*', false);
    if (copyOk) {
      await ZBBAutomation.delay(1000);
      logger.info('千机:越秀:步骤5', '✓ 复制完成 (best-effort)');
    } else {
      logger.warn('千机:越秀:步骤5', '点 * 失败, 跳过 (剪贴板可能未复制, 越秀步骤10 粘贴会失败)');
    }
  } catch (e: any) {
    logger.warn('千机:越秀:步骤5', `点 * 异常: ${e}`);
  }

  // 步骤 6: V32.36.98 按 Home 键 + 返回桌面
  logger.info('千机:越秀:步骤6', '按 Home 键 + 返回桌面 (V32.36.98 老板拍板)');
  try {
    const homeDelay = 1000 + Math.floor(Math.random() * 500);
    await ZBBAutomation.delay(homeDelay);
    const homeHookDp = navBarHomeDp();
    await ZBBAutomation.click(dpToPxForNav(homeHookDp.x), dpToPxForNav(homeHookDp.y));
    await ZBBAutomation.delay(500);
    logger.info('千机:越秀:步骤6', '✓ 已返回桌面');
  } catch (homeErr) {
    logger.warn('千机:越秀:步骤6', `Home 键失败 (best-effort): ${homeErr}`);
  }

  return customer;
}
