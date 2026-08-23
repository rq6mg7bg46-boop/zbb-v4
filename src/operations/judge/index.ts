/**
 * V4.x judge module (老板实战反证金标准 08-22)
 *
 * 界面判断:
 * - isScreenText(text)         当前屏幕是否含文字
 * - isAppForeground(pkg)       当前前台 app 是否指定包名
 * - waitForScreen(text, ms)    等待屏幕出现文字 (轮询)
 */

import ZBBAutomation, { A11yNode } from '@/native';

const DEFAULT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

/**
 * 当前屏幕是否含文字 (A11y + OCR 双重)
 */
export async function isScreenText(text: string): Promise<boolean> {
  // A11y 优先 (快)
  try {
    const node = await ZBBAutomation.findElementByText(text);
    if (node) return true;
  } catch {}
  // OCR fallback (慢但准)
  try {
    return await ZBBAutomation.ocrContainsText(text);
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
