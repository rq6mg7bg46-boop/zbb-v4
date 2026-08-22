package com.zbb.automation.v4

import android.app.KeyguardManager
import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * 5min 静默 + 5s 前置观察 Worker —— v6 方向 L 调整（2026-07-07 老板拍板）
 *
 * 设计目标（替换旧 ZbbAntiSleepWorker）：
 * - 5min 静默期到 → 开 5s 前置观察窗
 * - 5s 内有任意操作（用户触摸 / ZBB 自身操作）→ 取消干活，重新计时
 * - 5s 内无操作 → 调 WorkOrchestrator.startIdleWork() 启动"干活"
 * - 干活时屏幕自然亮 → 锁屏问题自然消解
 *
 * 跟 v5 ZbbAntiSleepWorker 的关键差异：
 * - v5: 强制 WakeLock 5s（EMUI doze 拒绝 → 锁屏下失效）
 * - v6: 不碰 WakeLock，等 5min 静默后真干活（屏幕真亮，锁屏问题消解）
 *
 * 跟 v5 千机监听的关系：
 * - v5 千机监听（QianjiService 5s 空闲）= 最高优先级，独立 trigger
 * - v6 5min 静默干活 = 中优先级，定期扫描积压
 * - 两者不冲突：v5 触发千机流程 + v6 启动后跑千机/越秀/保利 一锅端
 */
class IdleTriggerWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "IdleTriggerWorker"
        private const val IDLE_THRESHOLD_MS = 5L * 60 * 1000L  // 5 min 静默期
        private const val PRE_CHECK_WINDOW_MS = 5L * 1000L     // 5 s 前置观察窗
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            // 🆕 v19.61 (07-22) 老板拍板:
            //   - IdleTriggerWorker 移除 isQuietHour 闸门（闸门统一在 ZbbKeepAliveService.tick 入口）
            //   - 静默期 ZbbKeepAliveService.tick 跳过, 不会排 IdleTriggerScheduler.scheduleNext(),
            //     所以 IdleTriggerWorker 不会被触发
            //   - 锁屏检测保留 (keyguardManager) — vivo 实测: 锁屏=用户在非工作时间
            // 历史:
            //   v19.46 错位: 把 isQuietHour 接进 Worker, 但漏了 WorkOrchestrator.startIdleWork() 入口,
            //                导致 22:00 业务层还在跑（被老板抓到）
            // vivo 实测证据：13:41 锁屏 → 13:50/13:57 V12 tick 仍触发 → 千机启动后看到锁屏界面（白跑）
            val keyguardManager = applicationContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            if (keyguardManager?.isKeyguardLocked == true) {
                Log.i(TAG, "device is locked — skip idle trigger (用户在非工作时间，不执行 ZBB)")
                IdleTriggerScheduler.scheduleNext(applicationContext)
                return@withContext Result.success()
            }

            val last = OperationDetector.getLastInteractionMs()
            val now = System.currentTimeMillis()

            if (last == 0L || (now - last) >= IDLE_THRESHOLD_MS) {
                // 5min 静默期到 — 开 5s 前置观察窗
                val deltaStr = if (last == 0L) "n/a (first run)" else "${now - last}ms"
                Log.i(
                    TAG,
                    "idle threshold reached (last=$last delta=$deltaStr) — opening ${PRE_CHECK_WINDOW_MS}ms pre-check window"
                )

                val noNewInteraction = OperationDetector.isIdleAfterPreCheck(
                    thresholdMs = IDLE_THRESHOLD_MS,
                    preCheckMs = PRE_CHECK_WINDOW_MS
                )

                if (noNewInteraction) {
                    // 5s 内无新操作 — 触发干活
                    Log.i(TAG, "pre-check window clean — triggering idle work via WorkOrchestrator")
                    WorkOrchestrator.startIdleWork(applicationContext)
                } else {
                    Log.i(TAG, "pre-check window detected new interaction — cancel idle work, restart timer")
                }
            } else {
                Log.d(
                    TAG,
                    "not idle yet (last=$last delta=${now - last}ms threshold=${IDLE_THRESHOLD_MS}ms)"
                )
            }

            // 链式自续：5min 后再跑一次（不管本次是否触发干活）
            IdleTriggerScheduler.scheduleNext(applicationContext)
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "idle trigger worker error: ${e.message}", e)
            // 失败也要排下次，避免链路断
            try { IdleTriggerScheduler.scheduleNext(applicationContext) } catch (_: Exception) {}
            Result.retry()
        }
    }
}
