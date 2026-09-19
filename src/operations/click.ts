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
 *
 * V32.36.22 (09-19 老板 nova 装机实测 - 老板拍板重新build):
 *   老板实测 V32.36.21 5s 后 Promise.race 返 false, 但 native findElementByText 还在后台跑
 *   真因: JS Promise.race 不能中断已经在跑的 native a11y dump 调用
 *   修法: 不调 findElementByText, 改用 getAllTextNodes 单次 dump (跟 V32.36.18 judge.isScreenText 同思路)
 *     - getAllTextNodes 单次 dump (V32.36.18 已验 nova 上能返回 WebView 外层节点)
 *     - 找到节点 → 用 node 调 ZBBAutomation.click(x, y) (跟 click.byNode 等价)
 *     - 找不到 → 返 false
 *     - 不阻塞, 不卡 native 调用
 *     - Promise.race 5s 兜底, 万一 getAllTextNodes 也卡死也能返 false
 */
export async function byText(
  text: string,
  options?: { timeoutMs?: number; level?: HumanLevel },
): Promise<boolean> {
  const level = options?.level ?? HumanLevel.PRECISE;

  // V32.36.22 老板 09-19 拍板重新build: 用 getAllTextNodes 单次 dump (跟 V32.36.18 judge.isScreenText 同款)
  //   不用 findElementByText (native 端在 WebView 卡死, JS Promise.race 无效)
  const lookupPromise = (async () => {
    try {
      // V32.36.18 验证: getAllTextNodes 单次 dump 在 nova WebView 上能返回外层节点
      const nodes = await ZBBAutomation.getAllTextNodes();
      // 模糊匹配 (跟 judge.isScreenText 同款)
      const node = nodes.find((n: any) => n?.text?.toString()?.includes(text));
      if (!node || node.centerX === undefined || node.centerY === undefined) {
        logger.warn('click.byText', `getAllTextNodes 没找到: "${text}"`);
        return false;
      }
      const { x, y } = applyHumanOffset(node.centerX, node.centerY, level);
      logger.info('click.byText', `找到 "${text}" @ (${node.centerX}, ${node.centerY}) → tap (${x}, ${y})`);
      return ZBBAutomation.click(x, y);
    } catch (e) {
      logger.warn('click.byText', `getAllTextNodes 异常: "${text}" - ${e}`);
      return false;
    }
  })();

  // V32.36.21 兜底: Promise.race 5s 超时, 万一 getAllTextNodes 也卡死
  let timeoutHandle: any = null;
  const timeoutPromise = new Promise<boolean>(resolve => {
    timeoutHandle = setTimeout(() => {
      logger.warn('click.byText', `getAllTextNodes 超时 (5s): "${text}" (V32.36.22 兜底)`);
      resolve(false);
    }, DEFAULT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([lookupPromise, timeoutPromise]);
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
 *
 * V32.36.22 老板 09-19 拍板重新build: 跟 byText 同款, 用 getAllTextNodes 不用 findElementByViewId
 *   (native 端 findElementByViewId 在 WebView 也卡死, 跟 findElementByText 同问题)
 *   注: viewId 在 WebView 里通常不可见, 老板 nova 实际使用 byId 场景很少, 兜底返 false
 */
export async function byId(viewId: string, level: HumanLevel = HumanLevel.PRECISE): Promise<boolean> {
  const lookupPromise = (async () => {
    try {
      // V32.36.22: 改用 getAllTextNodes (native findElementByViewId 在 WebView 也卡死)
      const nodes = await ZBBAutomation.getAllTextNodes();
      const node = nodes.find((n: any) => n?.viewId?.toString() === viewId);
      if (!node || node.centerX === undefined || node.centerY === undefined) {
        logger.warn('click.byId', `没找到 viewId: "${viewId}" (WebView 里通常不可见)`);
        return false;
      }
      const { x, y } = applyHumanOffset(node.centerX, node.centerY, level);
      return ZBBAutomation.click(x, y);
    } catch (e) {
      logger.warn('click.byId', `getAllTextNodes 异常: "${viewId}" - ${e}`);
      return false;
    }
  })();

  let timeoutHandle: any = null;
  const timeoutPromise = new Promise<boolean>(resolve => {
    timeoutHandle = setTimeout(() => {
      logger.warn('click.byId', `getAllTextNodes 超时 (5s): "${viewId}" (V32.36.22 兜底)`);
      resolve(false);
    }, DEFAULT_TIMEOUT_MS);
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
