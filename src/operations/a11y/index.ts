/**
 * V4.x a11y module (老板实测 08-22)
 *
 * A11y (无障碍服务) 操作封装:
 * - findByText(text)         按文字找节点
 * - findByViewId(viewId)     按 viewId 找节点
 * - findClickable()          找所有可点击节点
 * - findByBounds(x, y)       按坐标找节点 (反查 bounds)
 * - getWindowTree()          获取整棵 UI 树
 */

import { ZBBAutomation } from '@/native';
import type { A11yNode } from '@/native';

export async function findByText(text: string): Promise<A11yNode | null> {
  return ZBBAutomation.findElementByText(text);
}

export async function findByViewId(viewId: string): Promise<A11yNode | null> {
  return ZBBAutomation.findElementByViewId(viewId);
}

export async function findClickable(): Promise<A11yNode[]> {
  return ZBBAutomation.getClickableElements();
}

export async function findByBounds(
  x: number,
  y: number,
): Promise<A11yNode | null> {
  // 反查: 遍历所有可点击节点, 找包含 (x,y) 的
  const nodes = await ZBBAutomation.getClickableElements();
  for (const node of nodes) {
    if (!node.bounds) continue;
    const { left, top, right, bottom } = node.bounds;
    if (x >= left && x <= right && y >= top && y <= bottom) {
      return node;
    }
  }
  return null;
}

export async function getWindowTree(): Promise<boolean> {
  // V2.x native dumpWindowTree 返回 boolean (写到 logcat)
  return ZBBAutomation.dumpWindowTree();
}

export const a11y = {
  findByText,
  findByViewId,
  findClickable,
  findByBounds,
  getWindowTree,
};
export default a11y;
