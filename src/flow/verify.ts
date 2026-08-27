/**
 * V4.x Flow 公共验证 (老板实战反证金标准 08-22)
 *
 * verifyAndRecover: 每个 step 后, 验证是否进入预期状态
 * verifyTimeout: 验证超时处理
 */

import { judge, rollback } from '@/operations';
import { ZBBAutomation } from '@/native';

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  durationMs: number;
}

/**
 * 等待屏幕文字出现 (超时后回滚)
 */
export async function waitForScreenWithRollback(
  text: string,
  timeoutMs: number = 5000,
  rollbackPolicy: 'back' | 'home' | 'trash' = 'back',
): Promise<VerifyResult> {
  const start = Date.now();
  const ok = await judge.waitForScreen(text, timeoutMs);
  if (ok) {
    return { ok: true, durationMs: Date.now() - start };
  }
  // 失败: 回滚
  console.warn(`[verify.waitForScreenWithRollback] 没等到 "${text}", 回滚`);
  await rollback.byPolicy(rollbackPolicy);
  return {
    ok: false,
    reason: `没等到文字: "${text}"`,
    durationMs: Date.now() - start,
  };
}

/**
 * verifyAndRecover: step 执行后, 验证预期文字出现
 * 如果没出现, 自动回滚 + 重试 N 次
 */
export async function verifyAndRecover(
  expectedText: string,
  options: {
    /** 单次 judge 等待超时 (ms), 默认 5000 */
    timeoutMs?: number;
    maxRetries?: number;
    rollbackPolicy?: 'back' | 'home' | 'trash';
    onFail?: () => Promise<boolean>; // 自定义恢复 (例如重新点击某按钮)
  } = {},
): Promise<VerifyResult> {
  const maxRetries = options.maxRetries ?? 2;
  const rollbackPolicy = options.rollbackPolicy ?? 'back';

  let lastResult: VerifyResult | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    const start = Date.now();
    const ok = await judge.isScreenText(expectedText);
    if (ok) {
      return { ok: true, durationMs: Date.now() - start };
    }

    // 自定义恢复
    if (options.onFail) {
      const recovered = await options.onFail();
      if (recovered) {
        const retryStart = Date.now();
        const retryOk = await judge.isScreenText(expectedText);
        if (retryOk) {
          return { ok: true, durationMs: Date.now() - retryStart };
        }
      }
    }

    // 回滚
    await rollback.byPolicy(rollbackPolicy);
    await ZBBAutomation.delay(500);

    lastResult = {
      ok: false,
      reason: `Retry ${i + 1}/${maxRetries + 1}: 没等到 "${expectedText}"`,
      durationMs: Date.now() - start,
    };
  }

  return lastResult ?? {
    ok: false,
    reason: 'verifyAndRecover exhausted',
    durationMs: 0,
  };
}

/**
 * stepResult: 包装 step 执行结果
 */
export interface StepResult {
  stepName: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export function makeStepResult(
  stepName: string,
  ok: boolean,
  startTs: number,
  error?: string,
): StepResult {
  return {
    stepName,
    ok,
    durationMs: Date.now() - startTs,
    error,
  };
}
