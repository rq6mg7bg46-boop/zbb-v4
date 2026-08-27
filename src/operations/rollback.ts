/**
 * V4.x rollback operation (老板实测 08-22)
 *
 * 回滚 = 出错时恢复到上一个稳定状态
 * - oneStep()                按一次返回键 (默认策略)
 * - byPolicy(policy)         按策略回滚 (back|home|trash|custom)
 *
 * 业务流程:
 *   try { ... } catch (e) {
 *     await rollback.oneStep();
 *   }
 */

import { ZBBAutomation } from '@/native';
import { pressKey } from './pressKey';
import { logger } from '@/utils/logger';

export type RollbackPolicy = 'back' | 'home' | 'trash' | 'doubleBack';

/**
 * 回滚一步 (默认按一次返回键)
 */
export async function oneStep(): Promise<boolean> {
  return pressKey.back();
}

/**
 * 按策略回滚
 */
export async function byPolicy(policy: RollbackPolicy): Promise<boolean> {
  switch (policy) {
    case 'back':
      return pressKey.back();
    case 'home':
      return pressKey.home();
    case 'trash':
      return pressKey.trash();
    case 'doubleBack':
      const ok1 = await pressKey.back();
      await ZBBAutomation.delay(300);
      const ok2 = await pressKey.back();
      return ok1 || ok2;
    default:
      return pressKey.back();
  }
}

/**
 * 重试包装器: 失败自动 rollback + 重试 N 次
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    rollbackPolicy?: RollbackPolicy;
    delayMs?: number;
  } = {},
): Promise<T | null> {
  const maxRetries = options.maxRetries ?? 2;
  const rollbackPolicy = options.rollbackPolicy ?? 'back';
  const delayMs = options.delayMs ?? 500;

  let lastError: any = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      logger.warn('rollback.withRetry', `Attempt ${i + 1} failed: ${e}`);
      if (i < maxRetries) {
        await byPolicy(rollbackPolicy);
        await ZBBAutomation.delay(delayMs);
      }
    }
  }
  logger.error('rollback.withRetry', `All ${maxRetries + 1} attempts failed: ${lastError}`);
  return null;
}

export const rollback = { oneStep, byPolicy, withRetry };
export default rollback;
