/**
 * V4.x a11y module (老板实测 08-22)
 *
 * A11y (无障碍服务) 操作封装:
 * - findByText(text)         按文字找节点 (V32.36.23 改用 getAllTextNodes, 绕开 native 卡死)
 * - findByViewId(viewId)     按 viewId 找节点 (V32.36.23 改用 getAllTextNodes)
 * - findClickable()          找所有可点击节点
 * - findByBounds(x, y)       按坐标找节点 (反查 bounds)
 * - getWindowTree()          获取整棵 UI 树
 */

import { ZBBAutomation } from '@/native';
import type { A11yNode } from '@/native';

// V32.36.23 老板 09-19 实测 (老板 nova 装机 - 修法):
//   之前 a11y.findByText / findByViewId 调 native findElementByText / findElementByViewId
//   在企微 WebView 上 a11y dump 卡死 (跟 click.byText 同问题)
//   修法: 改用 getAllTextNodes 单次 dump (跟 click.byText V32.36.22 思路一致)
//   - findByText: 模糊匹配 includes(text), 过滤 centerX > 0 (老板 09-19 实测 -152 负值 bug)
//   - findByViewId: 精确匹配 viewId, 同款过滤
export async function findByText(text: string): Promise<A11yNode | null> {
  try {
    const nodes = await ZBBAutomation.getAllTextNodes();
    return nodes.find((n: any) =>
      n?.text?.toString()?.includes(text) &&
      n.centerX > 0 && n.centerY > 0
    ) || null;
  } catch {
    return null;
  }
}

export async function findByViewId(viewId: string): Promise<A11yNode | null> {
  try {
    const nodes = await ZBBAutomation.getAllTextNodes();
    return nodes.find((n: any) =>
      n?.viewId?.toString() === viewId &&
      n.centerX > 0 && n.centerY > 0
    ) || null;
  } catch {
    return null;
  }
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
