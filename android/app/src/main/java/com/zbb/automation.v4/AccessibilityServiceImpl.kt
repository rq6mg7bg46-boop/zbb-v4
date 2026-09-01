package com.zbb.automation.v4

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.GestureDescription
import android.annotation.SuppressLint
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.PixelFormat
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.Display
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.animation.ObjectAnimator
import android.animation.AnimatorListenerAdapter
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.View
import android.view.WindowManager.LayoutParams
import android.widget.Toast
// V32.36.7: OCR imports 已删 (老板 09-01 拍板 OCR 误判率高, 全删)
//   com.google.mlkit.vision.common.InputImage
//   com.google.mlkit.vision.text.TextRecognition
//   com.google.mlkit.vision.text.TextRecognizer
//   com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.*
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.io.BufferedReader
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * ZBB 无障碍服务实现类
 * 版本: v1.5 (简化版，移除 MediaProjection 截图)
 * 
 * 功能：
 * 1. 查找界面元素（按文本、按ID）
 * 2. 模拟点击（单击、长按）
 * 3. 模拟滑动
 * 4. 输入文本
 * 5. 监听通知变化
 * 6. 获取剪贴板内容
 */
class AccessibilityServiceImpl : AccessibilityService() {

    companion object {
        private const val TAG = "AccessibilityServiceImpl"

        // 单例实例
        @Volatile
        internal var instance: AccessibilityServiceImpl? = null

        // 🆕 v19.38 (07-20 老板拍板)：千机监听包名黑名单（D3）
        //   - ZBB 自己：showToast 在 EMUI/HarmonyOS 触发系统通知，被自己的 a11y 监听器捕获
        //   - launcher：EMUI "已清理至最佳状态" 是系统通知，不是千机消息
        private val BLOCKED_NOTIF_PACKAGES = setOf(
            "com.zbb.automation",                       // ZBB 自己的 Toast/通知
            "com.huawei.android.launcher",              // EMUI/HarmonyOS 桌面通知
        )

        // 🆕 v19.38 (07-20 老板拍板)：千机监听关键词黑名单（D4）
        //   这些文本是 ZBB 操作千机/保利之后千机产生的"完成通知"，不是新流程触发
        //   即使 text 含"报备有效"也会被这层先过滤，避免 v19.31 规则被绕过
        private val QIANJI_LISTEN_SKIP_KEYWORDS = listOf(
            "报备有效",
            "已自动发送给经纪人",
            "您可在消息列表中查看",
        )

        // 回调接口
        var onNotificationReceived: ((String, String) -> Unit)? = null
        var onScreenshotTaken: ((Bitmap?) -> Unit)? = null
        var onScreenshotSaved: ((String) -> Unit)? = null
        var onStopCallback: (() -> Unit)? = null
        var onScreenshotConfirmedCallback: (() -> Unit)? = null  // 截图确认回调
        
        fun getInstance(): AccessibilityServiceImpl? = instance
        
        fun isServiceRunning(): Boolean {
            return instance != null
        }
        
        /**
         * 使用 AccessibilityManager 检查服务是否启用
         */
        fun isAccessibilityServiceEnabled(context: android.content.Context): Boolean {
            try {
                val accessibilityManager = context.getSystemService(android.content.Context.ACCESSIBILITY_SERVICE) 
                    as android.view.accessibility.AccessibilityManager
                
                val isEnabledGlobally = accessibilityManager.isEnabled
                if (!isEnabledGlobally) {
                    return false
                }
                
                val enabledServices = accessibilityManager.getEnabledAccessibilityServiceList(
                    AccessibilityServiceInfo.FEEDBACK_ALL_MASK
                )
                
                val packageName = context.packageName
                
                for (service in enabledServices) {
                    val serviceId = service.id ?: ""
                    val resolveInfoName = service.resolveInfo?.serviceInfo?.name ?: ""
                    
                    if (serviceId.contains(packageName) || resolveInfoName.contains(packageName)) {
                        Log.d(TAG, "找到已启用的 ZBB 无障碍服务: $serviceId")
                        return true
                    }
                }
                
                Log.d(TAG, "未找到 ZBB 无障碍服务，已启用的服务数量: ${enabledServices.size}")
                return instance != null
            } catch (e: Exception) {
                Log.e(TAG, "检查服务状态失败: ${e.message}")
                return instance != null
            }
        }
        
        /**
         * 清除保存的 MediaProjection 权限（静态方法）
         */
        fun clearSavedMediaProjectionPermissionStatic() {
            try {
                val ctx = instance?.applicationContext ?: return
                val prefs = ctx.getSharedPreferences("zbb_media_projection", android.content.Context.MODE_PRIVATE)
                prefs.edit().clear().apply()
                Log.d(TAG, "已清除无效的 MediaProjection 权限")
            } catch (e: Exception) {
                Log.e(TAG, "清除 MediaProjection 权限失败: ${e.message}")
            }
        }
    }
    
    // 协程作用域
    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    
    // 主线程 Handler
    private val mainHandler = Handler(Looper.getMainLooper())
    
    // MediaProjection 相关 - 现在由 ScreenshotService 持有
    // 保留此变量用于兼容性，但主要通过 ScreenshotService 进行截图
    
    // 悬浮窗管理器
    private var floatingWindowManager: FloatingWindowManager? = null
    
    // 最近的通知内容
    private var lastNotificationText: String = ""

    // 2026-07-06 v5 方向 O 调整：用户触摸结束时间戳（TYPE_TOUCH_INTERACTION_END）
    // 🆕 v19.x (07-23) 老板拍板：5 秒 → 10 秒
    //   理由：用户操作手机时间窗从 5 秒放宽到 10 秒，给用户更长收尾时间（输验证码、点取消等）
    //   千机监听（闸门 3/4）轮询 isUserIdle 阈值同步生效 → 用户操作期间不抢跑启动
    // TS 端 QianjiService 调 isUserIdle() 检测用户空闲（10 秒无触摸 = 空闲）
    private var lastUserTouchTime: Long = 0L
    
    // 用户点击坐标记录（用于校准功能）
    private var lastUserClickX: Int = -1
    private var lastUserClickY: Int = -1
    private var lastUserClickTime: Long = 0
    private var clickHistory: MutableList<Pair<Int, Int>> = mutableListOf()

    // 2026-07-05 A 计划: 节流 windows state 业务日志 (避免高频 noise, 至少 1s 1 条)
    private var lastBusinessLogAppendMs: Long = 0L

    // 点击监听回调（用于校准）
    var onUserClickRecorded: ((x: Int, y: Int) -> Unit)? = null
    
    // 是否正在运行自动化流程
    private var isAutomationRunning = false
    
    // 当前正在运行的协程 Job
    private var currentJob: Job? = null
    
    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.d(TAG, "无障碍服务已创建")
    }
    
    override fun onDestroy() {
        super.onDestroy()
        instance = null
        // MediaProjection 现在由 ScreenshotService 管理，无需在此清理
        floatingWindowManager?.destroy()
        floatingWindowManager = null
        serviceScope.cancel()
        Log.d(TAG, "无障碍服务已销毁")
    }
    
    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(TAG, "无障碍服务已连接")

        // 初始化悬浮窗管理器
        initFloatingWindow()

        // 启动前台服务（用于绑定 MediaProjection 权限）
        startForegroundServiceForMediaProjection()

        // 2026-07-05 v1.6.4.1-huawei-hotfix-fix: 启动保活前台服务
        // 周期性 5min 触发 LogUploadWorker，应对 Doze / EMUI 后台杀进程
        ZbbKeepAliveService.start(this)

        // ========== 千机监听：把无障碍服务通知事件桥接到 JS 层 ==========
        // accessibility_service_config.xml 用 typeAllMask，已包含 TYPE_NOTIFICATION_STATE_CHANGED
        // onAccessibilityEvent 内已经处理此事件并调用 onNotificationReceived 回调
        onNotificationReceived = { packageName: String, text: String ->
            handleAccessibilityNotification(packageName, text)
        }
        Log.d(TAG, "千机通知监听桥接已设置")
    }

    /**
     * 处理千机通知（通过无障碍服务）
     * 发出 QianjiMessageReceived 事件给 JS 层
     * 标记 source="accessibility" 区分
     */
    private fun handleAccessibilityNotification(packageName: String, text: String) {
        try {
            // 🆕 v19.61 (07-22) 老板拍板: 千机通知监听闸门
            //   闸门: 静默期 + 锁屏 (跟 ZbbKeepAliveService.tick 一致)
            //   第一道: 静默期 (21:00-07:00) — 老板原话"不监听千机消息"
            //   第二道: 锁屏 — keyguard 解锁才响应
            if (ZbbTimeGuard.isQuietHour()) {
                Log.d(TAG, "千机通知: 静默期跳过 (21:00-07:00)")
                return
            }
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
            if (keyguardManager?.isKeyguardLocked == true) {
                Log.d(TAG, "千机通知: 锁屏中跳过")
                return
            }

            // 🆕 v19.38 (07-20 老板拍板)：千机监听双层 filter（在写 log 前先过滤，省 log噪音）
            //   第 1 层：包名黑名单（ZBB 自己 + 桌面通知）
            if (BLOCKED_NOTIF_PACKAGES.contains(packageName)) {
                Log.d(TAG, "千机监听已过滤: pkg=$packageName 在包名黑名单中")
                return
            }
            //   第 2 层：关键词黑名单（ZBB 操作后产生的完成通知）
            if (QIANJI_LISTEN_SKIP_KEYWORDS.any { text.contains(it) }) {
                Log.d(TAG, "千机监听已过滤: text 含 ZBB 操作完成关键词, pkg=$packageName")
                return
            }

            // 2026-07-06 v5 方向 O 调整：原生层先写 BusinessLogWriter 兜底（Doze/JS 冻结也不丢）
            try {
                BusinessLogWriter.append(
                    this,
                    "info",
                    "[千机监听] pkg=$packageName text=${text.take(120).replace("\n", " | ")}"
                )
            } catch (_: Exception) { /* 已在 BusinessLogWriter 内 logcat */ }

            val module = AutomationModuleManager.getModule() ?: run {
                Log.w(TAG, "千机监听: AutomationModule 未注册，跳过事件发送")
                return
            }
            val payload = com.facebook.react.bridge.Arguments.createMap().apply {
                putString("package", packageName)
                putString("text", text)
                putString("title", "")
                putString("subText", "")
                putString("bigText", "")
                putDouble("timestamp", System.currentTimeMillis().toDouble())
                putString("source", "accessibility")  // 与 notification 区分
            }
            module.sendEventToJS("QianjiMessageReceived", payload)
            Log.d(TAG, "千机监听已发送 QianjiMessageReceived: pkg=$packageName, text=$text")
        } catch (e: Exception) {
            Log.e(TAG, "千机监听发送事件失败: ${e.message}", e)
        }
    }
    
    /**
     * 启动前台服务用于 MediaProjection 权限
     */
    private fun startForegroundServiceForMediaProjection() {
        try {
            // 启动前台服务
            MediaProjectionService.startService(this)
            Log.d(TAG, "前台服务已启动")
            
            // 同时启动 ScreenshotService（持有 MediaProjection）
            ScreenshotService.startService(this)
            Log.d(TAG, "ScreenshotService 已启动")
        } catch (e: Exception) {
            Log.e(TAG, "启动前台服务失败: ${e.message}")
        }
    }
    
    /**
     * 检查 ScreenshotService 中的 MediaProjection 是否就绪
     * MediaProjection 现在由 ScreenshotService 持有
     */
    private fun checkProjectionStatus(): Boolean {
        return ScreenshotService.instance?.isProjectionReady() ?: false
    }
    
    /**
     * 初始化悬浮窗
     */
    private fun initFloatingWindow() {
        floatingWindowManager = FloatingWindowManager(this)
        floatingWindowManager?.onStopClicked = {
            Log.d(TAG, "用户点击停止按钮")
            stopAutomation()
            // 通知 JS 端停止流程（通过回调）
            onStopCallback?.invoke()
        }
        floatingWindowManager?.onScreenshotConfirmed = {
            Log.d(TAG, "用户点击截图确认按钮");
            // 通知 JS 层
            onScreenshotConfirmedCallback?.invoke()
            // 通过 AutomationModule 发送事件给 JS
            try {
                val module = AutomationModuleManager.getModule()
                module?.sendEventToJS("onScreenshotConfirmed", null)
            } catch (e: Exception) {
                Log.e(TAG, "发送截图确认事件失败: ${e.message}")
            }
        }
        Log.d(TAG, "悬浮窗管理器已初始化")
    }
    
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return

        Log.d(TAG, "收到无障碍事件类型: ${event.eventType}")

        when (event.eventType) {
            AccessibilityEvent.TYPE_TOUCH_INTERACTION_END -> {
                // 2026-07-06 v5 方向 O 调整：用户触摸结束 → 更新时间戳
                // TS 端 isUserIdle() 据此判断用户是否在操作手机
                lastUserTouchTime = System.currentTimeMillis()
                // 2026-07-07 v6 方向 L 调整：5min 静默 + 干活机制
                // 用户真实触摸 → 喂给 OperationDetector，5min 静默期重置
                OperationDetector.recordUserInteraction()
                                // 🆕 V32.36.2: emit DeviceEventEmitter 让 JS 端缓存 (不依赖 Promise 链)
                                //   recordUserInteraction 在 AccessibilityService.onAccessibilityEvent 内调
                                //   不走 RN bridge Promise, RN bridge queue 堵塞不影响
                                try {
                                    com.zbb.automation.v4.AutomationModule.emitUserInteractionRecorded(this, lastUserTouchTime)
                                } catch (_: Exception) { /* emit 失败已在 native logcat */ }
            }
            AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED -> {
                val packageName = event.packageName?.toString() ?: return
                val text = event.text?.joinToString("\n") ?: ""

                if (text.isNotEmpty()) {
                    lastNotificationText = text
                    Log.d(TAG, "收到通知 [$packageName]: $text")
                    // 2026-07-05 A 计划: Native 层直接 append 业务事件, 不依赖 RN runtime
                    // 拔线 / app 后台 / RN JS 冻结时仍能写日志
                    try {
                        BusinessLogWriter.append(
                            this,
                            "info",
                            "[AccessibilityService] 通知事件 pkg=$packageName text=${text.take(120).replace("\n", " | ")}"
                        )
                    } catch (_: Exception) { /* write 失败已在 BusinessLogWriter 内 logcat */ }
                    onNotificationReceived?.invoke(packageName, text)
                }
            }

            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                val className = event.className?.toString() ?: ""
                Log.d(TAG, "窗口变化: $className")
                // 2026-07-05 A 计划: window state change 是业务步骤切换的强信号 (千机 → 保利 → ...)
                // 简化版: 只记顶层 app 切换, 不全量记 (高频 noise 风险)
                val nowMs = System.currentTimeMillis()
                if (className.isNotEmpty() && (nowMs - lastBusinessLogAppendMs) > 1000L) {
                    try {
                        BusinessLogWriter.append(
                            this,
                            "info",
                            "[AccessibilityService] 顶层窗口切换 class=$className"
                        )
                        lastBusinessLogAppendMs = nowMs
                    } catch (_: Exception) { /* 已在内部 logcat */ }
                }
                // 2026-07-07 v6 方向 L 调整：用户切换 app 也算"操作"
                // 避免 5min 静默期错判 (老板在多个 app 间切换，但 AccessibilityService 都在跑)
                OperationDetector.recordUserInteraction()
            }

            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                Log.d(TAG, "窗口内容变化")
            }
            
            AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                // 记录用户点击的坐标
                val source = event.source
                if (source != null) {
                    val boundsInScreen = android.graphics.Rect()
                    source.getBoundsInScreen(boundsInScreen)

                    // 使用点击元素的中心坐标
                    val clickX = boundsInScreen.centerX()
                    val clickY = boundsInScreen.centerY()

                    val currentTime = System.currentTimeMillis()

                    // 只记录2秒内的新点击（避免重复记录）
                    if (currentTime - lastUserClickTime > 2000 || lastUserClickX < 0) {
                        lastUserClickX = clickX
                        lastUserClickY = clickY
                        lastUserClickTime = currentTime

                        // 添加到历史记录
                        clickHistory.add(Pair(clickX, clickY))
                        // 只保留最近10条记录
                        if (clickHistory.size > 10) {
                            clickHistory.removeAt(0)
                        }

                        Log.d(TAG, "记录用户点击坐标: ($clickX, $clickY)")

                        // 通知回调
                        onUserClickRecorded?.invoke(clickX, clickY)
                        // 2026-07-07 v6 方向 L 调整：用户 VIEW 点击也算操作
                        OperationDetector.recordUserInteraction()
                    }

                    source.recycle()
                }
            }
            
            else -> {
                // 其他事件类型
            }
        }
    }
    
    override fun onInterrupt() {
        Log.w(TAG, "无障碍服务被中断")
    }
    
    /**
     * 设置 MediaProjection - 已废弃
     * MediaProjection 现在由 ScreenshotService 持有
     * 保留此方法以保持兼容性，但不再使用
     */
    fun setMediaProjection(projection: MediaProjection) {
        // MediaProjection 现在由 ScreenshotService 管理
        Log.d(TAG, "setMediaProjection: MediaProjection 现由 ScreenshotService 管理")
    }
    
    /**
     * 检查 MediaProjection 是否有效
     * 现在检查 ScreenshotService 中的状态
     */
    fun isMediaProjectionValid(): Boolean {
        return checkProjectionStatus()
    }
    
    /**
     * 测试截图功能（用于检测权限是否有效）
     * 返回测试用的 Bitmap，成功返回 Bitmap，失败返回 null
     * 现在使用 ScreenshotService 进行截图
     */
    fun captureScreenshotForTest(): Bitmap? {
        Log.d(TAG, ">>> captureScreenshotForTest 开始")
        
        // 检查 ScreenshotService 中的 MediaProjection 是否就绪
        if (!checkProjectionStatus()) {
            Log.e(TAG, ">>> ScreenshotService MediaProjection 未就绪")
            return null
        }
        
        // 使用 ScreenshotService 进行截图
        val service = ScreenshotService.instance
        if (service == null) {
            Log.e(TAG, ">>> ScreenshotService 未运行")
            return null
        }
        
        // 使用较小的尺寸进行测试（加快测试速度）
        val testWidth = 108
        val testHeight = 240
        
        // 在后台线程执行截图
        var result: Bitmap? = null
        val latch = CountDownLatch(1)
        
        Thread {
            try {
                result = service.captureScreenshot(testWidth, testHeight, 2000)
            } catch (e: Exception) {
                Log.e(TAG, ">>> 截图异常: ${e.message}")
            } finally {
                latch.countDown()
            }
        }.start()
        
        // 等待截图完成
        try {
            latch.await(3, TimeUnit.SECONDS)
        } catch (e: InterruptedException) {
            Log.e(TAG, ">>> 等待被中断")
        }
        
        return result
    }
    
    // ==================== 悬浮窗控制 ====================
    
    /**
     * 显示悬浮窗
     */
    fun showFloatingWindow() {
        mainHandler.post {
            floatingWindowManager?.show()
            isAutomationRunning = true
            Log.d(TAG, "悬浮窗已显示")
        }
    }
    
    /**
     * 隐藏悬浮窗
     */
    fun hideFloatingWindow() {
        mainHandler.post {
            floatingWindowManager?.hide()
            isAutomationRunning = false
            Log.d(TAG, "悬浮窗已隐藏")
        }
    }
    
    /**
     * 更新悬浮窗步骤
     */
    fun updateFloatingStep(stepName: String, stepIndex: Int, totalSteps: Int = 14) {
        mainHandler.post {
            floatingWindowManager?.updateStep(stepName, stepIndex, totalSteps)
        }
    }
    
    /**
     * 更新悬浮窗 APP 信息
     */
    fun updateFloatingAppInfo(appName: String) {
        mainHandler.post {
            floatingWindowManager?.updateAppInfo(appName)
        }
    }
    
    /**
     * 设置安静模式（非活动时隐藏边框）
     */
    fun setFloatingQuietMode(quiet: Boolean) {
        mainHandler.post {
            floatingWindowManager?.setQuietMode(quiet)
        }
    }
    
    /**
     * 设置空闲状态
     */
    fun setFloatingIdle() {
        mainHandler.post {
            floatingWindowManager?.setQuietMode(true)  // 空闲时隐藏边框
        }
    }
    
    /**
     * 设置完成状态
     */
    fun setFloatingComplete() {
        mainHandler.post {
            floatingWindowManager?.setComplete()
            // 3秒后自动隐藏
            mainHandler.postDelayed({
                floatingWindowManager?.hide()
            }, 3000)
            isAutomationRunning = false
        }
    }

    /**
     * 显示截图确认按钮（悬浮窗内）
     */
    fun showScreenshotButton() {
        mainHandler.post {
            floatingWindowManager?.showScreenshotButton()
        }
    }

    /**
     * 隐藏截图确认按钮
     */
    fun hideScreenshotButton() {
        mainHandler.post {
            floatingWindowManager?.hideScreenshotButton()
        }
    }

    /**
     * 通知截图确认事件给 JS 层
     */
    fun notifyScreenshotConfirmed() {
        mainHandler.post {
            onScreenshotConfirmedCallback?.invoke()
        }
    }
    
    /**
     * 停止自动化流程
     */
    fun stopAutomation() {
        isAutomationRunning = false
        
        // 取消正在运行的协程
        currentJob?.cancel()
        currentJob = null
        
        mainHandler.post {
            Toast.makeText(this, "ZBB 自动化流程已停止", Toast.LENGTH_SHORT).show()
            floatingWindowManager?.setQuietMode(true)  // 停止时隐藏边框
            // 3秒后自动隐藏悬浮窗
            mainHandler.postDelayed({
                floatingWindowManager?.hide()
            }, 3000)
        }
    }
    
    // ==================== 点击坐标记录（用于校准） ====================
    
    /**
     * 获取最后记录的点击坐标
     * @return Pair<x, y> 或 null
     */
    fun getLastClickCoordinates(): Pair<Int, Int>? {
        return if (lastUserClickX >= 0 && lastUserClickY >= 0) {
            Pair(lastUserClickX, lastUserClickY)
        } else {
            null
        }
    }
    
    /**
     * 获取点击历史
     * @return List<Pair<x, y>>
     */
    fun getClickHistory(): List<Pair<Int, Int>> {
        return clickHistory.toList()
    }

    // ==================== 用户空闲检测（v5 方向 O 调整）====================

    /**
     * 用户空闲检测（5 秒内无触摸 = 空闲）
     * TS 端 QianjiService.handleQianjiMessage 在通过 5 道关卡后调本方法
     * 若不空闲（用户在操作手机）则 await delay(1000) 轮询等用户空闲
     * 空闲后立即 startQianjiFlow() 跑报备流程
     * 2026-07-06 v5 老板拍板：避免打断用户操作 + 用户操作完第一时间跑
     * 🆕 v19.x (07-23)：5 秒 → 10 秒（用户操作手机收尾时间窗放宽）
     */
    fun isUserIdle(): Boolean {
        // 🆕 v19.24 (07-18) 老板拍板 A 方案：走 OperationDetector（看用户+ZBB 任何操作）
        // 修复 5s vs 5min 路径分裂：千机监听 5s 空闲检测与 5min trigger 一致
        // 修复前：只读 lastUserTouchTime → ZBB 跑业务时 5s 阈值被误判为"用户空闲" → 千机端抢跑启动
        // 修复后：max(lastUserInteractionMs, lastZbbInteractionMs) → ZBB 操作计入"操作" → 5s 内不空闲 → 千机端不抢跑
        // 🆕 v19.x (07-23) 老板拍板：5s → 10s（用户操作手机收尾时间窗放宽）
        return OperationDetector.isUserIdle(10000L)
    }

    /**
     * 2026-07-07 v6 方向 L 调整：5min 静默 + 干活判定
     * AutomationModule.isUserIdleForLongTime() 调，thresholdMs 由调用方传（默认 5min）
     * 跟 v5 5s 阈值共存：千机监听用 5s，5min 干活用 5min
     * 复用 OperationDetector 记录的用户/ZBB 任何操作时间
     */
    fun isUserIdleForLongTime(thresholdMs: Long): Boolean {
        return OperationDetector.isUserIdle(thresholdMs)
    }

    /**
     * 清除点击历史
     */
    fun clearClickHistory() {
        clickHistory.clear()
        lastUserClickX = -1
        lastUserClickY = -1
        lastUserClickTime = 0
    }
    
    /**
     * 获取最近一次点击（用于校准）
     * @param maxAgeMs 最大时间范围（毫秒）
     * @return Pair<x, y> 或 null
     */
    fun getRecentClick(maxAgeMs: Long = 5000): Pair<Int, Int>? {
        val now = System.currentTimeMillis()
        if (now - lastUserClickTime <= maxAgeMs && lastUserClickX >= 0) {
            return Pair(lastUserClickX, lastUserClickY)
        }
        return null
    }
    
    /**
     * 检查是否正在运行
     */
    fun isRunning(): Boolean = isAutomationRunning
    
    // ==================== 截图功能（备用方案） ====================
    
    /**
     * 截取屏幕截图（使用 AccessibilityNodeInfo 方式）
     * 注意：此方式只能获取当前窗口的视图层级信息，不能获取实际屏幕像素
     */
    @SuppressLint("MissingPermission")
    fun takeScreenshot(callback: (Bitmap?) -> Unit) {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "takeScreenshot 尝试在非主线程调用，已在主线程重新执行")
            mainHandler.post {
                takeScreenshotInternal(callback)
            }
            return
        }
        takeScreenshotInternal(callback)
    }
    
    @SuppressLint("MissingPermission")
    private fun takeScreenshotInternal(callback: (Bitmap?) -> Unit) {
        try {
            val rootNode = rootInActiveWindow
            if (rootNode != null) {
                val bitmap = captureScreenFromNode(rootNode)
                rootNode.recycle()
                callback(bitmap)
            } else {
                Log.w(TAG, "无法获取当前窗口")
                callback(null)
            }
        } catch (e: Exception) {
            Log.e(TAG, "截图失败: ${e.message}")
            callback(null)
        }
    }
    
    private fun captureScreenFromNode(node: AccessibilityNodeInfo): Bitmap? {
        try {
            val location = android.graphics.Rect()
            node.getBoundsInScreen(location)
            
            val width = location.width()
            val height = location.height()
            
            if (width <= 0 || height <= 0) {
                Log.e(TAG, "无效的节点尺寸: $width x $height")
                return null
            }
            
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.drawColor(0xFFFFFFFF.toInt())
            
            Log.d(TAG, "创建空白截图: ${width}x${height}")
            return bitmap
            
        } catch (e: Exception) {
            Log.e(TAG, "节点截图失败: ${e.message}")
            return null
        }
    }
    
    /**
     * 截图并保存到文件
     * 保存到私有目录后，同时复制到 Download 目录
     */
    @SuppressLint("MissingPermission")
    fun takeScreenshotAndSave(filePath: String, callback: ((Boolean, String?) -> Unit)? = null) {
        takeScreenshot { bitmap ->
            if (bitmap != null) {
                serviceScope.launch(Dispatchers.IO) {
                    try {
                        val file = File(filePath)
                        file.parentFile?.mkdirs()
                        
                        FileOutputStream(file).use { out ->
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                        }
                        
                        Log.d(TAG, "截图已保存: $filePath")
                        
                        // 同时保存到 Download 目录（ML Kit OCR 需要）
                        var downloadPath: String? = null
                        try {
                            val downloadDir = android.os.Environment.getExternalStoragePublicDirectory(
                                android.os.Environment.DIRECTORY_DOWNLOADS
                            )
                            val downloadFile = File(downloadDir, file.name)
                            FileOutputStream(downloadFile).use { out ->
                                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                            }
                            downloadPath = downloadFile.absolutePath
                            Log.d(TAG, "截图已复制到 Download: $downloadPath")
                        } catch (e: Exception) {
                            Log.w(TAG, "复制到 Download 失败: ${e.message}")
                        }
                        
                        // 优先返回 Download 路径（供 OCR 使用）
                        val resultPath = downloadPath ?: filePath
                        
                        mainHandler.post {
                            onScreenshotSaved?.invoke(resultPath)
                            callback?.invoke(true, resultPath)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "保存截图失败: ${e.message}")
                        mainHandler.post {
                            callback?.invoke(false, e.message)
                        }
                    } finally {
                        bitmap.recycle()
                    }
                }
            } else {
                Log.w(TAG, "截图为空")
                callback?.invoke(false, "截图为空")
            }
        }
    }
    
    // ==================== 元素查找 ====================
    
    /**
     * 在主线程执行查找操作
     */
    fun findNodeByTextOnMain(text: String, clickable: Boolean = true, callback: (AccessibilityNodeInfo?) -> Unit) {
        mainHandler.post {
            val node = findNodeByText(text, clickable)
            callback(node)
        }
    }
    
    fun findNodeByText(text: String, clickable: Boolean = true): AccessibilityNodeInfo? {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "findNodeByText 尝试在非主线程调用，已在主线程重新执行")
            var result: AccessibilityNodeInfo? = null
            val latch = CountDownLatch(1)
            mainHandler.post {
                result = findNodeByTextInternal(text, clickable)
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)
            return result
        }
        return findNodeByTextInternal(text, clickable)
    }
    
    private fun findNodeByTextInternal(text: String, clickable: Boolean): AccessibilityNodeInfo? {
        Log.d(TAG, "========================================")
        Log.d(TAG, "[findNodeByText] 开始查找: text='$text', clickable=$clickable")
        
        val rootNode = rootInActiveWindow ?: run {
            Log.e(TAG, "[findNodeByText] ✗ rootInActiveWindow 为空!")
            Log.d(TAG, "[findNodeByText] 可能原因: 服务未完全初始化或窗口不可访问")
            return null
        }
        
        Log.d(TAG, "[findNodeByText] ✓ 获取到 rootNode: className=${rootNode.className}")
        
        try {
            // 打印 rootNode 的基本信息
            val rootBounds = android.graphics.Rect()
            rootNode.getBoundsInScreen(rootBounds)
            Log.d(TAG, "[findNodeByText] rootNode bounds: $rootBounds")
            
            // 使用原生 API 查找所有匹配的元素
            val allNodes = rootNode.findAccessibilityNodeInfosByText(text)
            
            Log.d(TAG, "[findNodeByText] findAccessibilityNodeInfosByText 返回 ${allNodes.size} 个节点")
            
            if (allNodes.isEmpty()) {
                // 打印一些子节点信息帮助调试
                Log.d(TAG, "[findNodeByText] 未找到包含 '$text' 的节点")
                Log.d(TAG, "[findNodeByText] rootNode 子节点数量: ${rootNode.childCount}")
                
                // 尝试打印前5个子节点的文本信息
                val sampleCount = minOf(5, rootNode.childCount)
                Log.d(TAG, "[findNodeByText] 前 $sampleCount 个子节点信息:")
                for (i in 0 until sampleCount) {
                    val child = rootNode.getChild(i)
                    if (child != null) {
                        val childText = child.text?.toString() ?: ""
                        val childDesc = child.contentDescription?.toString() ?: ""
                        val childClass = child.className?.toString() ?: ""
                        Log.d(TAG, "[findNodeByText]   [$i] class=$childClass, text='$childText', desc='$childDesc'")
                        child.recycle()
                    }
                }
                
                rootNode.recycle()
                return null
            }
            
            Log.d(TAG, "[findNodeByText] 找到 ${allNodes.size} 个包含 '$text' 的节点")
            
            // 打印每个找到的节点详细信息
            Log.d(TAG, "[findNodeByText] 节点详细信息:")
            for ((index, node) in allNodes.withIndex()) {
                val nodeText = node.text?.toString() ?: ""
                val nodeDesc = node.contentDescription?.toString() ?: ""
                val bounds = android.graphics.Rect()
                node.getBoundsInScreen(bounds)
                Log.d(TAG, "[findNodeByText]   [$index] text='$nodeText', desc='$nodeDesc', clickable=${node.isClickable}, bounds=$bounds")
            }
            
            // 优先返回 clickable 的元素
            for (node in allNodes) {
                val nodeText = node.text?.toString() ?: ""
                val nodeDesc = node.contentDescription?.toString() ?: ""
                
                if (!clickable || node.isClickable) {
                    // 检查元素是否可见（bounds 在屏幕内）
                    val bounds = android.graphics.Rect()
                    node.getBoundsInScreen(bounds)
                    
                    // 如果坐标合理（top >= 0, bottom > top），优先返回
                    if (bounds.top >= 0 && bounds.bottom > bounds.top) {
                        Log.d(TAG, "[findNodeByText] ✓ 返回有效节点: text='$nodeText', bounds=$bounds")
                        rootNode.recycle()
                        return node
                    } else {
                        Log.w(TAG, "[findNodeByText] 节点坐标无效: bounds=$bounds (top=$bounds.top, bottom=$bounds.bottom)")
                    }
                }
            }
            
            // 如果没有找到符合条件的，返回第一个（即使不可见）
            val firstNode = allNodes[0]
            val firstBounds = android.graphics.Rect()
            firstNode.getBoundsInScreen(firstBounds)
            Log.d(TAG, "[findNodeByText] 返回第一个节点(可能不可见): bounds=$firstBounds")
            rootNode.recycle()
            return firstNode
            
        } catch (e: Exception) {
            Log.e(TAG, "[findNodeByText] ✗ 查找元素失败: ${e.message}")
            e.printStackTrace()
            try {
                rootNode.recycle()
            } catch (recycleError: Exception) {
                // 忽略
            }
            return null
        } finally {
            Log.d(TAG, "[findNodeByText] 查找结束")
            Log.d(TAG, "========================================")
        }
    }
    
    private fun findNodeByTextRecursive(
        node: AccessibilityNodeInfo,
        text: String,
        clickable: Boolean
    ): AccessibilityNodeInfo? {
        val nodeText = node.text?.toString() ?: ""
        val contentDesc = node.contentDescription?.toString() ?: ""
        
        val textMatches = nodeText.contains(text, ignoreCase = true) || 
                          contentDesc.contains(text, ignoreCase = true)
        val clickableMatches = !clickable || node.isClickable
        
        if (textMatches && clickableMatches) {
            return node
        }
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            
            val result = findNodeByTextRecursive(child, text, clickable)
            
            if (result != null) {
                return result
            }
        }
        
        return null
    }
    
    /**
     * 导出当前窗口的节点树到日志（用于诊断）
     */
    fun dumpWindowTree(tag: String = "WindowTree") {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { dumpWindowTree(tag) }
            return
        }
        
        val rootNode = rootInActiveWindow
        if (rootNode == null) {
            Log.w(TAG, "[$tag] rootInActiveWindow 为空")
            return
        }
        
        try {
            val sb = StringBuilder()
            sb.appendLine("========== 窗口节点树 ==========")
            sb.appendLine("窗口类名: ${rootNode.className}")
            dumpNodeRecursive(rootNode, sb, 0, maxDepth = 8)
            sb.appendLine("================================")
            
            Log.d(TAG, sb.toString())
            rootNode.recycle()
        } catch (e: Exception) {
            Log.e(TAG, "导出节点树失败: ${e.message}")
            try { rootNode.recycle() } catch (re: Exception) { }
        }
    }
    
    /**
     * 导出当前窗口的节点树并返回字符串（用于JS层打印）
     */
    fun dumpWindowTreeToString(tag: String = "WindowTree"): String? {
        val rootNode = rootInActiveWindow
        if (rootNode == null) {
            Log.w(TAG, "[$tag] rootInActiveWindow 为空")
            return null
        }
        
        return try {
            val sb = StringBuilder()
            sb.appendLine("========== 窗口节点树 ==========")
            sb.appendLine("窗口类名: ${rootNode.className}")
            dumpNodeRecursive(rootNode, sb, 0, maxDepth = 8)
            sb.appendLine("================================")
            rootNode.recycle()
            sb.toString()
        } catch (e: Exception) {
            Log.e(TAG, "导出节点树失败: ${e.message}")
            try { rootNode.recycle() } catch (re: Exception) { }
            null
        }
    }
    
    private fun dumpNodeRecursive(
        node: AccessibilityNodeInfo,
        sb: StringBuilder,
        depth: Int,
        maxDepth: Int
    ) {
        if (depth > maxDepth) return
        
        val indent = "  ".repeat(depth)
        val nodeText = node.text?.toString() ?: ""
        val contentDesc = node.contentDescription?.toString() ?: ""
        val className = node.className?.toString() ?: ""
        
        val info = StringBuilder()
        info.append(indent)
        info.append("[${className.substringAfterLast('.')}]")
        if (nodeText.isNotEmpty()) info.append(" text=\"$nodeText\"")
        if (contentDesc.isNotEmpty()) info.append(" desc=\"$contentDesc\"")
        if (node.isClickable) info.append(" clickable")
        if (node.isEnabled) info.append(" enabled")
        
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)
        info.append(" bounds=$bounds")
        
        sb.appendLine(info.toString())
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            dumpNodeRecursive(child, sb, depth + 1, maxDepth)
        }
    }
    
    /**
     * 查找包含指定文本的元素
     * 返回所有匹配项，不只是第一个
     */
    fun findNodesByText(text: String): List<AccessibilityNodeInfo> {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "findNodesByText 尝试在非主线程调用，已在主线程重新执行")
            var result: List<AccessibilityNodeInfo> = emptyList()
            val latch = CountDownLatch(1)
            mainHandler.post {
                result = findNodesByTextInternal(text)
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)
            return result
        }
        return findNodesByTextInternal(text)
    }
    
    private fun findNodesByTextInternal(text: String): List<AccessibilityNodeInfo> {
        val rootNode = rootInActiveWindow ?: return emptyList()
        val results = mutableListOf<AccessibilityNodeInfo>()
        
        try {
            val allNodes = rootNode.findAccessibilityNodeInfosByText(text)
            if (allNodes.isNotEmpty()) {
                results.addAll(allNodes)
            }
            rootNode.recycle()
        } catch (e: Exception) {
            Log.e(TAG, "findNodesByText 失败: ${e.message}")
            try { rootNode.recycle() } catch (re: Exception) { }
        }
        
        return results
    }
    
    fun findNodeByViewId(viewId: String): AccessibilityNodeInfo? {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "findNodeByViewId 尝试在非主线程调用，已在主线程重新执行")
            var result: AccessibilityNodeInfo? = null
            val latch = CountDownLatch(1)
            mainHandler.post {
                result = findNodeByViewIdInternal(viewId)
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)
            return result
        }
        return findNodeByViewIdInternal(viewId)
    }
    
    private fun findNodeByViewIdInternal(viewId: String): AccessibilityNodeInfo? {
        val rootNode = rootInActiveWindow ?: return null
        
        try {
            val nodes = rootNode.findAccessibilityNodeInfosByViewId(viewId)
            
            if (nodes.isNotEmpty()) {
                return nodes[0]
            } else {
                rootNode.recycle()
                return null
            }
        } catch (e: Exception) {
            Log.e(TAG, "按ID查找失败: ${e.message}")
            try {
                rootNode.recycle()
            } catch (recycleError: Exception) {
                // 忽略
            }
            return null
        }
    }
    
    fun findNodeByConditions(conditions: Map<String, Any>): AccessibilityNodeInfo? {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "findNodeByConditions 尝试在非主线程调用，已在主线程重新执行")
            var result: AccessibilityNodeInfo? = null
            val latch = CountDownLatch(1)
            mainHandler.post {
                result = findNodeByConditionsInternal(conditions)
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)
            return result
        }
        return findNodeByConditionsInternal(conditions)
    }
    
    private fun findNodeByConditionsInternal(conditions: Map<String, Any>): AccessibilityNodeInfo? {
        val rootNode = rootInActiveWindow ?: return null
        
        try {
            return findNodeByConditionsRecursive(rootNode, conditions)
        } catch (e: Exception) {
            Log.e(TAG, "按条件查找失败: ${e.message}")
            try {
                rootNode.recycle()
            } catch (recycleError: Exception) {
                // 忽略
            }
            return null
        }
    }
    
    private fun findNodeByConditionsRecursive(
        node: AccessibilityNodeInfo,
        conditions: Map<String, Any>
    ): AccessibilityNodeInfo? {
        var match = true
        
        conditions["text"]?.let { text ->
            val nodeText = node.text?.toString() ?: ""
            val contentDesc = node.contentDescription?.toString() ?: ""
            match = match && (nodeText.contains(text as String, ignoreCase = true) || 
                            contentDesc.contains(text, ignoreCase = true))
        }
        
        conditions["clickable"]?.let { clickable ->
            match = match && (node.isClickable == (clickable as Boolean))
        }
        
        conditions["enabled"]?.let { enabled ->
            match = match && (node.isEnabled == (enabled as Boolean))
        }
        
        if (match) {
            return node
        }
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findNodeByConditionsRecursive(child, conditions)
            
            if (result != null) {
                return result
            }
            
            child.recycle()
        }
        
        return null
    }
    
    fun getClickableNodes(): List<AccessibilityNodeInfo> {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "getClickableNodes 尝试在非主线程调用，已在主线程重新执行")
            val result = mutableListOf<AccessibilityNodeInfo>()
            val latch = CountDownLatch(1)
            mainHandler.post {
                collectClickableNodesOnMain(result)
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)
            return result
        }
        
        val result = mutableListOf<AccessibilityNodeInfo>()
        collectClickableNodesOnMain(result)
        return result
    }
    
    private fun collectClickableNodesOnMain(result: MutableList<AccessibilityNodeInfo>) {
        val rootNode = rootInActiveWindow ?: return
        
        try {
            collectClickableNodes(rootNode, result)
        } catch (e: Exception) {
            Log.e(TAG, "获取可点击元素失败: ${e.message}")
        }
    }
    
    private fun collectClickableNodes(node: AccessibilityNodeInfo, result: MutableList<AccessibilityNodeInfo>) {
        if (node.isClickable && node.isVisibleToUser) {
            result.add(node)
        }
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectClickableNodes(child, result)
        }
    }
    
    // ==================== 操作执行 ====================
    
    fun click(x: Float, y: Float, callback: ((Boolean) -> Unit)? = null) {
        performClick(x, y, false, 200L, callback)
    }
    
    fun longClick(x: Float, y: Float, duration: Long = 1000, callback: ((Boolean) -> Unit)? = null) {
        performClick(x, y, true, duration, callback)
    }

    /**
     * 带触摸涟漪效果的点击
     * @param x 点击X坐标
     * @param y 点击Y坐标
     * @param showRipple 是否显示涟漪效果（默认true）
     * @param vibrate 是否震动反馈（默认true）
     * @param callback 点击完成回调
     */
    @SuppressLint("MissingPermission")
    fun clickWithVisualFeedback(x: Float, y: Float, showRipple: Boolean = true, vibrate: Boolean = true, callback: ((Boolean) -> Unit)? = null) {
        mainHandler.post {
            // 1. 显示触摸涟漪效果
            if (showRipple) {
                showTouchRipple(x.toInt(), y.toInt())
            }

            // 2. 震动反馈
            if (vibrate) {
                performHapticFeedback()
            }

            // 3. 执行真实点击
            performClick(x, y, false, 200L, callback)
        }
    }

    /**
     * 显示触摸涟漪效果
     * 使用 WindowManager 添加临时视图实现涟漪动画
     */
    private fun showTouchRipple(x: Int, y: Int) {
        try {
            val rippleSize = 80 // 涟漪圆圈大小(直径)
            val duration = 400L // 动画持续时间
            val initialAlpha = 0.8f

            // 创建涟漪视图
            val rippleView = View(this).apply {
                layoutParams = LayoutParams(rippleSize, rippleSize).apply {
                    gravity = Gravity.TOP or Gravity.START
                    this.x = x - rippleSize / 2  // API 30+ 要求 Int
                    this.y = y - rippleSize / 2
                }
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.parseColor("#40FF5722"))
                    setStroke(4, Color.parseColor("#FFFF5722"))
                }
            }

            // 添加到窗口
            val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            windowManager.addView(rippleView, rippleView.layoutParams)

            // 创建缩放动画
            val scaleX = android.animation.ObjectAnimator.ofFloat(rippleView, "scaleX", 0.3f, 2.0f)
            val scaleY = android.animation.ObjectAnimator.ofFloat(rippleView, "scaleY", 0.3f, 2.0f)
            val alphaAnim = android.animation.ObjectAnimator.ofFloat(rippleView, "alpha", initialAlpha, 0f)

            scaleX.duration = duration
            scaleY.duration = duration
            alphaAnim.duration = duration

            // 动画结束后的清理
            val listener = object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    mainHandler.post {
                        try {
                            windowManager.removeView(rippleView)
                        } catch (e: Exception) {
                            // View 可能已被移除
                        }
                    }
                }
            }

            scaleX.addListener(listener)
            scaleX.start()
            scaleY.start()
            alphaAnim.start()

            Log.d(TAG, "显示触摸涟漪: ($x, $y)")
        } catch (e: Exception) {
            Log.e(TAG, "显示涟漪失败: ${e.message}")
        }
    }

    /**
     * 执行震动反馈
     */
    private fun performHapticFeedback() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(30)
            }
        } catch (e: Exception) {
            Log.w(TAG, "震动反馈失败: ${e.message}")
        }
    }

    // 脉冲震动相关变量
    private var isVibrating = false
    private var vibrationJob: Runnable? = null
    private var vibratorForPulse: Vibrator? = null

    /**
     * 开始脉冲震动（震动-暂停循环）
     */
    @SuppressLint("MissingPermission")
    fun startPulseVibration(callback: ((Boolean) -> Unit)? = null) {
        try {
            if (isVibrating) {
                Log.w(TAG, "已经在震动中")
                callback?.invoke(true)
                return
            }
            
            vibratorForPulse = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            
            isVibrating = true
            Log.i(TAG, "开始脉冲震动")
            
            // 在主线程启动震动循环
            mainHandler.post(object : Runnable {
                override fun run() {
                    if (!isVibrating) return
                    
                    vibratorForPulse?.let { v ->
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            // 震动100ms，暂停200ms
                            val pattern = longArrayOf(0, 100, 200)
                            v.vibrate(VibrationEffect.createWaveform(pattern, 0))
                        } else {
                            @Suppress("DEPRECATION")
                            val pattern = longArrayOf(0, 100, 200)
                            v.vibrate(pattern, 0)
                        }
                    }
                    
                    // 300ms后再次震动
                    mainHandler.postDelayed(this, 300)
                }
            }.also { vibrationJob = it })
            
            // 30秒后自动停止震动（修复：原写 60 秒与 BaoliService 注释/期望不符，老板 2026-06-16 反馈）
            mainHandler.postDelayed({
                if (isVibrating) {
                    Log.i(TAG, "震动超时30秒，自动停止")
                    stopVibration()
                }
            }, 30000)
            
            callback?.invoke(true)
        } catch (e: Exception) {
            Log.e(TAG, "脉冲震动失败: ${e.message}")
            callback?.invoke(false)
        }
    }

    /**
     * 停止震动
     */
    fun stopVibration() {
        try {
            isVibrating = false
            vibrationJob?.let { mainHandler.removeCallbacks(it) }
            vibrationJob = null
            vibratorForPulse?.cancel()
            vibratorForPulse = null
            Log.i(TAG, "震动已停止")
        } catch (e: Exception) {
            Log.e(TAG, "停止震动失败: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    private fun performClick(x: Float, y: Float, isLongPress: Boolean, clickDuration: Long, callback: ((Boolean) -> Unit)?) {
        val gestureBuilder = GestureDescription.Builder()
        val path = android.graphics.Path().apply {
            moveTo(x, y)
        }
        
        val strokeBuilder = GestureDescription.StrokeDescription(
            path,
            0,
            clickDuration
        )
        
        gestureBuilder.addStroke(strokeBuilder)
        
        val gesture = gestureBuilder.build()
        
        val success = dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                Log.d(TAG, "点击完成: ($x, $y), 长按=$isLongPress")
                mainHandler.post {
                    callback?.invoke(true)
                }
            }
            
            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "点击取消: ($x, $y)")
                mainHandler.post {
                    callback?.invoke(false)
                }
            }
        }, null)
        
        if (!success) {
            Log.e(TAG, "点击分发失败")
            callback?.invoke(false)
        }
    }
    
    @SuppressLint("MissingPermission")
    fun clickByText(text: String, isLongPress: Boolean = false, callback: ((Boolean) -> Unit)? = null) {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "clickByText 尝试在非主线程调用，已在主线程重新执行")
            mainHandler.post {
                clickByTextInternal(text, isLongPress, callback)
            }
            return
        }
        clickByTextInternal(text, isLongPress, callback)
    }
    
    @SuppressLint("MissingPermission")
    private fun clickByTextInternal(text: String, isLongPress: Boolean, callback: ((Boolean) -> Unit)?) {
        val node = findNodeByText(text, clickable = true)
        
        if (node != null) {
            try {
                val bounds = android.graphics.Rect()
                node.getBoundsInScreen(bounds)
                
                val centerX = bounds.centerX().toFloat()
                val centerY = bounds.centerY().toFloat()
                
                Log.d(TAG, "找到元素 [$text], 位置: ($centerX, $centerY)")
                
                val duration = if (isLongPress) 1000L else 200L
                performClick(centerX, centerY, isLongPress, duration) { success ->
                    node.recycle()
                    callback?.invoke(success)
                }
            } catch (e: Exception) {
                Log.e(TAG, "点击元素失败: ${e.message}")
                try {
                    node.recycle()
                } catch (recycleError: Exception) {
                    // 忽略
                }
                callback?.invoke(false)
            }
        } else {
            Log.w(TAG, "未找到元素: $text")
            callback?.invoke(false)
        }
    }
    
    @SuppressLint("MissingPermission")
    fun clickByViewId(viewId: String, isLongPress: Boolean = false, callback: ((Boolean) -> Unit)? = null) {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "clickByViewId 尝试在非主线程调用，已在主线程重新执行")
            mainHandler.post {
                clickByViewIdInternal(viewId, isLongPress, callback)
            }
            return
        }
        clickByViewIdInternal(viewId, isLongPress, callback)
    }
    
    @SuppressLint("MissingPermission")
    private fun clickByViewIdInternal(viewId: String, isLongPress: Boolean, callback: ((Boolean) -> Unit)?) {
        val node = findNodeByViewId(viewId)
        
        if (node != null) {
            try {
                val bounds = android.graphics.Rect()
                node.getBoundsInScreen(bounds)
                
                val centerX = bounds.centerX().toFloat()
                val centerY = bounds.centerY().toFloat()
                
                Log.d(TAG, "找到元素 [id=$viewId], 位置: ($centerX, $centerY)")
                
                val duration = if (isLongPress) 1000L else 200L
                performClick(centerX, centerY, isLongPress, duration) { success ->
                    node.recycle()
                    callback?.invoke(success)
                }
            } catch (e: Exception) {
                Log.e(TAG, "点击元素失败: ${e.message}")
                try {
                    node.recycle()
                } catch (recycleError: Exception) {
                    // 忽略
                }
                callback?.invoke(false)
            }
        } else {
            Log.w(TAG, "未找到元素: $viewId")
            callback?.invoke(false)
        }
    }
    
    @SuppressLint("MissingPermission")
    fun swipe(
        startX: Float,
        startY: Float,
        endX: Float,
        endY: Float,
        duration: Long = 500,
        callback: ((Boolean) -> Unit)? = null
    ) {
        val gestureBuilder = GestureDescription.Builder()
        val path = android.graphics.Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        
        val strokeBuilder = GestureDescription.StrokeDescription(path, 0, duration)
        gestureBuilder.addStroke(strokeBuilder)
        
        val gesture = gestureBuilder.build()
        
        dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                Log.d(TAG, "滑动完成: ($startX,$startY) -> ($endX,$endY)")
                mainHandler.post {
                    callback?.invoke(true)
                }
            }
            
            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "滑动取消")
                mainHandler.post {
                    callback?.invoke(false)
                }
            }
        }, null)
    }

    /**
     * 🆕 v21.13 (08-02 老板拍板): 三指下滑手势 (dp 单位 + 拟人化 + 同步)
     *   老板需求: ZBB 打开企业微信后, 自动执行三指下滑
     *   适用: BaoliService 步骤1 + YuexiuService 步骤1 (都要进企微)
     *   实现:
     *     1. 参数用 dp (density-independent pixels) 替代 px → 跨设备物理尺寸一致
     *     2. 拟人化: 三指 X 位置随机偏移 ±10dp (人手做不到精确对称)
     *     3. 🆕 v21.14 (08-02 老板拍板): 三指同步下滑 (启动时间差 = 0ms)
     *        实战证明: 三指不同步下滑 (0/30/60ms 时间差) 在 vivo 上识别失败
     *        老板拍板: 改为同步下滑 (同时开始, 同时结束), 拟人化只保留 X 偏移
     *     4. 拟人化: 轨迹用直线 (GestureDescription cubicTo 支持曲线但简单起见用直线)
     *   默认参数:
     *     startY=100dp (顶部往下 100dp)
     *     endY=500dp (屏幕 500dp 位置)
     *     duration=400ms
     *     timeGapMs=0 (三指同步, v21.14 老板拍板)
     */
    @SuppressLint("MissingPermission")
    fun threeFingerSwipeDown(
        startY: Float = 100f,        // dp 单位
        endY: Float = 500f,          // dp 单位
        duration: Long = 400,
        xPercent: FloatArray = floatArrayOf(0.25f, 0.5f, 0.75f),  // 三指 X 屏幕百分比
        callback: ((Boolean) -> Unit)? = null
    ) {
        val density = resources.displayMetrics.density
        val screenWidth = resources.displayMetrics.widthPixels.toFloat()
        val startYpx = startY * density
        val endYpx = endY * density

        // 🆕 v21.14 (08-02 老板拍板): 三指同步下滑 (启动时间差 = 0ms)
        //   实战证明: 三指不同步下滑 (0/30/60ms 时间差) 在 vivo 上识别失败
        //   老板拍板: 改为同步下滑 (同时开始, 同时结束), 拟人化只保留 X 偏移
        // 🆕 拟人化: 三指 X 位置随机偏移 ±10dp (人手做不到精确对称)
        val randomOffset = java.util.Random()
        val fingerXList = xPercent.map { percent ->
            val baseX = screenWidth * percent
            val offset = (randomOffset.nextFloat() - 0.5f) * 20f * density  // ±10dp
            (baseX + offset).coerceAtLeast(10f)
        }

        Log.d(TAG, "三指下滑开始 (同步 v21.16): density=$density startY=${startY}dp endY=${endY}dp duration=${duration}ms")
        Log.d(TAG, "三指 X (px): ${fingerXList.joinToString(", ")}")

        // 🆕 v21.16 (08-02 老板拍板修法): 1 个 GestureDescription + 3 个 stroke
        //   v21.14 bug 实战证明: 3 个独立 dispatchGesture 几乎同时调用, Android 同一时间只处理一个
        //   结果: 后调用的覆盖前一个, 只有最右侧生效
        //   老板拍板: 构造 1 个 GestureDescription, 包含 3 个 stroke 同时执行
        //   Android GestureDescription.Builder.addStroke() 支持多 stroke (三指手势)
        val pathList = fingerXList.map { x ->
            android.graphics.Path().apply {
                moveTo(x, startYpx)
                lineTo(x, endYpx)
            }
        }

        val gestureBuilder = GestureDescription.Builder()
        pathList.forEachIndexed { i, path ->
            val strokeBuilder = GestureDescription.StrokeDescription(path, 0, duration)
            gestureBuilder.addStroke(strokeBuilder)
            Log.d(TAG, "三指第 ${i+1} 指 stroke 加入: x=${fingerXList[i]}")
        }

        val gesture = gestureBuilder.build()
        Log.d(TAG, "三指 GestureDescription 构建完成 (1 个 gesture, ${pathList.size} 个 stroke)")

        dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                Log.d(TAG, "三指下滑完成 (1 个 gesture, ${pathList.size} 个 stroke)")
                mainHandler.post { callback?.invoke(true) }
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "三指下滑取消")
                mainHandler.post { callback?.invoke(false) }
            }
        }, null)
    }

    /**
     * 🆕 v22.02.30 (08-12 老板拍板): 三指多段手势 (用于三指下滑截图测试模块)
     *   老板需求: 在 ThreeFingerTestScreen 测方案 3/4/6 (tap+下滑/press+下滑/长按+下滑)
     *   现有 threeFingerSwipeDown 是单 GestureDescription, 不支持 2 段
     *   修法: 串行调用多次 GestureDescription, 第一段完成后等 callback 再发第二段
     *   ⚠️ 铁律 51: 每段 GestureDescription 内部仍然是 1 个 gesture + 3 个 stroke 同步
     */
    @SuppressLint("MissingPermission")
    fun threeFingerMultiStageGesture(
        stages: Array<FloatArray>,     // [[startY_dp, endY_dp, duration_ms], ...]
        xPercent: FloatArray = floatArrayOf(0.25f, 0.5f, 0.75f),
        stageGapMs: Long = 0,          // 段间间隔 (ms)
        callback: ((Boolean) -> Unit)? = null
    ) {
        if (stages.isEmpty()) {
            callback?.invoke(false)
            return
        }
        val density = resources.displayMetrics.density
        val screenWidth = resources.displayMetrics.widthPixels.toFloat()

        // 拟人化 X 偏移 (跟 threeFingerSwipeDown 一致)
        val randomOffset = java.util.Random()
        val fingerXList = xPercent.map { percent ->
            val baseX = screenWidth * percent
            val offset = (randomOffset.nextFloat() - 0.5f) * 20f * density
            (baseX + offset).coerceAtLeast(10f)
        }

        Log.d(TAG, "三指多段手势: 共 ${stages.size} 段, density=$density")
        Log.d(TAG, "三指 X (px): ${fingerXList.joinToString(", ")}")

        // 递归执行每段
        fun executeStage(index: Int) {
            if (index >= stages.size) {
                Log.d(TAG, "三指多段手势全部完成 (${stages.size} 段)")
                mainHandler.post { callback?.invoke(true) }
                return
            }
            val stage = stages[index]
            val startY = stage[0]
            val endY = stage[1]
            val duration = stage[2].toLong()
            val startYpx = startY * density
            val endYpx = endY * density

            Log.d(TAG, "三指多段手势 段 ${index+1}/${stages.size}: startY=${startY}dp endY=${endY}dp duration=${duration}ms")

            // 构造该段的 1 个 GestureDescription + 3 个 stroke
            val pathList = fingerXList.map { x ->
                android.graphics.Path().apply {
                    moveTo(x, startYpx)
                    lineTo(x, endYpx)
                }
            }

            val gestureBuilder = GestureDescription.Builder()
            pathList.forEach { path ->
                gestureBuilder.addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            }
            val gesture = gestureBuilder.build()

            dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    Log.d(TAG, "三指多段手势 段 ${index+1} 完成")
                    if (stageGapMs > 0) {
                        mainHandler.postDelayed({ executeStage(index + 1) }, stageGapMs)
                    } else {
                        mainHandler.post { executeStage(index + 1) }
                    }
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    Log.w(TAG, "三指多段手势 段 ${index+1} 取消")
                    mainHandler.post { callback?.invoke(false) }
                }
            }, null)
        }

        executeStage(0)
    }

    @SuppressLint("MissingPermission")
    fun pullToRefresh(callback: ((Boolean) -> Unit)? = null) {
        val displayMetrics = resources.displayMetrics
        val screenWidth = displayMetrics.widthPixels
        val screenHeight = displayMetrics.heightPixels
        
        val startX = screenWidth / 2f
        val startY = screenHeight / 3f
        val endX = startX
        val endY = screenHeight * 2 / 3f
        
        swipe(startX, startY, endX, endY, 500, callback)
    }
    
    @SuppressLint("MissingPermission")
    fun scrollUp(callback: ((Boolean) -> Unit)? = null) {
        val displayMetrics = resources.displayMetrics
        val screenWidth = displayMetrics.widthPixels
        val screenHeight = displayMetrics.heightPixels
        
        val startX = screenWidth / 2f
        val startY = screenHeight * 2 / 3f
        val endX = startX
        val endY = screenHeight / 3f
        
        swipe(startX, startY, endX, endY, 500, callback)
    }
    
    @SuppressLint("MissingPermission")
    fun scrollDown(callback: ((Boolean) -> Unit)? = null) {
        val displayMetrics = resources.displayMetrics
        val screenWidth = displayMetrics.widthPixels
        val screenHeight = displayMetrics.heightPixels
        
        val startX = screenWidth / 2f
        val startY = screenHeight / 3f
        val endX = startX
        val endY = screenHeight * 2 / 3f
        
        swipe(startX, startY, endX, endY, 500, callback)
    }
    
    // ==================== 输入操作 ====================
    
    fun inputText(text: String, callback: ((Boolean) -> Unit)? = null) {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "inputText 尝试在非主线程调用，已在主线程重新执行")
            mainHandler.post {
                inputTextInternal(text, callback)
            }
            return
        }
        inputTextInternal(text, callback)
    }
    
    /**
     * 清空输入框
     */
    fun clearInput(callback: ((Boolean) -> Unit)? = null) {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "clearInput 尝试在非主线程调用，已在主线程重新执行")
            mainHandler.post {
                clearInputInternal(callback)
            }
            return
        }
        clearInputInternal(callback)
    }
    
    private fun clearInputInternal(callback: ((Boolean) -> Unit)?) {
        val focusedNode = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        
        if (focusedNode != null) {
            try {
                // 使用 ACTION_SET_TEXT 设置空字符串来清空输入框
                val arguments = Bundle().apply {
                    putString(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
                }
                
                val success = focusedNode.performAction(
                    AccessibilityNodeInfo.ACTION_SET_TEXT,
                    arguments
                )
                
                Log.d(TAG, "清空输入框: 成功: $success")
                focusedNode.recycle()
                callback?.invoke(success)
            } catch (e: Exception) {
                Log.e(TAG, "清空输入框失败: ${e.message}")
                try {
                    focusedNode.recycle()
                } catch (recycleError: Exception) {
                    // 忽略
                }
                callback?.invoke(false)
            }
        } else {
            Log.w(TAG, "未找到输入框")
            callback?.invoke(false)
        }
    }
    
    private fun inputTextInternal(text: String, callback: ((Boolean) -> Unit)?) {
        val focusedNode = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        
        if (focusedNode != null) {
            try {
                val arguments = Bundle().apply {
                    putString(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                }
                
                val success = focusedNode.performAction(
                    AccessibilityNodeInfo.ACTION_SET_TEXT,
                    arguments
                )
                
                Log.d(TAG, "输入文本: $text, 成功: $success")
                focusedNode.recycle()
                callback?.invoke(success)
            } catch (e: Exception) {
                Log.e(TAG, "输入文本失败: ${e.message}")
                try {
                    focusedNode.recycle()
                } catch (recycleError: Exception) {
                    // 忽略
                }
                callback?.invoke(false)
            }
        } else {
            Log.w(TAG, "未找到输入框")
            pasteText(text, callback)
        }
    }
    
    @Suppress("DEPRECATION")
    fun pasteText(text: String, callback: ((Boolean) -> Unit)? = null) {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "pasteText 尝试在非主线程调用，已在主线程重新执行")
            mainHandler.post {
                pasteTextInternal(text, callback)
            }
            return
        }
        pasteTextInternal(text, callback)
    }
    
    @Suppress("DEPRECATION")
    private fun pasteTextInternal(text: String, callback: ((Boolean) -> Unit)?) {
        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = android.content.ClipData.newPlainText("ZBB Input", text)
            clipboard.setPrimaryClip(clip)
            
            val focusedNode = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            if (focusedNode != null) {
                try {
                    val success = focusedNode.performAction(AccessibilityNodeInfo.ACTION_PASTE)
                    Log.d(TAG, "粘贴文本: $text, 成功: $success")
                    focusedNode.recycle()
                    callback?.invoke(success)
                } catch (e: Exception) {
                    focusedNode.recycle()
                    callback?.invoke(false)
                }
            } else {
                callback?.invoke(false)
            }
        } catch (e: Exception) {
            Log.e(TAG, "粘贴文本失败: ${e.message}")
            callback?.invoke(false)
        }
    }
    
    // ==================== 剪贴板操作 ====================
    
    @Suppress("DEPRECATION")
    fun getClipboardText(): String? {
        return try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip
            if (clip != null && clip.itemCount > 0) {
                clip.getItemAt(0).text?.toString()
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "获取剪贴板失败: ${e.message}")
            null
        }
    }
    
    @Suppress("DEPRECATION")
    fun setClipboardText(text: String): Boolean {
        return try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = android.content.ClipData.newPlainText("ZBB", text)
            clipboard.setPrimaryClip(clip)
            true
        } catch (e: Exception) {
            Log.e(TAG, "设置剪贴板失败: ${e.message}")
            false
        }
    }
    
    // ==================== 应用操作 ====================
    
    fun isAppInBackground(packageName: String): Boolean {
        return try {
            val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            @Suppress("DEPRECATION")
            val runningTasks = activityManager.getRunningTasks(1)
            
            if (runningTasks.isNotEmpty()) {
                val topActivity = runningTasks[0].topActivity
                topActivity?.packageName != packageName
            } else {
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "检查应用状态失败: ${e.message}")
            true
        }
    }
    
    fun getCurrentPackageName(): String? {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "getCurrentPackageName 尝试在非主线程调用，已在主线程重新执行")
            var result: String? = null
            val latch = CountDownLatch(1)
            mainHandler.post {
                result = getCurrentPackageNameInternal()
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)
            return result
        }
        return getCurrentPackageNameInternal()
    }
    
    private fun getCurrentPackageNameInternal(): String? {
        return try {
            val rootNode = rootInActiveWindow
            val packageName = rootNode?.packageName?.toString()
            rootNode?.recycle()
            packageName
        } catch (e: Exception) {
            Log.e(TAG, "获取包名失败: ${e.message}")
            null
        }
    }
    
    fun showToast(message: String) {
        // Toast 需要在主线程执行
        mainHandler.post {
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        }
    }
    
    // ==================== 启动应用 ====================
    
    /**
     * 启动指定应用
     * @param packageName 应用包名，如 "com.ss.android.ume" (抖音)
     * @param callback 回调
     */
    fun launchApp(packageName: String, callback: ((Boolean) -> Unit)? = null) {
        // 确保在主线程执行
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "launchApp 尝试在非主线程调用，已在主线程重新执行")
            mainHandler.post {
                launchAppInternal(packageName, callback)
            }
            return
        }
        launchAppInternal(packageName, callback)
    }
    
    private fun launchAppInternal(packageName: String, callback: ((Boolean) -> Unit)?) {
        try {
            Log.d(TAG, "正在启动应用: $packageName")
            
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            
            if (launchIntent != null) {
                launchIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(launchIntent)
                Log.d(TAG, "应用启动成功: $packageName")
                mainHandler.post {
                    callback?.invoke(true)
                }
            } else {
                Log.w(TAG, "未找到应用: $packageName，请检查包名是否正确")
                mainHandler.post {
                    callback?.invoke(false)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "启动应用失败: ${e.message}")
            mainHandler.post {
                callback?.invoke(false)
            }
        }
    }

    /**
     * 使用 AccessibilityService 权限启动第三方应用
     * 
     * 原理：AccessibilityService 运行在系统进程中，拥有比普通 App 更高的权限。
     * 可以直接调用 startActivity() 启动任意应用的任意 Activity，无需 shell 命令。
     * 
     * 关键代码：
     * 1. 通过 ComponentName 直接构造目标 Activity 的 Intent
     * 2. 添加 FLAG_ACTIVITY_NEW_TASK 标志
     * 3. 调用 startActivity()（AccessibilityService 的方法）
     * 
     * @param packageName 包名，如 "com.lianjia.anchang"
     * @param mainActivityClass 启动的 Activity 类名，如 "com.lianjia.link.platform.main.MainActivity"
     * @param callback 启动结果回调
     */
    fun launchAppWithAmStart(packageName: String, mainActivityClass: String, callback: ((Boolean) -> Unit)? = null) {
        try {
            Log.d(TAG, "使用 AccessibilityService 启动应用: $packageName/$mainActivityClass")
            
            // 直接构造 Intent 并启动（AccessibilityService 权限）
            val componentName = android.content.ComponentName(packageName, mainActivityClass)
            val intent = android.content.Intent()
            intent.setComponent(componentName)
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            
            Log.d(TAG, "AccessibilityService startActivity 启动成功")
            callback?.invoke(true)
            
        } catch (e: Exception) {
            Log.e(TAG, "AccessibilityService 启动失败: ${e.message}")
            callback?.invoke(false)
        }
    }

    /**
     * 使用 shell monkey 方式启动应用（更可靠）
     */
    fun launchAppWithMonkey(packageName: String, mainActivityClass: String, callback: ((Boolean) -> Unit)? = null) {
        try {
            Log.d(TAG, "使用 monkey 启动应用: $packageName")
            
            Thread {
                try {
                    val command = "monkey -p $packageName -c android.intent.category.LAUNCHER 1"
                    Log.d(TAG, "执行命令: $command")
                    val process = Runtime.getRuntime().exec(arrayOf("sh", "-c", command))

                    val exitCode = process.waitFor()
                    Log.d(TAG, "am start 启动完成，exitCode: $exitCode")

                    if (exitCode == 0) {
                        mainHandler.post {
                            callback?.invoke(true)
                        }
                    } else {
                        mainHandler.post {
                            callback?.invoke(false)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "启动失败: ${e.message}")
                    mainHandler.post {
                        callback?.invoke(false)
                    }
                }
            }.start()
        } catch (e: Exception) {
            Log.e(TAG, "launchAppWithMonkey 异常: ${e.message}")
            callback?.invoke(false)
        }
    }
    
    /**
     * 按 Home 键退出到桌面（使用 performGlobalAction，更可靠）
     */
    fun pressHomeKey(callback: ((Boolean) -> Unit)? = null) {
        try {
            Log.d(TAG, "按下 Home 键")
            val performed = performGlobalAction(GLOBAL_ACTION_HOME)
            if (performed) {
                Log.d(TAG, "Home 键成功，等待窗口切换...")
                // 等待窗口切换完成
                mainHandler.postDelayed({
                    callback?.invoke(true)
                }, 500)
            } else {
                Log.e(TAG, "Home 键执行失败")
                callback?.invoke(false)
            }
        } catch (e: Exception) {
            Log.e(TAG, "pressHomeKey 失败: ${e.message}")
            callback?.invoke(false)
        }
    }

    /**
     * 按文字查找节点坐标
     */
    fun findNodeCenterByText(text: String): Map<String, Any>? {
        val rootNode = rootInActiveWindow ?: return null
        return try {
            findNodeRecursive(rootNode, text)
        } finally {
            rootNode.recycle()
        }
    }

    private fun findNodeRecursive(node: AccessibilityNodeInfo, text: String): Map<String, Any>? {
        val nodeText = node.text?.toString() ?: ""
        if (nodeText.contains(text)) {
            val bounds = android.graphics.Rect()
            node.getBoundsInScreen(bounds)
            return mapOf(
                "centerX" to (bounds.left + bounds.right) / 2,
                "centerY" to (bounds.top + bounds.bottom) / 2,
                "text" to nodeText
            )
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findNodeRecursive(child, text)
            child.recycle()
            if (result != null) return result
        }
        return null
    }

    // ==================== 等待辅助 ====================
    
    fun waitForCondition(
        condition: () -> Boolean,
        timeout: Long = 10000,
        interval: Long = 500,
        callback: ((Boolean) -> Unit)? = null
    ) {
        serviceScope.launch {
            val startTime = System.currentTimeMillis()
            
            while (System.currentTimeMillis() - startTime < timeout) {
                // 在主线程执行 condition 检查
                var result = false
                val latch = CountDownLatch(1)
                mainHandler.post {
                    result = condition()
                    latch.countDown()
                }
                latch.await()
                
                if (result) {
                    mainHandler.post {
                        callback?.invoke(true)
                    }
                    return@launch
                }
                delay(interval)
            }
            
            mainHandler.post {
                callback?.invoke(false)
            }
        }
    }
    
    fun waitForElement(
        text: String,
        timeout: Long = 10000,
        callback: ((AccessibilityNodeInfo?) -> Unit)? = null
    ) {
        // findNodeByText 已经会在主线程执行，这里直接调用
        waitForCondition(
            condition = { findNodeByText(text, clickable = false) != null },
            timeout = timeout,
            callback = { found ->
                callback?.invoke(null)
            }
        )
    }
    
    // ==================== 截屏功能 ====================
    
    /**
     * 截取屏幕截图（Base64编码）
     * 使用 screencap 命令实现
     */
    fun takeScreenshotBase64(): String? {
        return try {
            val timestamp = System.currentTimeMillis()
            val filePath = "/sdcard/zbb_screenshot_$timestamp.png"
            
            val process = Runtime.getRuntime().exec("screencap -p $filePath")
            val exitCode = process.waitFor()
            
            if (exitCode == 0 && File(filePath).exists()) {
                val file = File(filePath)
                val bytes = file.readBytes()
                file.delete()
                Base64.encodeToString(bytes, Base64.NO_WRAP)
            } else {
                Log.e(TAG, "screencap 命令执行失败")
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "截屏失败: ${e.message}")
            null
        }
    }

    /**
     * 截取当前屏幕
     * 优先使用 screencap 命令（截取整个屏幕，最可靠）
     * 备选使用 ScreenshotService MediaProjection
     * V32.36.7: OCR 已删, captureScreenshot 仅用于 screenshot 调试, 不再调 OCR
     */
    fun captureScreenshot(): Bitmap? {
        Log.d(TAG, ">>> captureScreenshot() 开始")

        // 方法1：优先使用 screencap 命令（最可靠，截取整个屏幕）
        val screencapBitmap = captureByScreencap()
        if (screencapBitmap != null) {
            Log.d(TAG, ">>> screencap 截图成功: ${screencapBitmap.width}x${screencapBitmap.height}")
            return screencapBitmap
        }
        
        // 方法2：备选使用 ScreenshotService MediaProjection
        if (!checkProjectionStatus()) {
            Log.e(TAG, ">>> ScreenshotService MediaProjection 未就绪")
            return null
        }
        
        val service = ScreenshotService.instance
        if (service == null) {
            Log.e(TAG, ">>> ScreenshotService 未运行")
            return null
        }
        
        // 在后台线程执行截图
        var resultBitmap: Bitmap? = null
        val latch = CountDownLatch(1)
        
        Thread {
            try {
                resultBitmap = service.captureScreenshot(0, 0, 3000) // 使用全屏尺寸，3秒超时
                
                resultBitmap?.let { bitmap ->
                    Log.d(TAG, ">>> 屏幕截图成功: ${bitmap.width}x${bitmap.height}")
                    // 保存截图
                    service.saveScreenshot(bitmap, "zbb_screenshot")
                }
            } catch (e: Exception) {
                Log.e(TAG, ">>> 截图失败: ${e.message}")
                e.printStackTrace()
            } finally {
                latch.countDown()
            }
        }.start()
        
        // 等待截图完成，最多等待 5 秒
        try {
            latch.await(5, TimeUnit.SECONDS)
        } catch (e: InterruptedException) {
            Log.e(TAG, ">>> 等待被中断")
        }
        
        return resultBitmap
    }
    
    /**
     * 使用 screencap 命令截取屏幕（最可靠的方式）
     */
    private fun captureByScreencap(): Bitmap? {
        return try {
            val timestamp = System.currentTimeMillis()
            val filePath = "/sdcard/zbb_screen_${timestamp}.png"
            
            val process = Runtime.getRuntime().exec("screencap -p $filePath")
            val exitCode = process.waitFor()
            
            if (exitCode == 0 && File(filePath).exists()) {
                val bitmap = BitmapFactory.decodeFile(filePath)
                File(filePath).delete() // 删除临时文件
                
                if (bitmap != null) {
                    Log.d(TAG, ">>> screencap 截取成功: ${bitmap.width}x${bitmap.height}")
                    // 同时保存截图
                    saveScreenshotToFile(bitmap, "zbb_screenshot")
                }
                
                bitmap
            } else {
                Log.e(TAG, ">>> screencap 失败，exitCode=$exitCode")
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, ">>> screencap 异常: ${e.message}")
            null
        }
    }
    
    /**
     * 清理 ImageReader 资源 - 现在由 ScreenshotService 管理
     */
    private fun cleanupImageReader() {
        // ScreenshotService 会自动管理 ImageReader
        Log.d(TAG, ">>> cleanupImageReader: 由 ScreenshotService 管理")
    }
    
    /**
     * 保存截图到文件（用于调试）
     */
    private fun saveScreenshotToFile(bitmap: Bitmap, prefix: String) {
        try {
            val timestamp = System.currentTimeMillis()
            val filename = "${prefix}_${timestamp}.png"
            val file = File(filesDir, filename)
            
            FileOutputStream(file).use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }
            
            Log.d(TAG, ">>> 截图已保存到: ${file.absolutePath}")
            
            // 同时复制到 Download 目录便于查看
            try {
                val downloadDir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DOWNLOADS
                )
                val downloadFile = File(downloadDir, filename)
                FileOutputStream(downloadFile).use { out ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                }
                Log.d(TAG, ">>> 截图已复制到 Download: ${downloadFile.absolutePath}")
            } catch (e: Exception) {
                Log.w(TAG, ">>> 复制到 Download 失败: ${e.message}")
            }
            
        } catch (e: Exception) {
            Log.e(TAG, ">>> 保存截图失败: ${e.message}")
        }
    }
    
    private fun collectTextRecursive(node: AccessibilityNodeInfo, texts: MutableList<String>) {
        // 获取节点文字
        node.text?.toString()?.let { text ->
            if (text.isNotBlank() && text.length <= 100) {
                texts.add(text)
            }
        }
        
        // 获取ContentDescription
        node.contentDescription?.toString()?.let { desc ->
            if (desc.isNotBlank() && desc.length <= 100 && !texts.contains(desc)) {
                texts.add(desc)
            }
        }
        
        // 递归子节点
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try {
                collectTextRecursive(child, texts)
            } catch (e: Exception) {
                // 忽略子节点错误
            } finally {
                child.recycle()
            }
        }
    }

    /**
     * 获取当前界面上所有文字节点及其坐标
     * 返回格式：[{text: "文字", centerX: 100, centerY: 200}, ...]
     */
    fun getAllTextNodes(): List<Map<String, Any>> {
        val result = mutableListOf<Map<String, Any>>()
        val rootNode = rootInActiveWindow ?: return result

        try {
            collectTextNodesRecursive(rootNode, result, mutableSetOf())
        } catch (e: Exception) {
            Log.e(TAG, "获取文字节点失败: ${e.message}")
        } finally {
            rootNode.recycle()
        }

        Log.d(TAG, "getAllTextNodes 返回 ${result.size} 个节点")
        return result
    }

    private fun collectTextNodesRecursive(
        node: AccessibilityNodeInfo,
        result: MutableList<Map<String, Any>>,
        visited: MutableSet<Int>
    ) {
        // 防止重复访问
        if (node.hashCode() in visited) return
        visited.add(node.hashCode())

        // 获取节点文字
        val text = node.text?.toString()
        val contentDesc = node.contentDescription?.toString()
        val className = node.className?.toString() ?: ""

        // 获取坐标
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)
        val centerX = bounds.centerX().toDouble()
        val centerY = bounds.centerY().toDouble()

        // 🆕 2026-07-11: EditText/Button/CheckBox 节点即使 text 为空也返回（webview 内部 input 拿不到 text 但能拿 className）
        // 用 className 标识节点类型，方便 TS 端按 type 过滤
        val isInteractive = className.endsWith("EditText") || className.endsWith("Button")
                || className.endsWith("CheckBox") || className.endsWith("RadioButton")
                || className.endsWith("Switch")
        if (isInteractive) {
            val typeTag = when {
                className.endsWith("EditText") -> "editText"
                className.endsWith("CheckBox") -> "checkBox"
                className.endsWith("Button") -> "button"
                className.endsWith("RadioButton") -> "radio"
                className.endsWith("Switch") -> "switch"
                else -> "interactive"
            }
            result.add(mapOf(
                "text" to (text ?: ""),
                "centerX" to centerX,
                "centerY" to centerY,
                "type" to typeTag,
                "className" to className,
                "clickable" to node.isClickable
            ))
        }

        // 添加 text
        if (!text.isNullOrBlank() && text.length <= 100) {
            result.add(mapOf(
                "text" to text,
                "centerX" to centerX,
                "centerY" to centerY,
                "type" to "text"
            ))
        }

        // 添加 contentDescription (🆕 08-24 实测: 千机端 80% 节点 text="", 必须保留 contentDesc 原始字段)
        if (!contentDesc.isNullOrBlank() && contentDesc.length <= 100 && contentDesc != text) {
            result.add(mapOf(
                "text" to contentDesc,
                "contentDesc" to contentDesc,  // 🆕 实测: 独立字段给 PageIdentifier 用
                "centerX" to centerX,
                "centerY" to centerY,
                "type" to "desc"
            ))
        }

        // 递归子节点
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try {
                collectTextNodesRecursive(child, result, visited)
            } catch (e: Exception) {
                // 忽略子节点错误
            } finally {
                child.recycle()
        }
    }

    /**
     * 等待屏幕上出现指定文字 (A11y 版本, V32.36.7 OCR 已删)
     * @param targetText 要等待的文字
     * @param timeout 超时时间（毫秒）
     * @return true表示找到，false表示超时
     */
    fun waitForScreenText(targetText: String, timeout: Long = 10000): Boolean {
        val startTime = System.currentTimeMillis()

        while (System.currentTimeMillis() - startTime < timeout) {
            // V32.36.7: 用 getAllTextNodes (返回 List<Map<String, Any>>) 替代 OCR
            val nodes = getAllTextNodes()
            val found = nodes.any { node ->
                val text = node["text"]?.toString() ?: ""
                val desc = node["contentDesc"]?.toString() ?: ""
                text.contains(targetText, ignoreCase = true) ||
                desc.contains(targetText, ignoreCase = true)
            }
            if (found) {
                Log.d(TAG, "找到目标文字: $targetText")
                return true
            }
            Thread.sleep(500)
        }

        Log.w(TAG, "等待文字超时: $targetText")
        return false
    }

    // ==================== 屏幕尺寸 ====================
    
    /**
     * 获取屏幕尺寸
     * @return Pair(width, height) 或 null
     */
    fun getScreenSize(): Pair<Int, Int>? {
        return try {
            val displayMetrics = resources.displayMetrics
            Pair(displayMetrics.widthPixels, displayMetrics.heightPixels)
        } catch (e: Exception) {
            Log.e(TAG, "获取屏幕尺寸失败: ${e.message}")
            null
        }
    }
    
    // ==================== Shell截图命令 ====================
    
    /**
     * 使用 screencap 命令截图并保存到指定路径
     * @param filePath 保存路径（如 /storage/emulated/0/Pictures/Screenshots/screenshot.png）
     * @param callback 结果回调
     */
    @SuppressLint("MissingPermission")
    fun screencapShell(filePath: String, callback: ((Boolean, String?) -> Unit)? = null) {
        Thread {
            try {
                Log.i(TAG, "[截图] 开始截图: $filePath")
                
                // 先创建目录
                val dir = filePath.substringBeforeLast("/")
                Log.i(TAG, "[截图] 创建目录: $dir")
                val mkdirResult = Runtime.getRuntime().exec(arrayOf("sh", "-c", "mkdir -p $dir"))
                val mkdirExit = mkdirResult.waitFor()
                Log.i(TAG, "[截图] mkdir exitCode: $mkdirExit")
                
                // 执行截图
                Log.i(TAG, "[截图] 执行命令: screencap $filePath")
                val process = Runtime.getRuntime().exec(arrayOf("sh", "-c", "screencap $filePath"))
                val exitCode = process.waitFor()
                
                // 读取输出和错误
                val errorOut = process.errorStream.bufferedReader().readText()
                val stdOut = process.inputStream.bufferedReader().readText()
                Log.i(TAG, "[截图] exitCode: $exitCode, error: '$errorOut', output: '$stdOut'")
                
                // 检查文件是否存在
                val file = java.io.File(filePath)
                Log.i(TAG, "[截图] 文件存在: ${file.exists()}, 大小: ${if(file.exists()) file.length() else 0}")
                
                mainHandler.post {
                    if (exitCode == 0 && file.exists()) {
                        Log.i(TAG, "[截图] 成功: $filePath")
                        callback?.invoke(true, filePath)
                    } else {
                        val errorMsg = "截图失败，exitCode=$exitCode"
                        Log.e(TAG, "[截图] $errorMsg")
                        callback?.invoke(false, errorMsg)
                    }
                }
            } catch (e: Exception) {
                val errorMsg = "截图异常: ${e.message}"
                Log.e(TAG, "[截图] $errorMsg")
                mainHandler.post {
                    callback?.invoke(false, errorMsg)
                }
            }
        }.start()
    }
    
    /**
     * 使用 MediaStore API 截图
     * 绕过小程序 WebView 的受保护限制
     */
    @SuppressLint("MissingPermission")
    fun screenshotViaMediaStore(callback: ((Boolean, String?) -> Unit)? = null) {
        Thread {
            try {
                Log.i(TAG, "[截图] 使用 MediaStore API 截图")
                
                // 获取 Context
                val context: android.content.Context = applicationContext
                val resolver = context.contentResolver
                val filename = "zbb_${System.currentTimeMillis()}.png"
                
                // 使用 MediaStore 创建图片
                val imageValues = ContentValues()
                imageValues.put(MediaStore.Images.Media.DISPLAY_NAME, filename)
                imageValues.put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                imageValues.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ZBB")
                
                val imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, imageValues)
                if (imageUri == null) {
                    throw Exception("无法创建 MediaStore 条目")
                }
                
                Log.i(TAG, "[截图] MediaStore URI: $imageUri")
                
                // 使用 screencap 获取图片数据
                val process = Runtime.getRuntime().exec(arrayOf("screencap", "-p", "/sdcard/Pictures/ZBB/$filename"))
                val exitCode = process.waitFor()
                
                Log.i(TAG, "[截图] screencap exitCode: $exitCode")
                
                if (exitCode == 0) {
                    Log.i(TAG, "[截图] MediaStore 截图成功: $filename")
                    mainHandler.post {
                        callback?.invoke(true, filename)
                    }
                } else {
                    throw Exception("screencap 失败，exitCode: $exitCode")
                }
                
            } catch (e: Exception) {
                val errorMsg = "MediaStore 截图失败: ${e.message}"
                Log.e(TAG, "[截图] $errorMsg")
                mainHandler.post {
                    callback?.invoke(false, errorMsg)
                }
            }
        }.start()
    }
    
    /**
     * 使用帧缓冲区截图（绕过 WebView 保护）
     */
    @SuppressLint("MissingPermission")
    fun screenshotViaFramebuffer(callback: ((Boolean, String?) -> Unit)? = null) {
        Thread {
            try {
                Log.i(TAG, "[截图] 尝试使用帧缓冲区截图")
                
                // 尝试读取帧缓冲区
                val fbFile = File("/dev/graphics/fb0")
                if (!fbFile.exists()) {
                    Log.e(TAG, "[截图] 帧缓冲区不存在")
                    throw Exception("帧缓冲区不存在")
                }
                
                // 获取屏幕分辨率
                val display = (applicationContext.getSystemService(android.content.Context.WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay
                val width = display.width
                val height = display.height
                // RGBA_8888 格式，每像素 4 字节
                val bytesPerPixel = 4
                val bufferSize = width * height * bytesPerPixel
                
                Log.i(TAG, "[截图] 屏幕分辨率: ${width}x${height}, 缓冲区大小: $bufferSize")
                
                // 读取帧缓冲区
                val buffer: ByteArray = FileInputStream(fbFile).use { fis: FileInputStream ->
                    val bytes = ByteArray(bufferSize)
                    val readCount: Int = fis.read(bytes)
                    Log.i(TAG, "[截图] 读取了 $readCount 字节")
                    bytes
                }
                
                // 转换为 Bitmap
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(buffer))
                
                // 保存到文件
                val filename = "zbb_${System.currentTimeMillis()}.png"
                val dir = File("/sdcard/Pictures/ZBB")
                if (!dir.exists()) {
                    dir.mkdirs()
                }
                val file = File(dir, filename)
                FileOutputStream(file).use { fos ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, fos)
                }
                
                Log.i(TAG, "[截图] 帧缓冲区截图成功: ${file.absolutePath}")
                mainHandler.post {
                    callback?.invoke(true, file.absolutePath)
                }
                
            } catch (e: Exception) {
                val errorMsg = "帧缓冲区截图失败: ${e.message}"
                Log.e(TAG, "[截图] $errorMsg")
                e.printStackTrace()
                mainHandler.post {
                    callback?.invoke(false, errorMsg)
                }
            }
        }.start()
    }
    
    /**
     * 使用 screencap 命令截图并保存到文件（绕过 WebView 保护）
     */
    @SuppressLint("MissingPermission")
    fun screencapShellBase64(filePath: String, callback: ((Boolean, String?) -> Unit)? = null) {
        Thread {
            try {
                Log.i(TAG, "[截图] screencapShellBase64 开始: $filePath")

                // 确保目录存在
                val dir = filePath.substringBeforeLast("/")
                Log.i(TAG, "[截图] 创建目录: $dir")
                val mkdirResult = Runtime.getRuntime().exec(arrayOf("sh", "-c", "mkdir -p $dir"))
                val mkdirExit = mkdirResult.waitFor()
                Log.i(TAG, "[截图] mkdir exitCode: $mkdirExit")

                // 执行截图命令
                val cmd = "screencap -p $filePath"
                Log.i(TAG, "[截图] 执行命令: $cmd")
                val process = Runtime.getRuntime().exec(arrayOf("sh", "-c", cmd))
                val exitCode = process.waitFor()

                // 读取输出和错误
                val errorOut = process.errorStream.bufferedReader().readText()
                val stdOut = process.inputStream.bufferedReader().readText()
                Log.i(TAG, "[截图] exitCode: $exitCode, error: '$errorOut', output: '$stdOut'")

                // 检查文件是否存在
                val file = java.io.File(filePath)
                Log.i(TAG, "[截图] 文件存在: ${file.exists()}, 大小: ${if(file.exists()) file.length() else 0}")

                mainHandler.post {
                    if (exitCode == 0 && file.exists()) {
                        Log.i(TAG, "[截图] 成功: $filePath")
                        callback?.invoke(true, filePath)
                    } else {
                        val errorMsg = "截图失败，exitCode=$exitCode"
                        Log.e(TAG, "[截图] $errorMsg")
                        callback?.invoke(false, errorMsg)
                    }
                }
            } catch (e: Exception) {
                val errorMsg = "截图异常: ${e.message}"
                Log.e(TAG, "[截图] $errorMsg")
                mainHandler.post {
                    callback?.invoke(false, errorMsg)
                }
            }
        }.start()
    }

    /**
     * 物理按键监听 - 任意按键（电源/音量+/-）按下时自动停止震动
     */
    override fun onKeyEvent(event: android.view.KeyEvent?): Boolean {
        event ?: return super.onKeyEvent(event)
        
        // 检测到按键且正在震动
        if (isVibrating) {
            when (event.keyCode) {
                android.view.KeyEvent.KEYCODE_POWER,
                android.view.KeyEvent.KEYCODE_VOLUME_UP,
                android.view.KeyEvent.KEYCODE_VOLUME_DOWN -> {
                    Log.i(TAG, "检测到物理按键(${event.keyCode})，自动停止震动")
                    stopVibration()
                }
            }
        }

        return super.onKeyEvent(event)
    }
}
