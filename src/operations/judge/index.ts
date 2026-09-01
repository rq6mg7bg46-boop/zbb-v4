/**
 * V4.x judge module (老板实测 08-22, V32.36.7 OCR 已删)
 *
 * 界面判断 (纯 A11y):
 * - isScreenText(text)         当前屏幕是否含文字 (A11y only, V32.36.7 OCR 已删)
 * - isAppForeground(pkg)       当前前台 app 是否指定包名
 * - waitForScreen(text, ms)    等待屏幕出现文字 (轮询)
 *
 * V32.36.7 改动:
 *   - OCR fallback 删了 (老板 09-01 拍板 OCR 误判率高, 全删)
 *   - judge.isScreenText 现在只用 A11y (findElementByText)
 */

import { ZBBAutomation } from '@/native';

const DEFAULT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

/**
 * 当前屏幕是否含文字 (纯 A11y, V32.36.7 OCR 已删)
 */
export async function isScreenText(text: string): Promise<boolean> {
  // V32.36.7: 只用 A11y, OCR fallback 删除 (老板拍板 OCR 误判率高)
  try {
    const node = await ZBBAutomation.findElementByText(text);
    return !!node;
  } catch {
    return false;
  }
}

/**
 * 当前前台 app 是否指定包名 (用 A11y 节点 packageName)
 */
export async function isAppForeground(packageName: string): Promise<boolean> {
  try {
    // 通过遍历可点击节点, 看 packageName 是否匹配
    const nodes = await ZBBAutomation.getClickableElements();
    for (const node of nodes) {
      if (node.packageName === packageName) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 等待屏幕出现文字 (轮询, 默认 5s 超时)
 */
export async function waitForScreen(
  text: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isScreenText(text)) return true;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

export const judge = { isScreenText, isAppForeground, waitForScreen };
export default judge;
