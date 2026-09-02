/**
 * V4.x judge module (老板实测 08-22, V32.36.7 OCR 已禁用)
 *
 * 界面判断:
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
 *
 * 🆕 V32.36.11 (09-02 老板反证金标准): 改判 found:!!node 误报问题
 *   - AutomationModule.kt findElementByText 没找到时返回 debugInfo {found:false, searchText, reason, hint}
 *   - debugInfo 是 JS object, truthy → !!node 返回 true (false positive!)
 *   - click.byText 用 n.centerX !== undefined, debugInfo 没 centerX → 返回 null → 'A11y 没找到'
 *   - 老板现场反证: judge 找到, click 找不到 (同一个调用不同判定)
 *   修法: 看 node.found === true (跟 click 一致, 都是看 native found flag)
 */
export async function isScreenText(text: string): Promise<boolean> {
  // V32.36.7: 只用 A11y, OCR fallback 删除 (老板拍板 OCR 误判率高)
  // V32.36.11: 判 found:true 而非 !!node (老板反证金标准)
  try {
    const node = await ZBBAutomation.findElementByText(text);
    return node?.found === true;
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
