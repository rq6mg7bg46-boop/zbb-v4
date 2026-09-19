/**
 * V4.x click operation (老板实测 08-22)
 *
 * 5 个 method:
 * - byText(text)         按文字找节点 + 点击中心
 * - byNode(node)         A11y 节点 + 点击中心
 * - byId(viewId)         按 viewId 找节点 + 点击中心
 * - byBounds(bounds)     按 bounds 中心点击
 * - byCoords(x, y)       按坐标点击
 *
 * 业务流程调用:
 *   import { click } from '@/operations/click';
 *   await click.byText('开始');
 */

import { ZBBAutomation, A11yNode } from '@/native';
import { applyHumanOffset, HumanLevel } from '@/utils/HumanOffset';
import { logger } from '@/utils/logger';

const DEFAULT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

async function waitForCondition<T>(
  predicate: () => Promise<T | null | undefined | false>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  pollMs: number = POLL_INTERVAL_MS,
): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await predicate();
    if (result) return result as T;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return null;
}

/**
 * 按文字点击 (A11y 找节点 + 点击中心)
 * V32.36.7: OCR 已禁用, 只用 A11y (findElementByText)
 *
 * @param text 目标文字
 * @param options.level HumanLevel 档位 (PRECISE=±2px / NORMAL=±5px / WIDE=±10px)
 *                    文档步骤4 "中等坐标偏移" 对应 NORMAL, 默认 PRECISE
 */
/**
 * 按文字查找节点 + 点击中心 (A11y)
 *
 * V32.36.21 (09-19 老板 nova 装机实测 - 老板拍板统一修):
 *   之前老板报"卡住, 后续所有 click.byText 都需要排查", 一致性问题
 *   真因: ZBBAutomation.findElementByText 内部 a11y dump 在企微 WebView 内卡死,
 *         waitForCondition 等不到 → 永久阻塞 caller
 *   修法 (老板 09-19 拍板): 包 Promise.race, 5s 超时后返 false 不阻塞 caller
 *     - 5s 还没找到 → 返回 false (跟之前 A11y 没找到行为一致)
 *     - V4 全局 click.byText 调用点都受保护 (baoli step5/6/... + 千机 + 其他 13+ 处)
 *     - 不需要每个 caller 都改成 click.byNode / click.byCoords
 */
export async function byText(
  text: string,
  options?: { timeoutMs?: number; level?: HumanLevel },
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const level = options?.level ?? HumanLevel.PRECISE;

  // V32.36.7: A11y only, OCR 已禁用 (老板拍板)
  // V32.36.21 老板 09-19 拍板: Promise.race 5s 超时保护, 防止 a11y dump 卡死阻塞整个 V4 caller
  const lookupPromise = (async () => {
    const node = await waitForCondition(
      async () => {
        const n = await ZBBAutomation.findElementByText(text);
        return n && n.centerX !== undefined ? n : null;
      },
      timeoutMs,
    );
    if (!node || node.centerX === undefined || node.centerY === undefined) {
      logger.warn('click.byText', `A11y 没找到: "${text}"`);
      return false;
    }
    const { x, y } = applyHumanOffset(node.centerX, node.centerY, level);
    return ZBBAutomation.click(x, y);
  })();

  // V32.36.21: 老板 09-19 拍板统一修 - 5s 硬超时, 返 false 不阻塞 caller
  let timeoutHandle: any = null;
  const timeoutPromise = new Promise<boolean>(resolve => {
    timeoutHandle = setTimeout(() => {
      logger.warn('click.byText', `a11y lookup 超时 (${timeoutMs}ms): "${text}" (老板 09-19 拍板: 返 false 不阻塞)`);
      resolve(false);
    }, timeoutMs + 500);  // 给 waitForCondition 多 500ms 缓冲
  });

  try {
    const result = await Promise.race([lookupPromise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * 按 A11y 节点点击
 */
export async function byNode(node: A11yNode, level: HumanLevel = HumanLevel.PRECISE): Promise<boolean> {
  if (!node || node.centerX === undefined || node.centerY === undefined) {
    logger.warn('click.byNode', `节点无效: ${node}`);
    return false;
  }
  const { x, y } = applyHumanOffset(node.centerX, node.centerY, level);
  return ZBBAutomation.click(x, y);
}

/**
 * 按 viewId 点击
 *
 * V32.36.21 老板 09-19 拍板统一修: Promise.race 5s 超时保护 (跟 byText 同款)
 */
export async function byId(viewId: string, level: HumanLevel = HumanLevel.PRECISE): Promise<boolean> {
  const lookupPromise = (async () => {
    const node = await ZBBAutomation.findElementByViewId(viewId);
    if (!node || node.centerX === undefined || node.centerY === undefined) {
      logger.warn('click.byId', `没找到: "${viewId}"`);
      return false;
    }
    const { x, y } = applyHumanOffset(node.centerX, node.centerY, level);
    return ZBBAutomation.click(x, y);
  })();

  let timeoutHandle: any = null;
  const timeoutPromise = new Promise<boolean>(resolve => {
    timeoutHandle = setTimeout(() => {
      logger.warn('click.byId', `a11y lookup 超时 (${DEFAULT_TIMEOUT_MS}ms): "${viewId}" (老板 09-19 拍板)`);
      resolve(false);
    }, DEFAULT_TIMEOUT_MS + 500);
  });

  try {
    return await Promise.race([lookupPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * 按 bounds 点击中心
 */
export async function byBounds(
  bounds: { left: number; top: number; right: number; bottom: number },
  level: HumanLevel = HumanLevel.PRECISE,
): Promise<boolean> {
  const x = Math.floor((bounds.left + bounds.right) / 2);
  const y = Math.floor((bounds.top + bounds.bottom) / 2);
  const { x: hx, y: hy } = applyHumanOffset(x, y, level);
  return ZBBAutomation.click(hx, hy);
}

/**
 * 按坐标点击
 */
export async function byCoords(
  x: number,
  y: number,
  level: HumanLevel = HumanLevel.PRECISE,
): Promise<boolean> {
  const { x: hx, y: hy } = applyHumanOffset(x, y, level);
  return ZBBAutomation.click(hx, hy);
}

export const click = { byText, byNode, byId, byBounds, byCoords };
export default click;
