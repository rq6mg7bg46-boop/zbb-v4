package com.zbb.automation.v4

import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * 干活编排器 —— v6 方向 L 调整（2026-07-07 老板拍板）
 * v8 老板设计 2026-07-08: catalyst false 不再 return, 改切 MainActivity 到前台
 * v10 修复 2026-07-08: proguard keep + R8 不重命名
 * v11 老板拍板 D 方案 2026-07-08: 切 MainActivity 后模拟触摸触发 userActivity
 *      - 切 MainActivity 到前台 (FLAG_KEEP_SCREEN_ON 生效)
 *      - delay 1.5s 等 onResume
 *      - 模拟触摸 (dispatchGesture) 触发 userActivity → 重置 10min timeout
 *      - 双保险: FLAG_KEEP_SCREEN_ON 保持屏幕亮 + userActivity 重置 timeout
 *
 * 触发链路:
 * - 5min 静默 + 5s 前置观察通过
 * - → IdleTriggerWorker.doWork() 调 startIdleWork(context)
 * - → Layer 1: catalyst 活跃 → emit "zbbIdleWorkTrigger" → JS services/index.ts 监听
 * - → Layer 2/3: catalyst 不活跃/null → 切 MainActivity 到前台 + 模拟触摸
 *      → FLAG_KEEP_SCREEN_ON 生效 + userActivity 重置 timeout → 屏幕保持亮
 */
object WorkOrchestrator {
    private const val TAG = "WorkOrchestrator"
    private const val EVENT_IDLE_WORK_TRIGGER = "zbbIdleWorkTrigger"

    /**
     * 启动干活流程
     * v10 关键改动: catalyst 异常时切 MainActivity 到前台 (不再 return)
     * v11 关键改动: 切 MainActivity 后模拟触摸 (dispatchGesture) 触发 userActivity
     */
    fun startIdleWork(context: Context) {
        try {
            val reactContext = AutomationModuleManager.getModule()?.zbbReactApplicationContext()

            // ========== Layer 3: reactContext 为 null (RN 还没启动) ==========
            if (reactContext == null) {
                Log.w(TAG, "react context null — bring MainActivity to front (Layer 3)")
                startMainActivity(context)
                return
            }

            // ========== Layer 2: catalyst 不活跃 (锁屏/后台休眠) ==========
            if (!reactContext.hasActiveCatalystInstance()) {
                Log.w(TAG, "catalyst not active (锁屏/后台休眠) — bring MainActivity to front (Layer 2)")
                startMainActivity(context)
                return
            }

            // ========== Layer 1: catalyst 活跃 → emit 到 JS 层 ==========
            val payload = Arguments.createMap().apply {
                putString("source", "5min_idle_trigger")
                putLong("timestamp", System.currentTimeMillis())
                putString("reason", "user_idle_5min")
            }

            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_IDLE_WORK_TRIGGER, payload)

            Log.i(TAG, "✅ zbbIdleWorkTrigger emitted to RN (source=5min_idle_trigger, ts=${System.currentTimeMillis()})")
        } catch (e: Exception) {
            Log.e(TAG, "startIdleWork failed: ${e.message}", e)
        }
    }

    /**
     * v8 老板设计: 切 MainActivity 到前台
     *
     * v11 老板拍板 D 方案: 切前台后模拟触摸触发 userActivity()
     *
     * 作用:
     * - 切 MainActivity 到前台 → FLAG_KEEP_SCREEN_ON 生效 → 屏幕亮
     * - delay 1.5s 等 MainActivity.onResume
     * - 模拟触摸 (屏幕中间 540,1200) → 触发 userActivity() → 重置 10min timeout
     *
     * 注意:
     * - AccessibilityService 已有 system 权限, dispatchGesture 不需要 INJECT_EVENTS
     * - Doze 模式下 startActivity 可能被 system 拒绝 → catch 异常 + log
     * - 锁屏状态时此方法仍可调, 但效果依赖用户解锁 (老板场景下不常发生)
     */
    private fun startMainActivity(context: Context) {
        try {
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            }
            context.startActivity(intent)
            Log.i(TAG, "✅ MainActivity 切到前台 (REORDER_TO_FRONT) — 1.5s 后模拟触摸")

            // v11 D 方案: delay 1.5s 等 onResume 完成, 然后模拟触摸
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                simulateUserTap()
            }, 1500L)
        } catch (e: Exception) {
            Log.e(TAG, "startMainActivity failed: ${e.message}", e)
        }
    }

    /**
     * v11 D 方案: 模拟触摸触发 userActivity() 重置屏幕 timeout
     *
     * 实现: 通过 AccessibilityService.dispatchGesture 模拟屏幕中间 tap
     *  - 不需要 INJECT_EVENTS 权限 (AccessibilityService 已有 system 权限)
     *  - 不依赖 RN bridge (object 单例, 纯 native)
     *  - 兼容性: 所有 Android 版本 (API 24+)
     *
     * @see <a href="https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#dispatchGesture(android.accessibilityservice.GestureDescription,%20android.accessibilityservice.AccessibilityService.GestureResultCallback,%20android.os.Handler)">AccessibilityService.dispatchGesture</a>
     */
    private fun simulateUserTap() {
        try {
            val service = AccessibilityServiceImpl.instance
            if (service == null) {
                Log.w(TAG, "AccessibilityService 未运行, 跳过模拟触摸 (userActivity 不会被触发)")
                return
            }

            // 屏幕中心 tap (避免 ZBB 自己 UI 误触, 选个空白位置)
            val tapX = 540f
            val tapY = 1200f
            val path = Path().apply { moveTo(tapX, tapY) }
            val stroke = GestureDescription.StrokeDescription(path, 0, 50)  // 0-50ms
            val gesture = GestureDescription.Builder()
                .addStroke(stroke)
                .build()

            val result = service.dispatchGesture(gesture, null, null)
            Log.i(TAG, "✅ 模拟触摸 dispatchGesture: result=$result (位置 ${tapX},${tapY})")
        } catch (e: Exception) {
            Log.e(TAG, "模拟触摸 failed: ${e.message}", e)
        }
    }
}