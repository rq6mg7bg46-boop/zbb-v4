/**
 * V4.x services/index.ts (老板实战反证金标准 08-24)
 *
 * 5min 静默触发器 (复刻 V2.x v7 A2, 老板实战反证金标准):
 *
 * 链路 (08-26 v32.18 老板拍板):
 *   - V2.x 原设计: AlarmManager 5min tick (native IdleTriggerReceiver)
 *     ↓ WorkManager → IdleTriggerWorker → emit DeviceEvent
 *     ↓ 'zbbIdleWorkTrigger' → 本文件 listener
 *     ↓ runZbbWorkflow()
 *   - V4.x 实际 (v32.18): V2.x 没真正实现 native AlarmManager, 用 JS setInterval 替代
 *     ↓ setInterval 每 60s 检查一次
 *     ↓ 距上次触发 ≥ 5min → 调 runZbbWorkflow()
 *     ↓ runZbbWorkflow() ← 跟 HomeScreen.handleStart 100% 复用
 *
 * 实战反证金标准 (08-24 + 08-26):
 *   - 5min 触发器跟 HomeScreen.handleStart 走同一个 runZbbWorkflow, 避免抢跑
 *   - 并发守卫: orchestrator.isInUserIntervention() / isAnyServiceBusy() → 跳过
 *   - 状态守卫: 必须是 Idle 状态 (V2.x 实战反证 Bug E)
 *   - 间隔守卫: 距上次触发 ≥ 5 分钟 (localStorage 防重入)
 */

import { DeviceEventEmitter } from 'react-native';
import { runZbbWorkflow } from '@/flow';
import { orchestrator, OrchState } from '@/core/stateMachine';
import { loadAppEnv } from '@/config/env';

// 🆕 08-24 (老板拍板 a=方案A): 启动时从 native BuildConfig 读 APP_ENV + 千机包名
loadAppEnv().then((env) => {
  console.log(`[services/index.ts] APP_ENV=${env.appEnv}, qianji=${env.qianjiPackage}`);
}).catch((e) => {
  console.error('[services/index.ts] loadAppEnv 失败:', e);
});

// 🆕 08-26 v32.18: 5min 静默触发器 (JS setInterval 实现)
//   - V2.x 设计意图: 5min 静默无操作 → 自动跑业务
//   - V2.x 实际: 代码注释提到 5min 触发器, 但 V2.x 代码里没真正实现 native AlarmManager
//   - V4.x v32.18: 用 JS setInterval 替代, 每 60s 检查一次
//
// 防重入: 用模块级 lastTriggerMs + localStorage (持久化, app 重启也不丢)
let lastTriggerMs = 0;
const FIVE_MIN_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000; // 每分钟检查
const LAST_TRIGGER_KEY = 'zbb_5min_last_trigger';

// app 启动时读 localStorage (上次触发时间)
try {
  const stored = (globalThis as any).localStorage?.getItem?.(LAST_TRIGGER_KEY);
  if (stored) {
    lastTriggerMs = parseInt(stored, 10) || 0;
    console.log(`[5minTrigger] 读 localStorage 上次触发: ${new Date(lastTriggerMs).toISOString()}`);
  }
} catch {
  // ignore (Hermes 可能不支持 localStorage)
}

setInterval(async () => {
  const now = Date.now();

  // 1. 间隔守卫: 距上次触发 ≥ 5 分钟
  if (now - lastTriggerMs < FIVE_MIN_MS) {
    return; // 静默, 不刷屏
  }

  // 2. 状态守卫: 必须是 Idle
  if (orchestrator.getState() !== OrchState.Idle) {
    return;
  }

  // 3. 用户介入守卫 (V2.x Bug E 实战反证)
  if (orchestrator.isInUserIntervention()) {
    return;
  }

  // 4. mutex 守卫
  if (orchestrator.isAnyServiceBusy()) {
    return;
  }

  // 全部通过 → 触发 + 记录 lastTriggerMs
  lastTriggerMs = now;
  try {
    (globalThis as any).localStorage?.setItem?.(LAST_TRIGGER_KEY, now.toString());
  } catch {
    // ignore
  }

  console.log(`[5minTrigger] 5min 静默触发器 → runZbbWorkflow (距上次 ${Math.round((now - (lastTriggerMs - FIVE_MIN_MS)) / 1000)}s)`);
  try {
    const result = await runZbbWorkflow();
    console.log(`[5minTrigger] runZbbWorkflow 结果: ok=${result.ok} skipped=${result.skipped} reason=${result.reason}`);
  } catch (e: any) {
    console.error('[5minTrigger] runZbbWorkflow 异常:', e);
  }
}, CHECK_INTERVAL_MS);

console.log(`[services/index.ts] 5min 触发器已注册 (JS setInterval 每 ${CHECK_INTERVAL_MS / 1000}s 检查一次, 距上次 ≥ ${FIVE_MIN_MS / 1000}s 自动跑)`);

// 保留 V2.x 原始事件 listener (兼容 native AlarmManager 实现, 即使 V4.x 没用到)
DeviceEventEmitter.addListener('zbbIdleWorkTrigger', async () => {
  console.log('[5minTrigger] 收到 native zbbIdleWorkTrigger 事件 → runZbbWorkflow');

  if (orchestrator.isInUserIntervention()) {
    console.log('[5minTrigger] USER_INTERVENTION 中, 跳过');
    return;
  }
  if (orchestrator.isAnyServiceBusy()) {
    console.log('[5minTrigger] mutex 忙, 跳过');
    return;
  }

  try {
    const result = await runZbbWorkflow();
    console.log(`[5minTrigger] runZbbWorkflow 结果: ok=${result.ok} skipped=${result.skipped} reason=${result.reason}`);
  } catch (e: any) {
    console.error('[5minTrigger] runZbbWorkflow 异常:', e);
  }
});