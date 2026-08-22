package com.zbb.automation.v4

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * 5min 静默 + 干活 Worker 调度器 —— v8 老板设计 2026-07-08
 *
 * v9 修正 2026-07-08: EMUI 严格后台限制修复 (老板拍板 C 方案 - 完整修复)
 *
 * v8 设计回顾:
 * - AlarmManager.setExactAndAllowWhileIdle 在 EMUI 后台被拒绝
 * - dumpsys alarm 0 命中 com.zbb.automation → 触发器完全失效
 *
 * v9 修复: 3 阶段 fallback
 * - 阶段 1: AlarmManager.setAndAllowWhileIdle (非精确, EMUI 兼容好)
 * - 阶段 2: AlarmManager.set (最普通, 兼容性最高)
 * - 阶段 3: WorkManager.enqueueUniqueWork (兜底, 系统层保证)
 *
 * 链式自续:
 * - MainApplication.onCreate() 调 scheduleInitialAndLoop → 1s 后首次跑
 * - IdleTriggerWorker.doWork() 成功后调 scheduleNext → 5min 后再触发
 * - 失败也会 scheduleNext (v6 IdleTriggerWorker catch 路径已有)
 *
 * 注意: 异常不再被吞, 让 IdleTriggerWorker 知道失败并 retry
 */
object IdleTriggerScheduler {
    private const val TAG = "IdleTriggerScheduler"
    private const val WORK_NAME = "zbb_idle_trigger_chain"
    private const val IDLE_INTERVAL_MIN = 5L

    /**
     * 启动后立即跑首次 (1s 后)
     */
    fun scheduleInitialAndLoop(context: Context) {
        try {
            scheduleAlarmTrigger(context, delayMs = 1000L)
        } catch (e: Exception) {
            Log.e(TAG, "scheduleInitialAndLoop failed: ${e.message}", e)
            throw e  // 不吞异常, 让调用方决定
        }
    }

    /**
     * 5min 后再触发下一次 (Worker.doWork 成功后自动调)
     */
    fun scheduleNext(context: Context) {
        try {
            scheduleAlarmTrigger(context, delayMs = IDLE_INTERVAL_MIN * TimeUnit.MINUTES.toMillis(1))
        } catch (e: Exception) {
            Log.e(TAG, "scheduleNext failed: ${e.message}", e)
            throw e  // 不吞异常
        }
    }

    /**
     * v9: 3 阶段 fallback 调度器
     * @param delayMs 延迟时间 (毫秒)
     */
    private fun scheduleAlarmTrigger(context: Context, delayMs: Long) {
        val intent = Intent(context, IdleTriggerReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val triggerAtTime = System.currentTimeMillis() + delayMs

        // ========== 阶段 1: setAndAllowWhileIdle (非精确, 不需要 SCHEDULE_EXACT_ALARM) ==========
        try {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtTime, pendingIntent)
            Log.i(TAG, "✅ Stage 1 SUCCESS: AlarmManager.setAndAllowWhileIdle (delay=${delayMs}ms, triggerAt=${triggerAtTime})")
            return
        } catch (e: SecurityException) {
            Log.w(TAG, "⚠️ Stage 1 SecurityException (need SCHEDULE_EXACT_ALARM): ${e.message}")
        } catch (e: Exception) {
            Log.w(TAG, "⚠️ Stage 1 failed (EMUI 后台限制?): ${e.message}")
        }

        // ========== 阶段 2: set (最普通, 兼容性最高) ==========
        try {
            alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAtTime, pendingIntent)
            Log.i(TAG, "✅ Stage 2 SUCCESS: AlarmManager.set (delay=${delayMs}ms)")
            return
        } catch (e: Exception) {
            Log.w(TAG, "⚠️ Stage 2 failed: ${e.message}")
        }

        // ========== 阶段 3: WorkManager.enqueueUniqueWork (兜底) ==========
        try {
            val workRequest = OneTimeWorkRequestBuilder<IdleTriggerWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, workRequest)
            Log.i(TAG, "✅ Stage 3 SUCCESS: WorkManager.enqueueUniqueWork (delay=${delayMs}ms)")
        } catch (e: Exception) {
            Log.e(TAG, "❌ All 3 stages failed! 5min 触发器将停止工作: ${e.message}", e)
            throw e  // 不吞异常
        }
    }
}