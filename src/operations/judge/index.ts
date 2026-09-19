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
 * 🆕 V32.36.11 (老板 09-07 拍板): dump 当前界面的可见文本节点
 *   老板原话: "在等待3000MS后, 先打印当前界面的内容"
 *   - 用 ZBBAutomation.getAllTextNodes 拿当前屏所有 TextView 节点的 text
 *   - 写到 logger.info, 让 log 能看到界面实际状态 (loading / 加载完 / 完全错)
 *   - 最多打印前 30 条文本, 避免 log 爆炸
 *   - V2.x 反证金标准: 当 verify 失败时, 不直接报 BAOLI_INTERVENE, 先看界面到底是啥
 */
export async function dumpScreenTexts(maxCount: number = 30): Promise<string[]> {
  try {
    const nodes = await ZBBAutomation.getAllTextNodes();
    const texts: string[] = [];
    for (const node of nodes) {
      const t = node?.text?.toString() || '';
      if (t.trim()) {
        texts.push(t.trim());
      }
      if (texts.length >= maxCount) break;
    }
    return texts;
  } catch (e) {
    return [`[dumpScreenTexts FAILED: ${e}]`];
  }
}

/**
 * 🆕 V32.36.11 (老板 09-07 实战反证金标准 + 09-07 实战卡死 68s 修法):
 *   重写 isScreenText 用 getAllTextNodes 遍历 + 短轮询
 *   老板实战 log (15:40:11-19): dumpScreenTexts 找到 30 条文本含 "郑州保利山水和颂"
 *     → isScreenText (用 AOSP findAccessibilityNodeInfosByText) 找不到
 *   老板实战 log (15:48:32-49): dump 后 isScreenText 没轮询 → WebView 节点树在 dump 后才建好
 *     → 单次 getAllTextNodes 返 5 条 (外层), isScreenText false → 卡 68 秒
 *   老板实战反证根因:
 *     - AOSP findAccessibilityNodeInfosByText 对 WebView 内节点 (小程序/网页) 默认 isImportantForAccessibility=false
 *     - API 内部过滤掉, 返回空数组
 *     - 但 getAllTextNodes (我们自己遍历 rootInActiveWindow) 能看到 WebView 节点
 *     - WebView 节点树建树需要 2-5s (V2.x 反证金标准 BaoliService v22.02.33 实战)
 *   V2.x BaoliService.ts:429-454 findNodeByText 反证金标准: 6 次 retry + 800-1200ms backoff = ~7s 等待
 *   修法:
 *     - isScreenText 改用 getAllTextNodes 遍历 + 模糊匹配 (includes)
 *     - 加 3 次重试 + 1000ms backoff (老板 09-07 拍板, 足够等 WebView 建树)
 *     - 总耗时上限 ~3s, 不卡 68 秒
 */
/**
 * 当前屏幕是否包含指定文字 (A11y only, V32.36.7 OCR 已删)
 *
 * V32.36.18 (09-19 老板 nova 装机实测 - 修法):
 *   - 真因: 之前 3 次重试 + 1s backoff 在企微 WebView 上 getAllTextNodes dump 卡死
 *   - 老板命中错位: judge 没返回 true/false, for 循环卡死, 永远走不到 scrollUpPPlus
 *   - 修法 (老板拍板 B 简洁版): 完全放弃 WebView 重试, 单次 getAllTextNodes
 *     - 拿到节点 → 模糊匹配 includes(text) → 返回 true/false (立刻反馈)
 *     - 拿不到 / dump 空 → 返回 false (保证不阻塞 for 循环)
 *     - 老板原文 (09-19): "查找没有找到它第一个没有反馈有没有找到, 第二个他没有正确的调用继续下滑的操作"
 *     - 现在: isScreenText 立刻返 true/false, baoli step3 for 循环能继续下次上滑
 */
export async function isScreenText(text: string): Promise<boolean> {
  // V32.36.18 老板 09-19 拍板 B: 单次 getAllTextNodes, 不重试, 保证不阻塞
  // 之前 3 次重试 (V32.36.11 09-07) 老板 nova 装机实测在企微 WebView 内 dump 卡死 45+ 秒
  try {
    const nodes = await ZBBAutomation.getAllTextNodes();
    for (const node of nodes) {
      const t = node?.text?.toString() || '';
      if (t.includes(text)) {
        return true;
      }
    }
  } catch {
    // 忽略错误, 视作没找到 (老板 09-19 拍板 B 简洁版)
  }
  return false;
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

export const judge = { isScreenText, isAppForeground, waitForScreen, dumpScreenTexts };
export default judge;
