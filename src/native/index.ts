/**
 * ZBBAutomation Native Wrapper (V4.x 实战反证金标准)
 *
 * 实战经验铁证: V4.x 不重写 native, 直接调用 V2.x 26 kt 已暴露的 60+ method
 * 这个文件 = NativeModules.ZBBAutomation 的 wrapper, 提供类型安全 + 错误处理
 */

import { NativeModules, Platform } from 'react-native';
import type { ZBBAutomationModule } from './ZBBAutomation';
export type { ZBBAutomationModule, A11yNode, OcrResult, FindTextResult, ExtractContentResult } from './ZBBAutomation';

const Native = NativeModules.ZBBAutomation as ZBBAutomationModule | undefined;

if (!Native) {
  console.warn(
    '[ZBBAutomation] Native module not found. ' +
    'Make sure ZBBAutomationModule.kt is registered in AutomationPackage.kt',
  );
}

/**
 * 检查 native module 是否可用
 */
export function isAvailable(): boolean {
  return Native !== undefined && Native !== null;
}

/**
 * 通用 safeCall 包装: native 调用失败不抛异常, 返回 false
 */
async function safeCall<T>(
  method: keyof ZBBAutomationModule,
  args: any[] = [],
  defaultValue: T,
): Promise<T> {
  if (!Native) return defaultValue;
  try {
    const fn = (Native as any)[method];
    if (typeof fn !== 'function') {
      console.warn(`[ZBBAutomation] ${String(method)} is not a function`);
      return defaultValue;
    }
    const result = await fn.apply(Native, args);
    return result === undefined ? defaultValue : result;
  } catch (e: any) {
    console.error(`[ZBBAutomation] ${String(method)} failed:`, e?.message ?? e);
    return defaultValue;
  }
}

// ============================================================
// 导出直接 native 调用 (供 operations 包装使用)
// ============================================================
export const ZBBAutomation: ZBBAutomationModule = Native ?? ({} as any);

export { safeCall };
export default ZBBAutomation;
