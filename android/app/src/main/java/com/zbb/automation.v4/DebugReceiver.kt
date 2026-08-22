package com.zbb.automation.v4

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * 调试用 BroadcastReceiver —— 2026-07-04 A 方案配套（老板拍）
 *
 * 注册到 AndroidManifest (exported=true，给 adb 公开入口)
 *
 * 用法：
 *   # 切到 5 分钟测试周期（写 SharedPreferences + cancel + re-enqueue）
 *   adb shell am broadcast -a com.zbb.automation.DEBUG_SET_INTERVAL \
 *     --el minutes 5 -p com.zbb.automation
 *
 *   # 立即入队一次上传（不等 worker 自动调度）
 *   adb shell am broadcast -a com.zbb.automation.DEBUG_TRIGGER_NOW \
 *     -p com.zbb.automation
 *
 *   # 调回 24h 生产周期
 *   adb shell am broadcast -a com.zbb.automation.DEBUG_SET_INTERVAL \
 *     --el minutes 1440 -p com.zbb.automation
 *
 * 验证 logcat:
 *   adb logcat -s DebugReceiver LogUploadScheduler LogUploadWorker:V
 */
class DebugReceiver : BroadcastReceiver() {
    private val tag = "DebugReceiver"

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_SET_INTERVAL -> {
                val minutes = intent.getLongExtra("minutes", 1440L)
                LogUploadScheduler.applyIntervalMinutes(context, minutes)
                Log.i(tag, "[ACTION_SET_INTERVAL] applied interval=$minutes minutes")
            }
            ACTION_TRIGGER_NOW -> {
                // 立即入队一次 OneTimeWork（不等 chain）
                val req = OneTimeWorkRequestBuilder<LogUploadWorker>()
                    .setInitialDelay(0, TimeUnit.MILLISECONDS)
                    .build()
                WorkManager.getInstance(context).enqueue(req)
                Log.i(tag, "[ACTION_TRIGGER_NOW] enqueued immediate upload")
            }
            else -> {
                Log.w(tag, "unknown action: ${intent.action}")
            }
        }
    }

    companion object {
        const val ACTION_SET_INTERVAL = "com.zbb.automation.DEBUG_SET_INTERVAL"
        const val ACTION_TRIGGER_NOW = "com.zbb.automation.DEBUG_TRIGGER_NOW"
    }
}
