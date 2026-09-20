/**
 * V4.x click module (老板实测 08-22)
 *
 * 点击操作封装:
 * - byText(text)            按文字找节点 + 点击中心 (V32.36.22 改用 getAllTextNodes)
 * - byNode(node)            A11y 节点 + 点击中心
 * - byId(viewId)            按 viewId 找节点 + 点击中心 (V32.36.22 改用 getAllTextNodes)
 * - byBounds(bounds)        按 bounds 点击中心
 * - byCoords(x, y)          按屏幕物理坐标点击 (V32.36.26 老板 nova hardcode 修法)
 *
 * 老板 09-19 nova 实测发现的 4 个核心问题 (V32.36.18-26 修法链):
 *  1. judge.isScreenText WebView dump 卡死 - V32.36.18 单次 dump 不重试
 *  2. click.byText findElementByText 卡死 - V32.36.22 改用 getAllTextNodes
 *  3. getAllTextNodes 返回 centerX/Y 负值 - V32.36.23 过滤 centerX > 0 && centerY > 0
 *  4. getAllTextNodes 坐标是 WebView 内部坐标, 不是物理屏幕坐标 - V32.36.26 hardcode byCoords 兜底
 *
 * 老板原话: '后续还会有很多类似的这种查找界面上指定的文字坐标, 然后点击这个坐标的操作.
 *  如果是这个方法出了问题, 是不是可以统一把这个方法修复掉?'
 *  → V32.36.21 老板拍板统一修 click.byText + byId Promise.race 5s 超时
 *  → V32.36.22 老板拍板重新build 改用 getAllTextNodes (绕开 native a11y dump 卡死)
 *  → V32.36.26 老板 nova 上 V4 dump 坐标错位, 加 byCoords hardcode 修法
 */

import { ZBBAutomation } from '@/native';
import { logger } from '@/utils/logger';
import type { A11yNode } from '@/native';

const DEFAULT_TIMEOUT_MS = 5000;

async function waitForCondition<T>(
  predicate: () => Promise<T | null>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch {
      // 忽略单次错误, 下一轮重试
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

export type HumanLevel = 'precise' | 'normal' | 'wide';

function applyHumanOffset(x: number, y: number, level: HumanLevel = 'precise'): { x: number; y: number } {
  let rangeX = 0;
  let rangeY = 0;
  if (level === 'precise') {
    rangeX = 2;
    rangeY = 2;
  } else if (level === 'normal') {
    rangeX = 5;
    rangeY = 5;
  } else if (level === 'wide') {
    rangeX = 10;
    rangeY = 5;
  }
  const dx = Math.floor(Math.random() * (rangeX * 2 + 1)) - rangeX;
  const dy = Math.floor(Math.random() * (rangeY * 2 + 1)) - rangeY;
  return { x: x + dx, y: y + dy };
}

/**
 * 按文字查找节点 + 点击中心 (A11y)
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
 *
 * V32.36.23 (09-19 老板 nova 装机实测):
 *   老板 nova 11:46 实测 getAllTextNodes 返回 centerX=-152 负值 (WebView 浮窗占位节点)
 *   修法: 过滤 centerX > 0 && centerY > 0, 跳过负值占位节点
 */
export async function byText(
  text: string,
  options?: { timeoutMs?: number; level?: HumanLevel },
): Promise<boolean> {
  const level = options?.level ?? 'precise';

  const lookupPromise = (async () => {
    try {
      const nodes = await ZBBAutomation.getAllTextNodes();
      const node = nodes.find((n: any) =>
        n?.text?.toString()?.includes(text) &&
        n.centerX > 0 && n.centerY > 0
      );
      if (!node || node.centerX === undefined || node.centerY === undefined) {
        logger.warn('click.byText', `getAllTextNodes 没找到有效节点: "${text}" (可能所有匹配节点坐标无效)`);
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
 * 按 A11y 节点点击 (用节点本身的 centerX/Y)
 */
export async function byNode(node: A11yNode, level: HumanLevel = 'precise'): Promise<boolean> {
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
 * V32.36.22 老板 09-19 拍板重新build: 跟 byText 同款, 用 getAllTextNodes 不用 findElementByViewId
 *   (native 端 findElementByViewId 在 WebView 也卡死, 跟 findElementByText 同问题)
 *   注: viewId 在 WebView 里通常不可见, 老板 nova 实际使用 byId 场景很少, 兜底返 false
 */
export async function byId(viewId: string, level: HumanLevel = 'precise'): Promise<boolean> {
  const lookupPromise = (async () => {
    try {
      const nodes = await ZBBAutomation.getAllTextNodes();
      const node = nodes.find((n: any) =>
        n?.viewId?.toString() === viewId &&
        n.centerX > 0 && n.centerY > 0
      );
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
 * 按屏幕物理坐标点击 (V32.36.26 老板 09-19 拍板修法 - 老板 nova 上 V4 dump 坐标错位)
 *
 * 老板 09-19 nova 实测:
 *   uiautomator dump (真实屏幕坐标) 报备按钮 = (719, 2138)
 *   V4 getAllTextNodes 返回 (121, 1033) - WebView 内部坐标, 不是物理坐标
 *   真因: nova EMUI 10 WebView getBoundsInScreen 返回 WebView 内部坐标, 不是物理屏幕坐标
 *   修法: 老板 nova 实测 hardcode (360-720 屏中部) / (720 屏中点) 不依赖 V4 dump
 */
export async function byCoords(
  x: number,
  y: number,
  level: HumanLevel = 'precise',
): Promise<boolean> {
  const { x: tapX, y: tapY } = applyHumanOffset(x, y, level);
  logger.info('click.byCoords', `tap (${x}, ${y}) → (${tapX}, ${tapY}) (V32.36.26 老板 nova hardcode)`);
  return ZBBAutomation.click(tapX, tapY);
}

export const click = { byText, byNode, byId, byCoords };
export default click;