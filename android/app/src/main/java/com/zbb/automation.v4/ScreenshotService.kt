package com.zbb.automation.v4

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Binder
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * ZBB 截图前台服务（全局单例）
 * 
 * 核心设计：
 * 1. start() 后前台Service常驻，悬浮窗显示小圆点
 * 2. 首次调用自动请求 MediaProjection 授权
 * 3. VirtualDisplay 持久化，截图时直接从 ImageReader 取帧
 * 4. 截图闪一下效果，写入相册 MediaStore
 * 5. 权限丢失自动重新授权
 */
class ScreenshotService : Service() {

    companion object {
        private const val TAG = "ScreenshotService"
        private const val CHANNEL_ID = "ZBB_Screenshot_Channel"
        private const val NOTIFICATION_ID = 10002
        const val PROJECTION_REQUEST_CODE = 10086

        // 悬浮窗 GO 按钮拖动位置持久化
        private const val PREFS_NAME = "zbb_floating_prefs"
        private const val KEY_FLOATING_X = "floating_dot_x"
        private const val KEY_FLOATING_Y = "floating_dot_y"
        private const val DEFAULT_FLOATING_X_DP = 16f
        private const val DEFAULT_FLOATING_Y_DP = 95f

        const val ACTION_INIT_PROJECTION = "com.zbb.automation.INIT_PROJECTION"
        const val ACTION_STOP_SERVICE = "com.zbb.automation.STOP_SERVICE"
        
        // 回调
        var onProjectionReady: (() -> Unit)? = null
        var onProjectionError: ((String) -> Unit)? = null
        var onScreenshotTaken: ((String) -> Unit)? = null  // path
        
        @Volatile
        var instance: ScreenshotService? = null
            private set
        
        @Volatile
        var isStarted: Boolean = false
            private set

        fun startService(context: Context) {
            try {
                val intent = Intent(context, ScreenshotService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                Log.d(TAG, "startService: 命令已发送")
            } catch (e: Exception) {
                Log.e(TAG, "startService 失败: ${e.message}")
            }
        }

        fun stopService(context: Context) {
            try {
                val intent = Intent(context, ScreenshotService::class.java)
                intent.action = ACTION_STOP_SERVICE
                context.startService(intent)
            } catch (e: Exception) {
                Log.e(TAG, "stopService 失败: ${e.message}")
            }
        }

        fun isRunning(): Boolean = instance != null && isStarted
        
        fun isProjectionReady(): Boolean = instance?.isProjectionReady() == true
    }

    // ==================== 核心属性 ====================
    
    private val binder = ScreenshotBinder()
    
    inner class ScreenshotBinder : Binder() {
        fun getService(): ScreenshotService = this@ScreenshotService
    }
    
    // 兼容 AccessibilityServiceImpl 调用的旧方法
    fun captureScreenshot(width: Int = 0, height: Int = 0, timeoutMs: Long = 3000): Bitmap? {
        val bitmap = captureFrame() ?: return null
        return bitmap
    }
    
    fun saveScreenshot(bitmap: Bitmap, prefix: String): String? {
        return saveToGallery(bitmap)
    }
    
    // MediaProjection
    private var mediaProjection: MediaProjection? = null
    private var imageReader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var projectionResultCode: Int = Activity.RESULT_CANCELED
    private var projectionResultData: Intent? = null
    
    // 屏幕尺寸
    private var screenWidth: Int = 1080
    private var screenHeight: Int = 2400
    
    // 并发控制
    private val isCapturing = AtomicBoolean(false)
    private val mainHandler = Handler(Looper.getMainLooper())
    
    // 悬浮窗
    private var floatingView: View? = null
    private var floatingParams: WindowManager.LayoutParams? = null  // 提升为字段：拖动时动态更新 x/y
    private var windowManager: WindowManager? = null

    // GO 按钮拖动状态（GestureDetector 内部管 scaledTouchSlop + 滚动判定）
    private var touchStartX: Float = 0f
    private var touchStartY: Float = 0f
    private var startViewX: Int = 0
    private var startViewY: Int = 0
    private var didScroll: Boolean = false  // ACTION_UP 时是否拖动过（触发保存位置）

    // 截图闪光
    private var flashView: View? = null

    /**
     * 读取悬浮窗上次保存的位置（首次启动用默认值 16dp / 95dp）
     */
    private fun loadFloatingPosition(): Pair<Int, Int> {
        return try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val x = prefs.getInt(KEY_FLOATING_X, dp(DEFAULT_FLOATING_X_DP))
            val y = prefs.getInt(KEY_FLOATING_Y, dp(DEFAULT_FLOATING_Y_DP))
            Pair(x, y)
        } catch (e: Exception) {
            Log.w(TAG, "读取悬浮窗位置失败: ${e.message}")
            Pair(dp(DEFAULT_FLOATING_X_DP), dp(DEFAULT_FLOATING_Y_DP))
        }
    }

    /**
     * 拖动结束后保存悬浮窗新位置
     */
    private fun saveFloatingPosition(x: Int, y: Int) {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putInt(KEY_FLOATING_X, x).putInt(KEY_FLOATING_Y, y).apply()
            Log.d(TAG, "悬浮窗位置已保存: x=$x, y=$y")
        } catch (e: Exception) {
            Log.w(TAG, "保存悬浮窗位置失败: ${e.message}")
        }
    }
    
    // 是否正在等待授权
    private var isAwaitingPermission = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        isStarted = false
        Log.d(TAG, "onCreate")
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification())
        createFloatingDot()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand, action: ${intent?.action}")
        
        when (intent?.action) {
            ACTION_INIT_PROJECTION -> {
                val resultCode = intent.getIntExtra("resultCode", Activity.RESULT_CANCELED)
                val resultData = intent.getParcelableExtra<Intent>("resultData")
                if (resultCode == Activity.RESULT_OK && resultData != null) {
                    initMediaProjection(resultCode, resultData)
                } else {
                    Log.e(TAG, "授权失败: resultCode=$resultCode")
                    onProjectionError?.invoke("授权失败或用户取消")
                    isAwaitingPermission = false
                }
            }
            ACTION_STOP_SERVICE -> {
                cleanup()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = binder

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "onDestroy")
        cleanup()
        removeFloatingDot()
        instance = null
        isStarted = false
    }
    
    // ==================== 公共 API ====================
    
    /**
     * 启动截图服务（全局单例，重复调用无害）
     * 内部逻辑：
     * 1. 如果未授权，自动请求 MediaProjection 权限
     * 2. 授权后初始化 VirtualDisplay + ImageReader
     * 3. 显示悬浮窗小圆点
     */
    fun start() {
        if (!isStarted) {
            isStarted = true
            Log.d(TAG, "start: 已标记为已启动")
        }
        if (isProjectionReady()) {
            Log.d(TAG, "start: MediaProjection 已就绪")
            return
        }
        if (isAwaitingPermission) {
            Log.d(TAG, "start: 正在等待授权...")
            return
        }
        // 检查是否已有授权数据
        if (projectionResultCode == Activity.RESULT_OK && projectionResultData != null) {
            initMediaProjection(projectionResultCode, projectionResultData!!)
        } else {
            requestMediaProjectionPermission()
        }
    }
    
    /**
     * 执行截图，保存到相册，返回路径
     */
    fun takeScreenshot(): String? {
        if (!isProjectionReady()) {
            Log.e(TAG, "takeScreenshot: MediaProjection 未就绪")
            return null
        }
        
        if (!isCapturing.compareAndSet(false, true)) {
            Log.w(TAG, "takeScreenshot: 截图正在进行中")
            return null
        }
        
        try {
            val bitmap = captureFrame()
            if (bitmap == null) {
                Log.e(TAG, "takeScreenshot: captureFrame 返回 null")
                isCapturing.set(false)
                return null
            }
            
            // 截图闪光效果
            showFlashEffect()
            
            // 保存到相册
            val path = saveToGallery(bitmap)
            if (path != null) {
                onScreenshotTaken?.invoke(path)
            }
            
            bitmap.recycle()
            return path
        } finally {
            isCapturing.set(false)
        }
    }
    
    /**
     * 截图返回 base64（内存传递）
     */
    fun takeScreenshotAsBase64(): String? {
        if (!isProjectionReady()) {
            Log.e(TAG, "takeScreenshotAsBase64: MediaProjection 未就绪")
            return null
        }
        
        if (!isCapturing.compareAndSet(false, true)) {
            Log.w(TAG, "takeScreenshotAsBase64: 截图正在进行中")
            return null
        }
        
        try {
            val bitmap = captureFrame()
            if (bitmap == null) {
                isCapturing.set(false)
                return null
            }
            
            showFlashEffect()
            
            val stream = java.io.ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, stream)
            bitmap.recycle()
            return android.util.Base64.encodeToString(stream.toByteArray(), android.util.Base64.NO_WRAP)
        } finally {
            isCapturing.set(false)
        }
    }
    
    fun isProjectionReady(): Boolean = mediaProjection != null

    // ==================== 授权 ====================
    
    private fun requestMediaProjectionPermission() {
        Log.d(TAG, "requestMediaProjectionPermission: 请求权限")
        
        isAwaitingPermission = true
        
        try {
            // 从 companion object 获取 MainActivity.instance
            val companionClass = MainActivity::class.java.getDeclaredClasses().find { it.simpleName == "Companion" }
            val instanceField = (companionClass ?: MainActivity::class.java).getDeclaredField("instance")
            instanceField.isAccessible = true
            val activity = instanceField.get(null) as? Activity
            if (activity != null) {
                val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
                if (projectionManager != null) {
                    activity.startActivityForResult(
                        projectionManager.createScreenCaptureIntent(),
                        PROJECTION_REQUEST_CODE
                    )
                    Log.d(TAG, "requestMediaProjectionPermission: 已启动授权Activity")
                    return
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "requestMediaProjectionPermission 失败: ${e.message}")
        }
        
        // Fallback: 通过 Service 启动 MainActivity
        isAwaitingPermission = true
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("action", "requestProjection")
        }
        startActivity(intent)
    }
    
    /**
     * 初始化 MediaProjection（持久化）
     */
    fun initMediaProjection(resultCode: Int, data: Intent) {
        try {
            Log.d(TAG, "initMediaProjection: resultCode=$resultCode")
            isAwaitingPermission = false
            
            projectionResultCode = resultCode
            projectionResultData = data
            
            val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
            if (projectionManager == null) {
                onProjectionError?.invoke("无法获取 MediaProjectionManager")
                return
            }
            
            mediaProjection = projectionManager.getMediaProjection(resultCode, data)
            
            if (mediaProjection != null) {
                // 获取屏幕尺寸
                val wm = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
                val display = wm?.defaultDisplay
                val size = Point()
                @Suppress("DEPRECATION")
                display?.getRealSize(size)
                screenWidth = size.x
                screenHeight = size.y
                Log.d(TAG, "屏幕尺寸: ${screenWidth}x$screenHeight")
                
                // 注册权限丢失回调
                mediaProjection?.registerCallback(object : MediaProjection.Callback() {
                    override fun onStop() {
                        Log.w(TAG, "MediaProjection 被系统停止（权限丢失）")
                        mediaProjection = null
                        mainHandler.post {
                            requestMediaProjectionPermission()
                        }
                    }
                }, mainHandler)
                
                // 初始化持久化的 ImageReader
                initPersistentImageReader()
                
                Log.d(TAG, "initMediaProjection: 成功")
                onProjectionReady?.invoke()
            } else {
                Log.e(TAG, "initMediaProjection: 创建失败")
                onProjectionError?.invoke("MediaProjection 创建失败")
            }
        } catch (e: Exception) {
            Log.e(TAG, "initMediaProjection 异常: ${e.message}")
            onProjectionError?.invoke(e.message ?: "未知错误")
        }
    }
    
    // ==================== ImageReader 持久化 ====================
    
    private fun initPersistentImageReader() {
        try {
            cleanupImageReader()
            
            imageReader = ImageReader.newInstance(
                screenWidth, screenHeight,
                PixelFormat.RGBA_8888, 3
            )
            
            val densityDpi = resources.displayMetrics.densityDpi
            
            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "ZBBScreenCapture",
                screenWidth, screenHeight,
                densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader!!.surface,
                null,
                mainHandler
            )
            
            Log.d(TAG, "initPersistentImageReader: ImageReader+VirtualDisplay 创建成功")
        } catch (e: Exception) {
            Log.e(TAG, "initPersistentImageReader 失败: ${e.message}")
        }
    }
    
    // ==================== 截图 ====================
    
    private fun captureFrame(): Bitmap? {
        val reader = imageReader ?: return null
        
        val latch = CountDownLatch(1)
        var resultBitmap: Bitmap? = null
        var imageProcessed = false
        
        val listener = android.media.ImageReader.OnImageAvailableListener { imgReader ->
            if (imageProcessed) return@OnImageAvailableListener
            val image = imgReader.acquireLatestImage()
            if (image != null) {
                try {
                    resultBitmap = processImage(image)
                    imageProcessed = true
                    latch.countDown()
                } catch (e: Exception) {
                    Log.e(TAG, "captureFrame.processImage 异常: ${e.message}")
                } finally {
                    image.close()
                }
            }
        }
        
        reader.setOnImageAvailableListener(listener, mainHandler)
        
        try {
            val received = latch.await(3000, TimeUnit.MILLISECONDS)
            if (!received) {
                Log.e(TAG, "captureFrame: 等待图像超时")
            }
        } catch (e: InterruptedException) {
            Log.e(TAG, "captureFrame: 等待被中断")
        }
        
        return resultBitmap
    }
    
    private fun processImage(image: Image): Bitmap? {
        val planes = image.planes
        val buffer = planes[0].buffer
        val rowStride = planes[0].rowStride
        
        val bitmap = Bitmap.createBitmap(
            screenWidth,
            screenHeight,
            Bitmap.Config.ARGB_8888
        )
        bitmap.copyPixelsFromBuffer(buffer)
        
        return bitmap
    }
    
    // ==================== 保存到相册 ====================
    
    private fun saveToGallery(bitmap: Bitmap): String? {
        val timestamp = System.currentTimeMillis()
        val filename = "ZBB_${timestamp}.jpg"
        
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val contentValues = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, filename)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ZBB")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                
                val uri = contentResolver.insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    contentValues
                )
                
                if (uri != null) {
                    contentResolver.openOutputStream(uri)?.use { out ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
                    }
                    
                    contentValues.clear()
                    contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
                    contentResolver.update(uri, contentValues, null, null)
                    
                    Log.d(TAG, "saveToGallery: 成功 -> $uri")
                    return uri.toString()
                }
            } else {
                val picturesDir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_PICTURES
                )
                val zbbDir = File(picturesDir, "ZBB")
                if (!zbbDir.exists()) zbbDir.mkdirs()
                
                val file = File(zbbDir, filename)
                FileOutputStream(file).use { out ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
                }
                
                val mediaScanIntent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE)
                mediaScanIntent.data = android.net.Uri.fromFile(file)
                sendBroadcast(mediaScanIntent)
                
                Log.d(TAG, "saveToGallery: 成功 -> ${file.absolutePath}")
                return file.absolutePath
            }
            null
        } catch (e: Exception) {
            Log.e(TAG, "saveToGallery 失败: ${e.message}")
            null
        }
    }
    
    // ==================== 悬浮窗小圆点 ====================
    
    private fun createFloatingDot() {
        try {
            windowManager = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            // 从 SharedPreferences 恢复上次位置（首次启动用默认值 16dp / 95dp）
            val (savedX, savedY) = loadFloatingPosition()

            // 屏幕尺寸 + 边界限制（拖动范围只能在屏幕内）
            val displayMetrics = Resources.getSystem().displayMetrics
            val screenW = displayMetrics.widthPixels
            val screenH = displayMetrics.heightPixels
            val viewSizePx = dp(32f)  // 悬浮窗 32dp
            val xMin = 0
            val xMax = screenW - viewSizePx
            val yMin = 0
            val yMax = screenH - viewSizePx

            // WindowManager.LayoutParams（提升为字段以便拖动时动态更新）
            floatingParams = WindowManager.LayoutParams().apply {
                type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                } else {
                    @Suppress("DEPRECATION")
                    WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
                }
                flags = (
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                )
                width = dp(32f)
                height = dp(32f)
                gravity = Gravity.TOP or Gravity.END
                x = savedX.coerceIn(xMin, xMax)
                y = savedY.coerceIn(yMin, yMax)
            }

            // 圆点背景（圆形红底，初始为"待确认"状态）
            var isRed: Boolean = true  // 初始红色，点击后翻转 红↔蓝
            floatingView = FrameLayout(this).apply {
                setBackgroundResource(R.drawable.screenshot_button_red)
                alpha = 0.9f
                val padding = dp(10f)
                setPadding(padding, padding, padding, padding)

                // 添加文字"GO"
                val label = TextView(context).apply {
                    text = "GO"
                    setTextColor(Color.WHITE)
                    textSize = 11f
                    gravity = android.view.Gravity.CENTER
                }
                (this as FrameLayout).addView(label)

                // 短按点击：触发流程继续（onSingleTapUp 触发，不再走 setOnClickListener）
                // 原 setOnClickListener 在 ACTION_DOWN 被 onTouchListener 拦截后，view.onTouchEvent
                // 不会 setPressed(true)，ACTION_UP performClick 条件不满足 → click 永远不触发。
                // 改用 GestureDetector：onSingleTapUp 不依赖 setPressed 状态，治本。
                val onTapAction: () -> Unit = {
                    Log.d(TAG, "悬浮圆点被点击")
                    // 通知 JS 继续流程（复用 onScreenshotConfirmed 事件）
                    try {
                        val module = AutomationModuleManager.getModule()
                        module?.sendEventToJS("onScreenshotConfirmed", null)
                    } catch (e: Exception) {
                        Log.e(TAG, "发送 onScreenshotConfirmed 失败: ${e.message}")
                    }
                    // 点击后颜色翻转：红 ↔ 蓝
                    isRed = !isRed
                    setBackgroundResource(
                        if (isRed) R.drawable.screenshot_button_red
                        else R.drawable.screenshot_button_blue
                    )
                }

                // 用 GestureDetector 区分点击 vs 拖动（系统标准实现，比手动维护 isDragging/touchSlop 健壮）
                // 拖动结束后位置持久化到 SharedPreferences，拖动范围 clamp 到屏幕内
                val gestureDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
                    override fun onDown(e: MotionEvent): Boolean = true  // 必须返回 true 才能接收后续事件

                    override fun onSingleTapUp(e: MotionEvent): Boolean {
                        onTapAction()
                        return true
                    }

                    override fun onScroll(
                        e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float
                    ): Boolean {
                        // GestureDetector 内部已判断超过 scaledTouchSlop 才会触发 onScroll
                        // distanceX/Y 是"上次到这次"的增量，但我们要算"起点到当前"的绝对偏移
                        val dx = e2.rawX - touchStartX
                        val dy = e2.rawY - touchStartY
                        didScroll = true
                        floatingParams?.let { params ->
                            params.x = (startViewX + dx.toInt()).coerceIn(xMin, xMax)
                            params.y = (startViewY + dy.toInt()).coerceIn(yMin, yMax)
                            try {
                                windowManager?.updateViewLayout(floatingView, params)
                            } catch (e: Exception) {
                                Log.e(TAG, "更新悬浮窗位置失败: ${e.message}")
                            }
                        }
                        return true
                    }
                })

                setOnTouchListener { _, event ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> {
                            touchStartX = event.rawX
                            touchStartY = event.rawY
                            startViewX = floatingParams?.x ?: 0
                            startViewY = floatingParams?.y ?: 0
                            didScroll = false
                        }
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                            if (didScroll) {
                                floatingParams?.let { saveFloatingPosition(it.x, it.y) }
                                didScroll = false
                            }
                        }
                    }
                    gestureDetector.onTouchEvent(event)
                    true  // 自己消费触摸，不让 view.onTouchEvent 干扰 GestureDetector 状态
                }
            }

            windowManager?.addView(floatingView, floatingParams)
            Log.d(TAG, "createFloatingDot: 圆点已显示")
            
        } catch (e: Exception) {
            Log.e(TAG, "createFloatingDot 失败: ${e.message}")
        }
    }
    
    private fun removeFloatingDot() {
        try {
            floatingView?.let {
                windowManager?.removeView(it)
                floatingView = null
            }
        } catch (e: Exception) {
            Log.w(TAG, "removeFloatingDot 失败: ${e.message}")
        }
    }
    
    // ==================== 闪光效果 ====================
    
    private fun showFlashEffect() {
        try {
            flashView?.let {
                windowManager?.removeView(it)
                flashView = null
            }
            
            val params = WindowManager.LayoutParams().apply {
                type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                } else {
                    @Suppress("DEPRECATION")
                    WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
                }
                flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                width = WindowManager.LayoutParams.MATCH_PARENT
                height = WindowManager.LayoutParams.MATCH_PARENT
                alpha = 0.3f
            }
            
            flashView = View(this).apply {
                setBackgroundColor(Color.WHITE)
            }
            
            windowManager?.addView(flashView, params)
            
            mainHandler.postDelayed({
                try {
                    flashView?.let {
                        windowManager?.removeView(it)
                        flashView = null
                    }
                } catch (e: Exception) {}
            }, 100)
            
        } catch (e: Exception) {
            Log.w(TAG, "showFlashEffect 失败: ${e.message}")
        }
    }
    
    // ==================== 工具 ====================
    
    private fun dp(dp: Float): Int {
        return (dp * resources.displayMetrics.density).toInt()
    }
    
    private fun cleanupImageReader() {
        try { virtualDisplay?.release(); virtualDisplay = null } catch (e: Exception) {}
        try { imageReader?.close(); imageReader = null } catch (e: Exception) {}
    }
    
    private fun cleanup() {
        cleanupImageReader()
        try {
            mediaProjection?.unregisterCallback(object : MediaProjection.Callback() {})
        } catch (e: Exception) {}
        try { mediaProjection?.stop() } catch (e: Exception) {}
        mediaProjection = null
        Log.d(TAG, "cleanup: 资源已释放")
    }
    
    // ==================== 通知 ====================
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ZBB 截图服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "用于截图的常驻前台服务"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }
    
    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("ZBB 自动化工具")
            .setContentText("截图服务运行中")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
}