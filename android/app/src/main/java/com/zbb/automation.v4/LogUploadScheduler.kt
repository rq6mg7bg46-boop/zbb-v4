package com.zbb.automation.v4

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * 日志上传调度器 —— v1.6.4.1-huawei-hotfix (2026-07-04 新增)
 *
 * 设计约束：
 * - PeriodicWorkRequest 最小周期 15 分钟（系统硬限制，无法满足"24h 一次"）
 * - 改用 OneTimeWork 链式：initial → WorkManager.retry/backoff → next 24h...
 * - beginUniqueWork 用 KEEP：app 重启时不重复排队
 *
 * 调用入口：
 * - Application.onCreate() 调 scheduleInitialAndLoop() —— 启动后立即上传一次
 * - LogUploadWorker.doWork() 成功后调 scheduleNext() —— 24h 后再触发
 */
object LogUploadScheduler {
    private const val TAG = "LogUploadScheduler"
    private const val WORK_NAME = "zbb_log_upload_chain"
    private const val RETRY_BACKOFF_MIN = 5L    // WorkManager 失败 backoff（指数）

    // === A 方案：调试间隔可调（SharedPreferences） ===
    // 默认 1440 分钟（24h），测试时通过 adb am broadcast 切到 5 分钟
    // 详见 DebugReceiver.applyIntervalMinutes()
    private const val PREFS_NAME = "zbb_debug"
    private const val KEY_INTERVAL_MIN = "interval_minutes"
    private const val DEFAULT_INTERVAL_MIN = 1440L  // 24h 生产值

    /**
     * 读取调试间隔（SharedPreferences）。默认 24h。
     * 通过 DebugReceiver 设置后立即生效。
     */
    private fun getIntervalMinutes(context: Context): Long {
        return try {
            val sp = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            sp.getLong(KEY_INTERVAL_MIN, DEFAULT_INTERVAL_MIN).coerceAtLeast(1L)
        } catch (e: Exception) {
            Log.w(TAG, "getIntervalMinutes failed, fallback=$DEFAULT_INTERVAL_MIN: ${e.message}")
            DEFAULT_INTERVAL_MIN
        }
    }

    /**
     * 改间隔后立即生效（cancel + re-enqueue）
     * DebugReceiver 收到 adb broadcast 时调
     */
    fun applyIntervalMinutes(context: Context, minutes: Long) {
        try {
            val safeMin = minutes.coerceAtLeast(1L)
            val sp = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            sp.edit().putLong(KEY_INTERVAL_MIN, safeMin).apply()
            // cancel 当前链 + 用新间隔重新入队
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            // 短暂延迟避免 cancel 提交前就 enqueue
            WorkManager.getInstance(context)
                .beginUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, buildWorkRequest(context, safeMin))
                .enqueue()
            Log.i(TAG, "interval set to $safeMin min, unique work replaced")
        } catch (e: Exception) {
            Log.e(TAG, "applyIntervalMinutes failed: ${e.message}", e)
        }
    }

    private fun buildWorkRequest(context: Context, initialDelayMin: Long = 0): OneTimeWorkRequest {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        return OneTimeWorkRequestBuilder<LogUploadWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, RETRY_BACKOFF_MIN, TimeUnit.MINUTES)
            .apply {
                if (initialDelayMin > 0) {
                    setInitialDelay(initialDelayMin, TimeUnit.MINUTES)
                }
            }
            .build()
    }

    /**
     * Application.onCreate 调：启动后立即上传一次（无延迟）
     * KEEP 策略：app 重启不覆盖已有 chain（防止 24h 链被截断）
     */
    fun scheduleInitialAndLoop(context: Context) {
        try {
            WorkManager.getInstance(context)
                .beginUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, buildWorkRequest(context, 0))
                .enqueue()
            Log.i(TAG, "scheduled initial upload (work=$WORK_NAME, keep policy)")
        } catch (e: Exception) {
            Log.e(TAG, "schedule failed: ${e.message}", e)
        }
    }

    /**
     * Worker 成功后调：排下一次上传（间隔由 SharedPreferences 控制，默认 24h）
     * KEEP 策略：永远只保持一个 chain 在列队
     */
    fun scheduleNext(context: Context) {
        try {
            val intervalMin = getIntervalMinutes(context)
            val next = buildWorkRequest(context, intervalMin)
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, next)
            Log.d(TAG, "scheduleNext: interval=${intervalMin}min")
        } catch (e: Exception) {
            Log.w(TAG, "scheduleNext failed: ${e.message}")
        }
    }

    /**
     * 测试 + 保活专用 —— 2026-07-05 v1.6.4.1-huawei-hotfix-fix
     * 立即入队一次 OneTimeWorkRequest（delay=0），不等 chain 也不等 scheduleNext。
     * 用于：
     * - DebugReceiver.ACTION_TRIGGER_NOW 测试
     * - ZbbKeepAliveService 周期性 tick (5 min)
     */
    fun scheduleNextForTest(context: Context, initialDelayMin: Long) {
        try {
            val safeDelayMin = initialDelayMin.coerceAtLeast(0L)
            val next = buildWorkRequest(context, safeDelayMin)
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, next)
            Log.d(TAG, "scheduleNextForTest: delay=${safeDelayMin}min policy=REPLACE")
        } catch (e: Exception) {
            Log.w(TAG, "scheduleNextForTest failed: ${e.message}")
        }
    }
}
