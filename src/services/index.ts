/**
 * V4.x services/index.ts (老板实战反证金标准 08-24)
 *
 * 5min 静默触发器 (复刻 V2.x v7 A2, 老板实战反证金标准):
 *
 * 链路:
 *   AlarmManager 5min tick (native IdleTriggerReceiver)
 *     ↓
 *   WorkManager → IdleTriggerWorker.doWork
 *     ↓
 *   WorkOrchestrator.startIdleWork(context)
 *     ↓ emit DeviceEvent
 *   'zbbIdleWorkTrigger' → 本文件 L26
 *     ↓
 *   runZbbWorkflow() ← 跟 HomeScreen.handleStart 100% 复用
 *
 * 实战反证金标准 (08-24):
 *   - 5min 触发器跟 HomeScreen.handleStart 走同一个 runZbbWorkflow, 避免抢跑
 *   - 并发守卫: orchestrator.isInUserIntervention() / isRunning() → 跳过
 *   - USER_INTERVENTION 期间跳过 (V2.x Bug E 实战反证)
 */

import { DeviceEventEmitter } from 'react-native';
import { runZbbWorkflow } from '@/flow';
import { orchestrator } from '@/core/stateMachine';

DeviceEventEmitter.addListener('zbbIdleWorkTrigger', async () => {
  console.log('[5minTrigger] 5min 静默触发器 → runZbbWorkflow');

  // V2.x 实战反证金标准 (services/index.ts L54-59):
  //   USER_INTERVENTION 期间跳过, 防止 Bug E "流程已在运行中"
  if (orchestrator.isInUserIntervention()) {
    console.log('[5minTrigger] USER_INTERVENTION 中, 跳过本轮 5min 触发');
    return;
  }

  // V2.x 实战反证金标准 (services/index.ts L60-67):
  //   mutex 忙 → 跳过本轮 (等下一个 5min 或老板手动)
  if (orchestrator.isAnyServiceBusy()) {
    console.log('[5minTrigger] mutex 忙 (千机/保/越秀 已在跑), 跳过本轮 5min 触发');
    return;
  }

  // 老板实战反证金标准 08-24: 调跟 HomeScreen.handleStart 同款入口
  //   避免历史 V2.x 抢跑 bug (直接调 startQianjiFlow 绕过 handleStart 流程)
  try {
    const result = await runZbbWorkflow();
    console.log(`[5minTrigger] runZbbWorkflow 结果: ok=${result.ok} skipped=${result.skipped} reason=${result.reason}`);
  } catch (e: any) {
    console.error('[5minTrigger] runZbbWorkflow 异常:', e);
  }
});

console.log('[services/index.ts] 5min 触发器已注册 (监听 zbbIdleWorkTrigger → runZbbWorkflow)');