/**
 * V4.x click operation (老板实战反证金标准 08-22)
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

import ZBBAutomation, { A11yNode } from '@/native';
import { applyHumanOffset, HumanLevel } from '@/utils/HumanOffset';

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
 * 按文字点击 (自动 OCR/A11y 找节点 + 点击中心)
 */
export async function byText(
  text: string,
  options?: { timeoutMs?: number; useOcr?: boolean },
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const useOcr = options?.useOcr ?? false;

  if (useOcr) {
    // OCR 模式: 截图 + ML Kit 找文字 + 点击
    const result = await waitForCondition(
      async () => {
        const r = await ZBBAutomation.screenshotAndFindText(text);
        return r?.found ? r : null;
      },
      timeoutMs,
    );
    if (!result || !result.x || !result.y) {
      console.warn(`[click.byText] OCR 没找到: "${text}"`);
      return false;
    }
    const { x, y } = applyHumanOffset(result.x, result.y);
    return ZBBAutomation.click(x, y);
  }

  // A11y 模式 (默认): 用 findElementByText
  const node = await waitForCondition(
    async () => {
      const n = await ZBBAutomation.findElementByText(text);
      return n && n.centerX !== undefined ? n : null;
    },
    timeoutMs,
  );
  if (!node || node.centerX === undefined || node.centerY === undefined) {
    console.warn(`[click.byText] A11y 没找到: "${text}"`);
    return false;
  }
  const { x, y } = applyHumanOffset(node.centerX, node.centerY);
  return ZBBAutomation.click(x, y);
}

/**
 * 按 A11y 节点点击
 */
export async function byNode(node: A11yNode, level: HumanLevel = HumanLevel.PRECISE): Promise<boolean> {
  if (!node || node.centerX === undefined || node.centerY === undefined) {
    console.warn(`[click.byNode] 节点无效:`, node);
    return false;
  }
  const { x, y } = applyHumanOffset(node.centerX, node.centerY, level);
  return ZBBAutomation.click(x, y);
}

/**
 * 按 viewId 点击
 */
export async function byId(viewId: string, level: HumanLevel = HumanLevel.PRECISE): Promise<boolean> {
  const node = await ZBBAutomation.findElementByViewId(viewId);
  if (!node || node.centerX === undefined || node.centerY === undefined) {
    console.warn(`[click.byId] 没找到: "${viewId}"`);
    return false;
  }
  const { x, y } = applyHumanOffset(node.centerX, node.centerY, level);
  return ZBBAutomation.click(x, y);
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
