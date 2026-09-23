/**
 * V4.x longPress operation (老板实测 08-22)
 *
 * 长按 = 按住 + 持续时间 + 释放
 * - byText(text, durationMs)    按文字找节点 + 长按中心 (默认 600ms)
 * - byNode(node, durationMs)    按节点长按
 * - byCoords(x, y, durationMs)  按坐标长按
 */

import { ZBBAutomation, A11yNode } from '@/native';
import { applyHumanOffset, HumanLevel } from '@/utils/HumanOffset';
import { logger } from '@/utils/logger';
import { px as dpToPx } from '@/utils/DpUtil'; // V32.36.97 老板 09-23 拍板: longPress.byCoords 接 dp 入参, 内部 px() 转

const DEFAULT_DURATION_MS = 600;

async function longPressAt(
  x: number,
  y: number,
  durationMs: number,
  level: HumanLevel,
): Promise<boolean> {
  const { x: hx, y: hy } = applyHumanOffset(x, y, level);
  return ZBBAutomation.longClick(hx, hy, durationMs, true);
}

/**
 * 按文字长按 (默认 600ms, PRECISE 档 ±2/±2)
 */
export async function byText(
  text: string,
  durationMs: number = DEFAULT_DURATION_MS,
  level: HumanLevel = HumanLevel.PRECISE,
): Promise<boolean> {
  const node = await ZBBAutomation.findElementByText(text);
  if (!node || node.centerX === undefined || node.centerY === undefined) {
    logger.warn('longPress.byText', `没找到: "${text}"`);
    return false;
  }
  return longPressAt(node.centerX, node.centerY, durationMs, level);
}

/**
 * 按 A11y 节点长按
 */
export async function byNode(
  node: A11yNode,
  durationMs: number = DEFAULT_DURATION_MS,
  level: HumanLevel = HumanLevel.PRECISE,
): Promise<boolean> {
  if (!node || node.centerX === undefined || node.centerY === undefined) {
    logger.warn('longPress.byNode', `节点无效: ${node}`);
    return false;
  }
  return longPressAt(node.centerX, node.centerY, durationMs, level);
}

/**
 * 按坐标长按 (V32.36.97 老板 09-23 拍板: 接 dp 入参, 内部 px() 转)
 *   修前: longPress.byCoords(540, 896) → 直接当 px 用, nova density 3.0 上点错位置
 *   修后: longPress.byCoords(180, 299) → dp 入参, 内部 px(180)=540 px / px(299)=897 px, nova 实测命中
 */
export async function byCoords(
  dpX: number,
  dpY: number,
  durationMs: number = DEFAULT_DURATION_MS,
  level: HumanLevel = HumanLevel.PRECISE,
): Promise<boolean> {
  const x = dpToPx(dpX);
  const y = dpToPx(dpY);
  const { x: hx, y: hy } = applyHumanOffset(x, y, level);
  logger.info('longPress.byCoords', `tap dp(${dpX}, ${dpY}) → px(${x}, ${y}) → tap (${hx}, ${hy}) [V32.36.97]`);
  return ZBBAutomation.longClick(hx, hy, durationMs, true);
}

export const longPress = { byText, byNode, byCoords };
export default longPress;
