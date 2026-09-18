/**
 * V4.x Flow 公共验证 (老板实测 08-22)
 *
 * verifyAndRecover: 每个 step 后, 验证是否进入预期状态
 * verifyTimeout: 验证超时处理
 */

import { judge, rollback } from '@/operations';
import { ZBBAutomation } from '@/native';
import { logger } from '@/utils/logger';

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
  logger.warn('verify.waitForScreenWithRollback', `没等到 "${text}", 回滚`);
  await rollback.byPolicy(rollbackPolicy);
  return {
    ok: false,
    reason: `没等到文字: "${text}"`,
    durationMs: Date.now() - start,
  };
}

/**
 * verifyAndRecover: step 执行后, 验证预期文字出现
 * 如果没出现, 自动重试 N 次
 *
 * 🆕 V32.36.11 (老板 09-07 拍板): 取消 retry 时的 rollback 操作
 *   - V2.x 反证金标准 (老板 09-07 实战): 步骤 4 找 "郑州保利山水和颂" 时, WebView 节点树未加载完
 *     → verify 失败 → 自动 rollback 一次 → 界面又重新加载 → 永远找不到
 *   - 老板原话: "实际情况是, 界面未完成渲染, 然后就点击了返回. 取消这里的返回操作."
 *   - 修法: retry 之间只 delay, 不调 rollback. 验证失败 = 直接 retry 等待节点树加载
 *   - 配合 baoli.ts 步骤 4 delay 3000ms, 给小程序节点树充分加载时间
 */
export async function verifyAndRecover(
  expectedText: string,
  options: {
    /** 单次 judge 等待超时 (ms), 默认 5000 */
    timeoutMs?: number;
    maxRetries?: number;
    /**
     * ⚠️ V32.36.11 已弃用: retry 之间不再 rollback (老板 09-07 拍板)
     *   保留参数仅为兼容旧调用方, 但忽略其值 (永远不调 rollback)
     *   原因: verify 失败时通常 WebView/小程序还在 loading, rollback 会破坏节点树重建
     */
    rollbackPolicy?: 'back' | 'home' | 'trash';
    onFail?: () => Promise<boolean>; // 自定义恢复 (例如重新点击某按钮)
  } = {},
): Promise<VerifyResult> {
  const maxRetries = options.maxRetries ?? 2;

  let lastResult: VerifyResult | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    const start = Date.now();
    const ok = await judge.isScreenText(expectedText);
    if (ok) {
      return { ok: true, durationMs: Date.now() - start };
    }

    // 自定义恢复 (如果有)
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

    // 🆕 V32.36.11 (老板 09-07 拍板): 取消 retry 之间的 rollback
    //   V2.x 反证金标准: 小程序 loading 中 verify 失败 → rollback = 永久循环
    //   现在只 delay, 让下次 retry 重新等待节点树加载
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
