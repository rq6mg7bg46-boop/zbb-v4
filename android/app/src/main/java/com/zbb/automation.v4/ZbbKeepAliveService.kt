package com.zbb.automation.v4

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * ZBB 后台保活前台服务 —— v1.6.4.1-huawei-hotfix (2026-07-05 老板拍板 A+B)
 *
 * 目的：
 * - 解决 11:35 之前 worker self-kill 后无人拉起的根因
 * - 让 ZBB 在 Doze / battery optimization / 华为 EMUI 后台杀进程时仍存活
 * - 周期性（5min）触发 LogUploadWorker，不再依赖 WorkManager.Periodic 15min 硬限制
 *
 * 触发链路：
 * - AccessibilityServiceImpl.onServiceConnected() 调 start(this) 启动
 * - service 自身起前台通知（FOREGROUND_SERVICE_TYPE mediaProjection）
 * - 5 min tick 调 LogUploadScheduler.scheduleNextForTest(0L) 触发 worker
 *
 * 永不下线：
 * - onStartCommand 返回 START_STICKY
 * - onTaskRemoved 重新入队前台 service
 */
class ZbbKeepAliveService : Service() {

    companion object {
        private const val TAG = "ZbbKeepAlive"

        // 与现有 mediaProjection service 的 NOTIF_ID 不冲突（用 9001 区分）
        private const val NOTIF_ID = 9001
        private const val CHANNEL_ID = "zbb_keepalive"
        private const val CHANNEL_NAME = "ZBB 后台保活"
        private const val KEEPALIVE_INTERVAL_MS = 5L * 60 * 1000L  // 5 min

        fun start(context: Context) {
            try {
                Log.i(TAG, "start: launching foreground service")
                val intent = Intent(context, ZbbKeepAliveService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.e(TAG, "start failed: ${e.message}", e)
            }
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private val tickRunnable = object : Runnable {
        override fun run() {
            try {
                // 🆕 v19.61 (07-22) 老板拍板：闸门统一在 tick 入口
                //   闸门顺序：isQuietHour → keyguard → 业务
                //   第一道：静默期 (21:00-07:00) — 业务意图优先
                //   第二道：锁屏 (KeyguardManager.isKeyguardLocked) — 屏幕状态兜底
                //   第三道：业务 3 动作 (log upload / idle worker / startIdleWork)
                //   finally: handler.postDelayed(this, 5min) — 保活永远循环（前台服务不死）
                //
                // v17.3 老板拍板 A: 锁屏只 log + postDelayed 保活心跳, 不触发任何业务
                // v19.61: 锁屏判断从 PowerManager.isInteractive 升级到 KeyguardManager.isKeyguardLocked
                //   原因: 老板语义"解锁状态"= keyguard 解锁, 跟锁屏界面+亮屏区分开

                // 第一道闸门: 静默期 (21:00-07:00)
                if (ZbbTimeGuard.isQuietHour()) {
                    Log.d(TAG, "tick: 静默期跳过业务 (21:00-07:00), 仅保活心跳")
                    return
                }

                // 第二道闸门: 锁屏
                val keyguardManager = applicationContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                if (keyguardManager?.isKeyguardLocked == true) {
                    Log.d(TAG, "tick: 锁屏中跳过业务, 仅保活心跳")
                    return
                }

                Log.d(TAG, "tick: 活跃期+解锁, 触发业务 3 动作")

                Log.d(TAG, "tick: triggering LogUploadScheduler.scheduleNextForTest(0)")
                LogUploadScheduler.scheduleNextForTest(applicationContext, 0L)
                // 🆕 08-27 老板拍板: 删 IdleTriggerScheduler.scheduleNext(applicationContext)
                // 根因 (实测 log D:\Users\lt-ceo\Desktop\test.txt): 双触发链叠加导致间隔 10min (期望 5min)
                //   旧: AlarmManager 5min → emit + ZbbKeepAliveService.tick 5min → scheduleNext(5min) 再排下次 → 叠加成 10min
                //   新: AlarmManager 5min 独占触发, ZbbKeepAliveService.tick 保留 WorkOrchestrator.startIdleWork (下面)
                //   注意: 这条 tick 链是直接 emit, 不依赖 scheduleNext, 删 scheduleNext 不影响 tick 链
                // 引用: skill zbb-automation-v4-umbrella §11 dead logic 3 问
                //       "防的 X 是真问题还是伪问题?" → AlarmManager 链 v9 实战已稳, tick 再排是冗余

                // v12 老板拍板: tick 调 startIdleWork 前检查 lastInteraction 5min 静默
                // 设计意图: ZBB 自己的操作 + 用户操作 = 都是对手机的操作, 系统按 lastInteraction + 10min 熄屏
                //          5min 自动跑 = 永远比 10min 熄屏早 5min 触发 → 屏幕不熄
                //          所以 5min 时间起点 = 最后一次操作时间 (含 ZBB 操作和用户操作)
                // 修复前: tick 固定每 5min 调 startIdleWork (v11 D 方案, 不管操作时间)
                // 修复后: tick 检查 lastInteraction >= 5min 才触发 → 动态调整
                // 🆕 V32.36.0 拆 user/zbb: 5min 静默期只算 ZBB 自身操作 (老板 08-31 拍板)
                // 设计意图: ZBB 跑业务期间 (tap/swipe/input 持续刷 lastZbbInteractionMs) → 永不 idle → 不触发
                // 旧设计: getLastInteractionMs() = max(user, zbb), 用户偶尔触摸也会重置 5min 计时
                // 新设计: getLastZbbInteractionMs() 只算 ZBB 自己操作, 用户触摸不影响 5min 静默
                //   例: 老板刚摸手机 (user=now), 但 ZBB 跑业务结束 (zbb=5min前) → 现在仍 5min idle → 触发干活
                val lastZbbInteractionMs = OperationDetector.getLastZbbInteractionMs()
                val nowMs = System.currentTimeMillis()
                val deltaMs = if (lastZbbInteractionMs == 0L) Long.MAX_VALUE else nowMs - lastZbbInteractionMs
                if (deltaMs >= KEEPALIVE_INTERVAL_MS) {
                    Log.d(TAG, "tick: triggering WorkOrchestrator.startIdleWork (V32.36.0, 5min idle satisfied, lastZbb=$lastZbbInteractionMs delta=${deltaMs}ms)")
                    WorkOrchestrator.startIdleWork(applicationContext)
                } else {
                    Log.d(TAG, "tick: skip WorkOrchestrator.startIdleWork (V32.36.0, 5min idle NOT satisfied, lastZbb=$lastZbbInteractionMs delta=${deltaMs}ms < ${KEEPALIVE_INTERVAL_MS}ms)")
                }
            } catch (e: Exception) {
                Log.w(TAG, "tick error: ${e.message}")
            } finally {
                handler.postDelayed(this, KEEPALIVE_INTERVAL_MS)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())
        Log.i(TAG, "onCreate: foreground service started, NOTIF_ID=$NOTIF_ID")
        handler.postDelayed(tickRunnable, KEEPALIVE_INTERVAL_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: flags=$flags startId=$startId")
        // START_STICKY: OS kill 后会自动重启
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.w(TAG, "onTaskRemoved: re-launching foreground service")
        val restart = Intent(applicationContext, ZbbKeepAliveService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            applicationContext.startForegroundService(restart)
        } else {
            applicationContext.startService(restart)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        handler.removeCallbacks(tickRunnable)
        Log.w(TAG, "onDestroy: keepalive service stopped (warning: relaunch manually if needed)")
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW).apply {
                description = "确保 ZBB 自动化在 doze 下持续运行（5 min 触发一次日志上传）"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("ZBB 后台运行中")
            .setContentText("保活中，每 5 分钟触发一次日志上传")
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
