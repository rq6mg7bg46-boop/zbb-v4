package com.zbb.automation.v4

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * v8 老板设计 2026-07-08: AlarmManager → Worker 桥接
 *
 * 链路:
 *   IdleTriggerScheduler.scheduleAlarmTrigger (5min 周期, v8 用 AlarmManager 替代 WorkManager)
 *     ↓ AlarmManager.setExactAndAllowWhileIdle
 *   IdleTriggerReceiver.onReceive (本类)
 *     ↓ WorkManager.enqueue
 *   IdleTriggerWorker.doWork (5min 静默 + 5s 前置观察 + 触发 WorkOrchestrator)
 *
 * 为什么需要这个 Receiver:
 * - AlarmManager 触发的是 Broadcast (系统层), 不直接触发 WorkManager Worker
 * - 需要一个 BroadcastReceiver 接收 AlarmManager 广播, 然后启动 WorkManager Worker
 * - Receiver 极简: 只做"接收广播 → enqueue Worker"一件事
 *
 * AndroidManifest.xml 注册:
 *   <receiver android:name=".IdleTriggerReceiver" android:exported="false" />
 *
 * 注意:
 * - 不需要 intent-filter (AlarmManager 直接指定 receiver class)
 * - exported="false" 防止其他 app 触发 (安全)
 */
class IdleTriggerReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "IdleTriggerReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        try {
            val workRequest = OneTimeWorkRequestBuilder<IdleTriggerWorker>()
                .setInitialDelay(0, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueue(workRequest)
            Log.i(TAG, "✅ AlarmManager triggered → Worker enqueued")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to enqueue worker: ${e.message}", e)
        }
    }
}