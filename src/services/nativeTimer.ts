/**
 * 🆕 08-27 v32.19 老板拍板: native 持久化 timer
 *
 * 实际需求:
 *   - JS setTimeout / setInterval 在 RN reload 时模块级变量丢失 → timer 失效
 *   - 用 native Handler.postDelayed 持久化 → reload 后仍生效
 *   - 用于 Cooldown 60s 自动 COOLDOWN_DONE (实战反证 v32.18 bug)
 *
 * 设计:
 *   - setNativeTimer(id, ms, callback) → 设 native timer, 到期调 callback
 *   - clearNativeTimer(id) → 清 native timer
 *   - 内部监听 onNativeTimeout 事件 → 调对应 callback
 */
import { NativeModules, NativeEventEmitter } from 'react-native';

const ZBBAutomation = NativeModules.ZBBAutomation;
const emitter = new NativeEventEmitter(ZBBAutomation);

const callbacks = new Map<string, () => void>();

// 监听 native onNativeTimeout 事件
if (emitter) {
  emitter.addListener('onNativeTimeout', (timerId: string) => {
    console.log(`[nativeTimer] 收到 native 超时: ${timerId}`);
    const cb = callbacks.get(timerId);
    if (cb) {
      callbacks.delete(timerId);
      cb();
    } else {
      console.warn(`[nativeTimer] ${timerId} 找不到 callback (可能已被 clear)`);
    }
  });
}

/**
 * 设 native 持久化 timer
 * @param timerId 唯一 ID (同一 ID 重复设会覆盖旧 timer)
 * @param delayMs 延迟毫秒
 * @param callback 到期回调
 */
export async function setNativeTimer(
  timerId: string,
  delayMs: number,
  callback: () => void,
): Promise<boolean> {
  // 存 callback
  callbacks.set(timerId, callback);
  try {
    const ok = await ZBBAutomation.setNativeTimeout(timerId, delayMs);
    console.log(`[nativeTimer] setNativeTimer ${timerId} ${delayMs}ms → ${ok}`);
    return ok;
  } catch (e: any) {
    console.error(`[nativeTimer] setNativeTimer 失败: ${e.message}`, e);
    callbacks.delete(timerId);
    return false;
  }
}

/**
 * 清 native timer
 */
export async function clearNativeTimer(timerId: string): Promise<boolean> {
  callbacks.delete(timerId);
  try {
    const removed = await ZBBAutomation.clearNativeTimeout(timerId);
    console.log(`[nativeTimer] clearNativeTimer ${timerId} removed=${removed}`);
    return removed;
  } catch (e: any) {
    console.error(`[nativeTimer] clearNativeTimer 失败: ${e.message}`, e);
    return false;
  }
}