package com.zbb.automation.v4

import android.util.Log
import java.time.LocalTime
import java.time.ZoneId

/**
 * ZBB 业务闸门 —— v19.46 (2026-07-21 老板拍板), v19.61 (2026-07-22 重构)
 *
 * 静默时间窗 (设备本地时区):
 *   - 21:00 (含) - 23:59  → 静默
 *   - 00:00 (含) - 06:59  → 静默
 *   - 07:00 (含) - 20:59  → 活跃
 *
 * 🆕 v19.61 闸门位置重构:
 *   - 第一道: ZbbKeepAliveService.tick (业务中心: log upload / idle worker / startIdleWork)
 *   - 第二道: UserPresentReceiver (解锁立即触发, 5min debounce)
 *   - 第三道: AccessibilityServiceImpl.handleAccessibilityNotification (千机通知, 08-27 老板拍板统一方案)
 *   - ❌ 不接 LogUploadWorker (log 是基础设施, 24h 上传)
 *   - ❌ 不接 IdleTriggerWorker (V32.36.6 已删, 老板 08-31 拍板方案 A)
 *
 * 设计要点:
 *   - D1.1 中央闸门: 业务入口统一调 isQuietHour(), 不是 Worker
 *   - D1.2 🆕 v19.74 (2026-07-25 老板拍板): 强制 Asia/Shanghai 时区, 不依赖 ZoneId.systemDefault()
 *          根因: 07-24 vivo 系统时区漂移 (hour=21 在 system zone 不是静默期), 21:13 跑千机违反设计
 *          修法: hardcoded ZoneId.of("Asia/Shanghai"), 不论 vivo 时区怎么设都按北京时区算
 *   - D1.3 静默期跳过业务, 但前台保活 (ZbbKeepAliveService.handler.postDelayed) 永远循环
 *   - D1.4 手动按钮豁免 (home.tsx DebugReceiver 不走 isQuietHour)
 *   - D1.5 已运行流程不打断 (mutex 已 acquire 的流程让它跑完)
 *   - D1.6 解锁立即触发 (UserPresentReceiver + keyguard 解锁 = 立即 startIdleWork)
 *
 * 接入点 (3 个业务入口):
 *   - ZbbKeepAliveService.tick → 5min 周期兜底
 *   - UserPresentReceiver → 解锁立即触发
 *   - AccessibilityServiceImpl.handleAccessibilityNotification → 千机通知
 *
 * 验证 (v19.61):
 *   - 21:00-07:00 静默期: 4 个入口全部短路, 仅保活心跳
 *   - 07:00 解锁: UserPresentReceiver 立即触发 startIdleWork (不需等 5min tick)
 *   - 锁屏 (任何时段): keyguard 闸门短路, tick 跳过业务
 *   - 手动按钮: DebugReceiver / home.tsx 直接走 service.execute(), 不过 isQuietHour
 *
 * 历史:
 *   v19.46 错位: 把 isQuietHour 接进 Worker (LogUploadWorker/IdleTriggerWorker)
 *                但漏了 WorkOrchestrator.startIdleWork() 入口
 *                → 22:00 业务层还在跑（被老板抓到, 22:00 反馈）
 *   v32.36.6 (08-31 老板拍板方案 A): 删 IdleTriggerReceiver + IdleTriggerWorker + IdleTriggerScheduler
 *                AlarmManager 链 EMUI doze 不可靠, 5min → 6min+
 *                实战反证: IdleWorker + ZBBKeepAlive_tick 31秒内 emit 2 次 zbbIdleWorkTrigger
 *                只留 ZbbKeepAliveService.tick (handler.postDelayed 5min 严格不延迟)
 *   v19.61 重构: 闸门移到业务中心 (tick + UserPresent + 千机通知 4 个入口)
 */
object ZbbTimeGuard {
    private const val TAG = "ZbbTimeGuard"

    /** 静默起始 hour (含) - 21:00 开始 */
    const val QUIET_START_HOUR = 21

    /** 静默结束 hour (含) - 07:00 恢复 */
    const val QUIET_END_HOUR = 7

    /**
     * 当前是否处于静默时段
     * @param zone 时区, 默认 Asia/Shanghai (强制覆盖, 不依赖 system default)
     * @return true = 静默 (21:00-07:00 Asia/Shanghai)
     */
    fun isQuietHour(zone: ZoneId = ZoneId.of("Asia/Shanghai")): Boolean {
        val hour = LocalTime.now(zone).hour
        val isQuiet = hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
        if (isQuiet) {
            Log.i(TAG, "ZBB quiet hour active (hour=$hour, zone=$zone) — skipping auto work")
        }
        return isQuiet
    }

    /**
     * 距离下一个活跃时段开始的毫秒数 (用于一次性排下次)
     * 当前 21:00-23:59 → 距 07:00 (次日) 的毫秒数
     * 当前 00:00-06:59 → 距 07:00 (当天) 的毫秒数
     * 当前 07:00-20:59 → 0 (已经活跃)
     */
    fun msUntilNextActiveHour(zone: ZoneId = ZoneId.of("Asia/Shanghai")): Long {
        val now = LocalTime.now(zone)
        val currentHour = now.hour
        val currentMinute = now.minute
        val currentSecond = now.second
        val currentNano = now.nano

        val hoursUntilActive = when {
            // 活跃时段 (07:00-20:59) → 0 (立即活跃)
            currentHour in QUIET_END_HOUR until QUIET_START_HOUR -> 0
            // 21:00-23:59 → 距次日 07:00
            currentHour >= QUIET_START_HOUR -> {
                val hoursToMidnight = 24 - currentHour
                val hoursFromMidnightToActive = QUIET_END_HOUR
                hoursToMidnight + hoursFromMidnightToActive
            }
            // 00:00-06:59 → 距当天 07:00
            else -> QUIET_END_HOUR - currentHour
        }

        val totalMs = hoursUntilActive * 60 * 60 * 1000L
        val elapsedMs = (currentMinute * 60 + currentSecond) * 1000L + currentNano / 1_000_000L
        return (totalMs - elapsedMs).coerceAtLeast(0L)
    }
}
