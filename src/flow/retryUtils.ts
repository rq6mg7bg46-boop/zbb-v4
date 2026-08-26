/**
 * V4.x 千机端通用等待 + 重试函数 (08-25 老板拍板 C 方案)
 *
 * 目标: 减少用户介入 — 加载慢/界面走错时程序自己恢复
 *
 * 设计思路 (老板实战):
 *   - 区分两类场景:
 *     A. 无界面变化 (纯检测已加载好的界面) → 短间隔 0.5-1s
 *     B. 有界面变化 (launchApp/点击触发新页面加载) → 中长间隔 1-2s
 *   - 通用 fallback 链:
 *     1. 短检测 3 次 (0.5-1s 间隔) — 应对加载慢
 *     2. 自定义恢复动作 (上滑/下滑) + 重检 2 次 — 应对内容未渲染
 *     3. 整条流程重试 (返回 + 重新进入) — 应对界面走错
 *     4. raiseAlert — 3 次都失败才打扰老板
 */

import ZBBAutomation from '@/native';
import { raiseAlert } from '@/services/alert';

/**
 * 类型 A: 无界面变化的快速检测
 * 适用场景: 当前界面已稳定, 纯查询节点
 * 首轮 0.5-1s 随机, 重试 0.5-1s 随机
 */
export async function quickCheck(
  label: string,
  finder: () => Promise<boolean>,
  maxRetries = 3
): Promise<boolean> {
  for (let i = 1; i <= maxRetries; i++) {
    if (await finder()) return true;
    console.log(`[${label}] 第 ${i}/${maxRetries} 次未找到`);
    if (i < maxRetries) {
      await ZBBAutomation.delay(500 + Math.random() * 500); // 0.5-1s
    }
  }
  return false;
}

/**
 * 类型 B: 有界面变化的等待 + 检测
 * 适用场景: launchApp / 点击触发新页面加载
 * 首轮 1-2s 随机, 重试 1-1.5s 随机
 */
export async function waitForScreenChange(
  label: string,
  finder: () => Promise<boolean>,
  maxRetries = 3
): Promise<boolean> {
  await ZBBAutomation.delay(1000 + Math.random() * 1000); // 首轮 1-2s
  for (let i = 1; i <= maxRetries; i++) {
    if (await finder()) return true;
    console.log(`[${label}] 第 ${i}/${maxRetries} 次未找到`);
    if (i < maxRetries) {
      await ZBBAutomation.delay(1000 + Math.random() * 500); // 重试 1-1.5s
    }
  }
  return false;
}

/**
 * 类型 C: 找按钮 + 3 层 fallback
 *   1. 短检测 3 次 (0.5-1s)
 *   2. 自定义恢复动作 (上滑/下滑) + 重检 2 次
 *   3. 失败 → 返回 false (由调用方决定是否 raiseAlert)
 */
export async function findWithRecovery(
  label: string,
  finder: () => Promise<boolean>,
  recoverAction?: () => Promise<void>
): Promise<boolean> {
  // 1. 短检测 3 次
  if (await quickCheck(label, finder, 3)) return true;

  // 2. 调恢复动作 (如上滑/下滑)
  if (recoverAction) {
    console.log(`[${label}] 短检测失败, 调恢复动作`);
    await recoverAction();
    await ZBBAutomation.delay(1000);
    if (await quickCheck(`${label} (恢复后)`, finder, 2)) return true;
  }

  return false;
}

/**
 * 重试信号: throw 这个让外层 retry 触发整条重试
 */
export class RetryFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryFlowError';
  }
}

/**
 * 千机端整条流程重试包装 (08-25 老板拍板 方案 B: 单一弹窗源)
 *
 * 用法:
 *   export async function runXxxFlow(): Promise<Result | null> {
 *     return withFlowRetry('xxxFlow', async () => {
 *       // ... 实际 7 步骤
 *     });
 *   }
 *
 * 行为:
 *   - 内部函数抛 RetryFlowError → 返回 + 重新进入 → 重试整条
 *   - 内部函数抛其他异常 → 直接 return null (不 raiseAlert)
 *   - 内部函数 return null → 视为失败, 触发整条重试
 *   - 重试 MAX_FLOW_RETRIES 次都失败 → return null (不 raiseAlert)
 *   - 弹窗源统一在 HomeScreen (监听 orchestrator state 切到 UserIntervention)
 */
export const MAX_FLOW_RETRIES = 3;

export async function withFlowRetry<T>(
  flowName: string,
  fn: () => Promise<T | null>,
  recoverAction?: () => Promise<void>  // 整条重试前调一次 (如 pressKey.back)
): Promise<T | null> {
  for (let attempt = 1; attempt <= MAX_FLOW_RETRIES; attempt++) {
    console.log(`[${flowName}] 流程启动 (第 ${attempt}/${MAX_FLOW_RETRIES} 次)`);
    try {
      const result = await fn();
      if (result !== null) return result;
      // 返回 null 也算失败, 触发整条重试
      console.warn(`[${flowName}] 返回 null (attempt ${attempt})`);
    } catch (e: any) {
      if (e instanceof RetryFlowError) {
        console.warn(`[${flowName}] 抛 RetryFlowError: ${e.message}`);
        if (attempt < MAX_FLOW_RETRIES) {
          if (recoverAction) {
            await recoverAction();
          }
          continue; // 重试整条
        }
      } else {
        // 真异常 → return null (不 raiseAlert, 让 HomeScreen 统一弹窗)
        console.error(`[${flowName}] 真异常:`, e);
        return null;
      }
    }
  }
  // 重试上限 → return null (不 raiseAlert, 让 HomeScreen 统一弹窗)
  console.error(`[${flowName}] 重试 ${MAX_FLOW_RETRIES} 次都失败`);
  return null;
}
