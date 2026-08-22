package com.zbb.automation.v4

import android.app.Notification
import android.content.Context
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * 千机通知监听服务（方案 1：NotificationListenerService）
 *
 * 用途：
 * - 监听千机（com.lianjia.anchang）的通知栏消息
 * - 解析通知内容（标题/正文/子标题/时间戳）
 * - 通过 AutomationModule.sendEventToJS 发送 "QianjiMessageReceived" 事件给 JS 层
 *
 * 双保险机制：
 * - 方案 1（本服务）：NotificationListenerService，信息最完整
 * - 方案 2（AccessibilityServiceImpl.TYPE_NOTIFICATION_STATE_CHANGED）：兜底
 *
 * 权限：需要用户手动授权（设置 → 通知使用权 → ZBB）
 */
class NotificationMonitorService : NotificationListenerService() {

    companion object {
        private const val TAG = "NotificationMonitor"
        private const val QIANJI_PACKAGE = BuildConfig.QIANJI_PACKAGE  // 🆕 v21.19 (08-02 老板拍板): 用 BuildConfig 变量 (gradle.properties 集中管理)
        private const val EVENT_NAME = "QianjiMessageReceived"
        // 🆕 v19.94 (07-27 老板拍板): 千机通知 dedup 静态状态 (进程级, 重启清空)
        @Volatile private var sLastDedupKey: String = ""
        @Volatile private var sLastDedupTime: Long = 0L
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, ">>> 通知监听服务已连接")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        // 只处理千机包名的通知
        if (sbn.packageName != QIANJI_PACKAGE) return

        // 🆕 v19.61 (07-22) 老板拍板: 千机通知监听闸门
        //   闸门顺序: isQuietHour → keyguard → emit
        //   第一道: 静默期 (21:00-07:00) — 老板原话"不监听千机消息"
        //   第二道: 锁屏 — keyguard 解锁才响应 (跟 ZbbKeepAliveService.tick 一致)
        //   第三道: emit QianjiMessageReceived 给 JS 层
        //
        // 为什么 native 入口拦截而不是 JS QianjiService.ts:
        //   - native 层拦截节省电量 (RN bridge 不触发)
        //   - 双保险 (NotificationMonitorService + AccessibilityServiceImpl) 都要拦截
        //   - 闸门逻辑跟 ZbbKeepAliveService.tick 完全一致, 避免业务边界漂移
        if (ZbbTimeGuard.isQuietHour()) {
            Log.d(TAG, "千机通知: 静默期跳过 (21:00-07:00), 不 emit")
            return
        }
        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
        if (keyguardManager?.isKeyguardLocked == true) {
            Log.d(TAG, "千机通知: 锁屏中跳过, 不 emit")
            return
        }

        val notification: Notification = sbn.notification ?: return
        val extras: Bundle = notification.extras ?: Bundle()

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""

        // 🆕 v19.95 (07-27 老板拍板): 千机通知 dedup (1 min 内同 key 只 emit 1 次)
        //   位置必须在 title/text 解析之后 (之前 v19.94 patch 编译报错就是这个原因)
        //   v19.94 用 pkg+title+text+postTime 作 key, StatusBar 重发时 postTime 不同 → dedup 失效
        //   v19.95 用 sbn.key (Android 通知唯一字符串 key, 重发不变) + title/text 内容兜底
        //   1 min 内同 key 跳过 (处理 StatusBar 重发 + 闸门 return 后重发场景)
        val currentTime = System.currentTimeMillis()
        val dedupKey = "${sbn.key}|$title|$text"
        if (dedupKey == sLastDedupKey && currentTime - sLastDedupTime < 60_000) {
            Log.d(TAG, "千机通知: dedup 跳过 (1 min 内同 key) key=${sbn.key} postTime=${sbn.postTime}")
            return
        }
        sLastDedupKey = dedupKey
        sLastDedupTime = currentTime

        Log.d(TAG, "千机通知: pkg=${sbn.packageName}, title='$title', text='$text', subText='$subText'")

        // 2026-07-05 A 计划: Native 层直接 append 业务事件, 不依赖 RN runtime
        // 拔线 / app 后台 / RN JS 冻结时仍能写日志
        try {
            BusinessLogWriter.append(
                this,
                "info",
                "[QianjiNotification] pkg=${sbn.packageName} title=${title.take(60)} text=${text.take(120).replace("\n", " | ")} subText=${subText.take(60)}"
            )
        } catch (_: Exception) { /* 已在 BusinessLogWriter 内 logcat */ }

        emitQianjiMessage(
            pkg = sbn.packageName,
            title = title,
            text = text,
            subText = subText,
            bigText = bigText,
            timestamp = sbn.postTime
        )
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
        // 不处理通知移除事件
    }

    /**
     * 发送千机消息事件到 JS 层
     * 通过 AutomationModuleManager 单例拿到 AutomationModule 实例
     */
    private fun emitQianjiMessage(
        pkg: String,
        title: String,
        text: String,
        subText: String,
        bigText: String,
        timestamp: Long
    ) {
        try {
            val module = AutomationModuleManager.getModule() ?: run {
                Log.w(TAG, "AutomationModule 未注册，跳过事件发送（RN 可能未启动）")
                return
            }
            val payload = com.facebook.react.bridge.Arguments.createMap().apply {
                putString("package", pkg)
                putString("title", title)
                putString("text", text)
                putString("subText", subText)
                putString("bigText", bigText)
                putDouble("timestamp", timestamp.toDouble())
                putString("source", "notification")  // 标记来源（与 accessibility 区分）
            }
            module.sendEventToJS(EVENT_NAME, payload)
            Log.d(TAG, "已发送 $EVENT_NAME 事件到 JS")
        } catch (e: Exception) {
            Log.e(TAG, "发送事件失败: ${e.message}", e)
        }
    }
}