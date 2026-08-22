package com.zbb.automation.v4

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator

/**
 * ZBB 悬浮窗管理器
 * 
 * 功能：
 * - 在屏幕上显示悬浮角标
 * - 显示当前步骤和进度
 * - 提供停止按钮
 * - 支持拖拽移动
 */
class FloatingWindowManager(private val context: Context) {

    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var containerView: View? = null
    
    private val handler = Handler(Looper.getMainLooper())
    
    // UI 组件引用
    // appNameText 已移除（不再显示"抖音"图标和文字）
    private var runningIndicator: View? = null
    private var stopButton: LinearLayout? = null
    private var screenshotButton: View? = null  // 截图确认按钮

    // 状态
    private var isShowing = false
    private var isPaused = false
    private var isQuietMode = false  // 安静模式：非活动时隐藏边框
    private var isScreenshotConfirmed = false  // 截图确认状态

    // 回调
    var onStopClicked: (() -> Unit)? = null
    var onScreenshotConfirmed: (() -> Unit)? = null  // 截图确认回调
    
    // 触摸拖拽相关
    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f
    private var isDragging = false
    
    // 步骤数据
    private var currentStepIndex = 0
    private var totalSteps = 14
    
    /**
     * 初始化悬浮窗
     */
    fun initialize() {
        if (floatingView != null) return
        
        windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        
        // 加载布局
        val inflater = context.getSystemService(Context.LAYOUT_INFLATER_SERVICE) as LayoutInflater
        floatingView = inflater.inflate(R.layout.floating_window, null)
        
        // 初始化布局参数
        layoutParams = WindowManager.LayoutParams().apply {
            type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            format = PixelFormat.TRANSLUCENT
            flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            width = WindowManager.LayoutParams.WRAP_CONTENT
            height = WindowManager.LayoutParams.WRAP_CONTENT
            gravity = Gravity.TOP or Gravity.END  // 靠右
            x = 20  // 右边距20dp
            y = 400 // 距离顶部400dp（屏幕右侧中部）
        }
        
        // 获取组件引用
        containerView = floatingView?.findViewById(R.id.floating_container)
        runningIndicator = floatingView?.findViewById(R.id.running_indicator)
        stopButton = floatingView?.findViewById(R.id.stop_button)
        screenshotButton = floatingView?.findViewById(R.id.screenshot_button)

        // 设置停止按钮点击事件
        stopButton?.setOnClickListener {
            onStopClicked?.invoke()
        }

        // 设置截图确认按钮点击事件
        screenshotButton?.setOnClickListener {
            // 切换为蓝色并触发回调
            isScreenshotConfirmed = true
            screenshotButton?.setBackgroundResource(R.drawable.screenshot_button_blue)
            onScreenshotConfirmed?.invoke()
        }
        
        // 设置拖拽功能
        setupDragFunctionality()
        
        // 设置运行指示灯闪烁
        startRunningBlink()
    }
    
    /**
     * 设置安静模式（非活动时隐藏边框）
     * @param quiet true=隐藏边框（更透明）, false=正常显示
     */
    fun setQuietMode(quiet: Boolean) {
        this.isQuietMode = quiet
        handler.post {
            if (quiet) {
                // 隐藏边框：使用更透明的背景
                containerView?.setBackgroundResource(R.drawable.floating_background_idle)
                // 隐藏运行指示灯
                runningIndicator?.visibility = View.INVISIBLE
                // 隐藏停止按钮
                stopButton?.visibility = View.INVISIBLE
            } else {
                // 正常显示
                containerView?.setBackgroundResource(R.drawable.floating_background)
                runningIndicator?.visibility = View.VISIBLE
                stopButton?.visibility = View.VISIBLE
            }
        }
    }
    
    /**
     * 设置拖拽功能
     */
    private fun setupDragFunctionality() {
        floatingView?.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = layoutParams?.x ?: 0
                    initialY = layoutParams?.y ?: 0
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaX = (event.rawX - initialTouchX).toInt()
                    val deltaY = (event.rawY - initialTouchY).toInt()
                    
                    // 只有移动超过一定距离才认为是拖拽
                    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                        isDragging = true
                    }
                    
                    if (isDragging) {
                        layoutParams?.x = initialX + deltaX
                        layoutParams?.y = initialY + deltaY
                        windowManager?.updateViewLayout(floatingView, layoutParams)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!isDragging) {
                        // 点击事件
                        stopButton?.performClick()
                    }
                    true
                }
                else -> false
            }
        }
    }
    
    /**
     * 开始显示悬浮窗
     */
    fun show() {
        if (floatingView == null) {
            initialize()
        }
        
        if (isShowing) return
        
        try {
            floatingView?.let { view ->
                layoutParams?.let { params ->
                    windowManager?.addView(view, params)
                    isShowing = true
                    
                    // 显示动画
                    view.alpha = 0f
                    view.animate()
                        .alpha(1f)
                        .setDuration(300)
                        .start()
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    
    /**
     * 隐藏悬浮窗
     */
    fun hide() {
        if (!isShowing) return
        
        try {
            floatingView?.let { view ->
                // 隐藏动画
                view.animate()
                    .alpha(0f)
                    .setDuration(200)
                    .withEndAction {
                        windowManager?.removeView(view)
                        isShowing = false
                    }
                    .start()
            }
        } catch (e: Exception) {
            e.printStackTrace()
            try {
                windowManager?.removeView(floatingView)
            } catch (ex: Exception) {
                ex.printStackTrace()
            }
            isShowing = false
        }
    }
    
    /**
     * 更新步骤信息（已简化，不再显示步骤名称和进度）
     */
    fun updateStep(stepName: String, stepIndex: Int, total: Int = 14) {
        this.currentStepIndex = stepIndex
        this.totalSteps = total
        // 简化版本只显示"运行中"，不需要更新其他UI
    }
    
    /**
     * 更新 APP 信息（已弃用，不再显示 APP 图标）
     */
    fun updateAppInfo(appName: String, appIconResId: Int = R.drawable.ic_robot) {
        // appNameText 已移除，不再显示"抖音"图标和文字
        // 此方法保留但不再生效
    }
    
    /**
     * 设置空闲状态（已简化）
     */
    fun setIdle() {
        // 简化版本只显示"运行中"，不需要更新其他UI
    }
    
    /**
     * 设置完成状态（已简化）
     */
    fun setComplete() {
        // 3秒后自动隐藏
        handler.postDelayed({
            hide()
        }, 3000)
    }
    
    /**
     * 开始运行指示灯闪烁
     */
    private fun startRunningBlink() {
        handler.post(object : Runnable {
            override fun run() {
                if (!isShowing) return
                
                runningIndicator?.let { indicator ->
                    val isVisible = indicator.alpha > 0.5f
                    indicator.animate()
                        .alpha(if (isVisible) 0.3f else 1f)
                        .setDuration(500)
                        .start()
                }
                
                handler.postDelayed(this, 1000)
            }
        })
    }
    
    /**
     * 销毁悬浮窗
     */
    fun destroy() {
        handler.removeCallbacksAndMessages(null)
        hide()
        floatingView = null
        windowManager = null
    }
    
    /**
     * 是否正在显示
     */
    fun isShowing(): Boolean = isShowing

    /**
     * 显示截图确认按钮（红色）
     */
    fun showScreenshotButton() {
        isScreenshotConfirmed = false
        handler.post {
            screenshotButton?.visibility = View.VISIBLE
            screenshotButton?.setBackgroundResource(R.drawable.screenshot_button_red)
        }
    }

    /**
     * 隐藏截图确认按钮
     */
    fun hideScreenshotButton() {
        handler.post {
            screenshotButton?.visibility = View.GONE
        }
    }

    /**
     * 重置截图确认按钮（下次显示时为红色）
     */
    fun resetScreenshotButton() {
        isScreenshotConfirmed = false
    }
}
