package com.zbb.automation.v4

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 解锁立即触发 5min 防熄屏 —— v19.61 (07-22 老板拍板)
 *
 * 需求 (老板原话):
 *   "每天21点到第二天7点，ZBB不主动跑5分钟防熄屏，不监听千机消息。
 *    7点起，在解锁的状态下，自动启动5分钟防熄屏"
 *
 * 行为:
 *   - 收到 Intent.ACTION_USER_PRESENT (系统解锁广播) 立即触发 WorkOrchestrator.startIdleWork()
 *   - 不等 5min tick (避免最长 5min 延迟)
 *   - 静默期 (21:00-07:00) 不触发
 *   - 5min debounce: 避免用户反复锁屏/解锁导致频繁触发
 *
 * 跟 ZbbKeepAliveService.tick 的关系:
 *   - tick 是 5min 周期 (兜底)
 *   - UserPresentReceiver 是解锁即时 (抢先)
 *   - 两者都过 isQuietHour 闸门, 闸门逻辑一致
 *
 * Doze 影响:
 *   - 前台保活 (FOREGROUND_SERVICE_TYPE mediaProjection) 部分豁免 Doze
 *   - 但 BroadcastReceiver 在 deep doze 下可能延迟 (实测若 > 30s 延迟, tick 兜底)
 */
class UserPresentReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "UserPresentReceiver"

        // 5min debounce — 避免用户反复锁屏/解锁导致频繁触发
        private const val DEBOUNCE_MS = 5L * 60 * 1000L  // 5 min

        // SharedPreferences
        private const val PREFS_NAME = "zbb_user_present"
        private const val KEY_LAST_TRIGGER_MS = "last_trigger_ms"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_USER_PRESENT) return

        // 第一道闸门: 静默期 (21:00-07:00)
        if (ZbbTimeGuard.isQuietHour()) {
            Log.d(TAG, "user_present: 静默期跳过 (21:00-07:00)")
            return
        }

        // 第二道闸门: 双重确认 keyguard 解锁状态 (系统广播已确认, 这里再 check 一次防 race)
        val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        if (keyguardManager?.isKeyguardLocked == true) {
            Log.d(TAG, "user_present: keyguard 仍 locked, 跳过")
            return
        }

        // 5min debounce
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lastTriggerMs = prefs.getLong(KEY_LAST_TRIGGER_MS, 0L)
        val nowMs = System.currentTimeMillis()
        if (lastTriggerMs > 0L && (nowMs - lastTriggerMs) < DEBOUNCE_MS) {
            Log.d(TAG, "user_present: 5min debounce 跳过 (last=${nowMs - lastTriggerMs}ms < ${DEBOUNCE_MS}ms)")
            return
        }

        // 记录本次触发时间
        prefs.edit().putLong(KEY_LAST_TRIGGER_MS, nowMs).apply()

        // 立即触发 5min 防熄屏
        Log.i(TAG, "user_present: 解锁立即触发 WorkOrchestrator.startIdleWork")
        WorkOrchestrator.startIdleWork(context)
    }
}
