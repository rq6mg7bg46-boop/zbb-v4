/**
 * V4 千机端 - 保利独立流程 (V32.36.117 老板 09-24 拍板)
 *
 * 老板拍板 V32.36.117: 千机端分 2 套独立代码 (baoli / yuexiu), 各自维护
 *   - 优势: 零耦合, 可读性高, 故障隔离, 扩展性好
 *   - 跟 V2 反证金标准一致: QianjiService.ts:659-672 hasYuexiu 分流
 *
 * 保利千机端步骤 3-7:
 *   步骤 3: A11y 找"转发" + 点 (V32.36.74 findWithRecovery + 上滑重试)
 *   步骤 4: A11y 找"公司名称" + 解析 varB (10字段) + A vs B 对比 (V32.36.83 三次不一致报警)
 *   步骤 5: A11y 找"转发" (第二次, 进对象选择页) + 点
 *   步骤 6: A11y 找"复制" + 点 (写库前复制脱敏号码到剪贴板)
 *   步骤 7: V32.36.98 按 Home 键 + 返回桌面
 */

import { ZBBAutomation } from '@/native';
import { logger } from '@/utils/logger';
import { click, a11y, judge, pressKey, swipe } from '@/operations';
import { findWithRecovery, RetryFlowError, waitForScreenChange } from './retryUtils';
import { stepWriteToReports, parseVariableBFromNodes } from './qianji';
import { compareCustomer, formatCompareResult } from '@/utils/compareCustomer';
import { raiseAlert } from '@/services/alert';
import { getDeviceFallbackCoords } from '@/utils/deviceFallback';
import { navBarHomeDp, px as dpToPxForNav } from '@/utils/DpUtil';
import { getRecentReports } from '@/services/database';
import type { CustomerInfo } from './qianji';

let _mismatchRetryCount = 0;
const MISMATCH_MAX_RETRIES = 3;

export async function runQianjiForBaoli(varA: any): Promise<CustomerInfo | null> {
  logger.info('千机:保利', `走保利独立流程 (V32.36.117 老板拍板 2套分流)`);

  // 步骤 3: A11y 找"转发"
  const step3Ok = await findWithRecovery(
    '千机:保利:步骤3:转发',
    async () => !!(await a11y.findByText('转发')),
    async () => {
      await swipe.up();
      await ZBBAutomation.delay(1500);
    }
  );
  if (!step3Ok) {
    throw new RetryFlowError('保利步骤3: 上滑3次仍未找到"转发"');
  }
  logger.info('千机:保利:步骤3', `找到"转发", 点击 (中等偏移 NORMAL 档)`);
  await click.byText('转发', { level: 'normal' });
  await ZBBAutomation.delay(1800);

  // 步骤 4: A11y 找"公司名称" + 解析 varB + A vs B 对比
  const { waitForScreenChange } = await import('./retryUtils');
  const step4NodesFound = await waitForScreenChange(
    '千机:保利:步骤4:公司名称',
    async () => {
      const nodes = await ZBBAutomation.getAllTextNodes();
      return nodes.some(n => n.text?.includes('公司名称'));
    }
  );
  if (!step4NodesFound) {
    throw new RetryFlowError('保利步骤4: 等待"公司名称"超时');
  }

  const step4Nodes = await ZBBAutomation.getAllTextNodes();
  const varB = parseVariableBFromNodes(step4Nodes);

  const compareResult = compareCustomer(
    { projectName: varA.projectName, customerName: varA.customerName, phone: varA.phone },
    { projectName: varB.projectName, customerName: varB.customerName, phone: varB.phone },
  );
  logger.info('千机:保利:步骤4', `A vs B 对比: ${formatCompareResult(compareResult)}`);

  if (!compareResult.isMatch) {
    _mismatchRetryCount++;
    const diffMsg = compareResult.diffs.map(d => `${d.field}: A="${d.aValue}" vs B="${d.bValue}"`).join('; ');
    logger.warn('千机:保利:步骤4', `不一致 (${_mismatchRetryCount}/${MISMATCH_MAX_RETRIES}): ${diffMsg}`);
    await pressKey.back();
    await ZBBAutomation.delay(1000);

    if (_mismatchRetryCount >= MISMATCH_MAX_RETRIES) {
      const { raiseAlert } = await import('@/services/alert');
      const dialogMessage = '小主,流程出问题了(千机端首页vs转发页连续3次不一致),请手动处理!';
      logger.error('千机:保利:步骤4', `${dialogMessage}`);
      logger.error('千机:保利:步骤4', `差异详情: ${diffMsg}`);
      await raiseAlert(dialogMessage);
      _mismatchRetryCount = 0;
      return null;
    }
    throw new RetryFlowError(`保利步骤4: A vs B 不一致 (${_mismatchRetryCount}/${MISMATCH_MAX_RETRIES})`);
  }

  _mismatchRetryCount = 0;
  logger.info('千机:保利:步骤4', `✓ A vs B 一致, 用 varB 写库`);
  const writeResult = await stepWriteToReports(varB);
  if (Array.isArray(writeResult)) {
    varB.reportIds = writeResult as [number, number];
    logger.info('千机:保利:步骤4', `保利双写: ID=${writeResult.join(',')} → 传给 baoli`);
  } else {
    logger.info('千机:保利:步骤4', `单写: ID=${writeResult}`);
  }

  // 步骤 5: A11y 找"转发" (第二次, 进对象选择页)
  const step5Ok = await findWithRecovery(
    '千机:保利:步骤5:转发',
    async () => {
      const node = await a11y.findByText('转发');
      if (!node) return false;
      const bounds = node.bounds;
      if (bounds && (bounds.left === 0 && bounds.top === 0 && bounds.right === 0 && bounds.bottom === 0)) return false;
      const className = node.className ?? '';
      if (!/Button|button/i.test(className)) return false;
      const text = node.text ?? '';
      const contentDesc = (node as any).contentDesc ?? '';
      if (!text && !contentDesc) return false;
      return true;
    }
  );
  if (step5Ok) {
    logger.info('千机:保利:步骤5', `找到"转发", 点击 (中等偏移 NORMAL 档)`);
    await click.byText('转发', { level: 'normal' });
  } else {
    const fallback = await getDeviceFallbackCoords();
    if (fallback) {
      const dp = fallback.forwardBtn;
      logger.info('千机:保利:步骤5', `A11y 找不到, 用 fallback 坐标 dp=(${dp.x}, ${dp.y})`);
      await click.byCoords(dp.x, dp.y);
    } else {
      throw new RetryFlowError('保利步骤5: 未找到"转发"且无 fallback 坐标');
    }
  }
  await ZBBAutomation.delay(1800);

  // 步骤 6: A11y 找"复制" + 点
  const step6Ok = await findWithRecovery(
    '千机:保利:步骤6:复制',
    async () => {
      const node = await a11y.findByText('复制');
      if (!node) return false;
      const bounds = node.bounds;
      if (bounds && (bounds.left === 0 && bounds.top === 0 && bounds.right === 0 && bounds.bottom === 0)) return false;
      const className = node.className ?? '';
      if (!/Button|button/i.test(className)) return false;
      const text = node.text ?? '';
      const contentDesc = (node as any).contentDesc ?? '';
      if (!text && !contentDesc) return false;
      return true;
    }
  );
  if (step6Ok) {
    logger.info('千机:保利:步骤6', `找到"复制", 点击 (中等偏移 NORMAL 档)`);
    await click.byText('复制', { level: 'normal' });
  } else {
    const fallback = await getDeviceFallbackCoords();
    if (fallback) {
      const dp = fallback.copyBtn;
      logger.info('千机:保利:步骤6', `A11y 找不到, 用 fallback 坐标 dp=(${dp.x}, ${dp.y})`);
      await click.byCoords(dp.x, dp.y);
    } else {
      throw new RetryFlowError('保利步骤6: 未找到"复制"且无 fallback 坐标');
    }
  }
  await ZBBAutomation.delay(1800);

  // 步骤 7: V32.36.98 按 Home 键 + 返回桌面
  logger.info('千机:保利:步骤7', '按 Home 键 + 返回桌面 (V32.36.98 老板拍板)');
  try {
    const homeDelay = 1000 + Math.floor(Math.random() * 500);
    await ZBBAutomation.delay(homeDelay);
    const homeHookDp = navBarHomeDp();
    await ZBBAutomation.click(dpToPxForNav(homeHookDp.x), dpToPxForNav(homeHookDp.y));
    await ZBBAutomation.delay(500);
    logger.info('千机:保利:步骤7', '✓ 已返回桌面');
  } catch (homeErr) {
    logger.warn('千机:保利:步骤7', `Home 键失败 (best-effort): ${homeErr}`);
  }

  return varB;
}
