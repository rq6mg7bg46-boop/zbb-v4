/**
 * V4.x longPress operation (老板实战反证金标准 08-22)
 *
 * 长按 = 按住 + 持续时间 + 释放
 * - byText(text, durationMs)    按文字找节点 + 长按中心 (默认 600ms)
 * - byNode(node, durationMs)    按节点长按
 * - byCoords(x, y, durationMs)  按坐标长按
 */

import ZBBAutomation, { A11yNode } from '@/native';

const DEFAULT_DURATION_MS = 600;

async function longPressAt(
  x: number,
  y: number,
  durationMs: number,
): Promise<boolean> {
  return ZBBAutomation.longClick(x, y, durationMs, true);
}

/**
 * 按文字长按 (默认 600ms)
 */
export async function byText(
  text: string,
  durationMs: number = DEFAULT_DURATION_MS,
): Promise<boolean> {
  const node = await ZBBAutomation.findElementByText(text);
  if (!node || node.centerX === undefined || node.centerY === undefined) {
    console.warn(`[longPress.byText] 没找到: "${text}"`);
    return false;
  }
  return longPressAt(node.centerX, node.centerY, durationMs);
}

/**
 * 按 A11y 节点长按
 */
export async function byNode(
  node: A11yNode,
  durationMs: number = DEFAULT_DURATION_MS,
): Promise<boolean> {
  if (!node || node.centerX === undefined || node.centerY === undefined) {
    console.warn(`[longPress.byNode] 节点无效:`, node);
    return false;
  }
  return longPressAt(node.centerX, node.centerY, durationMs);
}

/**
 * 按坐标长按
 */
export async function byCoords(
  x: number,
  y: number,
  durationMs: number = DEFAULT_DURATION_MS,
): Promise<boolean> {
  return longPressAt(x, y, durationMs);
}

export const longPress = { byText, byNode, byCoords };
export default longPress;
