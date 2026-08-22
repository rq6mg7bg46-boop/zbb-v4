package com.zbb.automation.v4

import android.util.Log

/**
 * ZBB 操作检测器 —— v6 方向 L 调整（2026-07-07 老板拍板）
 *
 * 设计目标（老板 2026-07-07 拍板）：
 * - 单例记录最后一次操作时间（用户操作 + ZBB 自己操作都算）
 * - 5min 静默 + 干活判定：now - lastInteraction >= 5min → 5s 前置观察窗
 * - 5s 前置窗内无新操作 = 真空闲 → 启动干活流程
 * - 5s 前置窗内有新操作 = 取消干活 + 重新计时
 *
 * 跟 v5 用户空闲检测（5s 阈值）共存：
 * - 5s 空闲（v5）：千机消息到达后等用户空闲 5s → 启动千机流程
 * - 5min 静默（v6）：5min 无任何操作 → 启动"干活"（千机/越秀/保利 积压扫描）
 *
 * 优先级仲裁：
 * - 千机消息（v5 5s 空闲）= 最高优先级（绕过 5min 静默期）
 * - 5min 静默干活（v6）= 中优先级（老板离开 / 屏幕锁住时跑）
 *
 * 关键设计：
 * - @Volatile 保证跨线程可见（AccessibilityService 主线程 + Worker IO 线程）
 * - 单例 object（不依赖 Context，进程内全局）
 * - 写入 cheap（只更新 Long + Log.d），读取 O(1)
 */
object OperationDetector {
    private const val TAG = "OperationDetector"

    @Volatile
    private var lastUserInteractionMs: Long = 0L

    @Volatile
    private var lastZbbInteractionMs: Long = 0L

    /**
     * 记录用户操作（老板手机触摸/滑动/点击）
     * 调用方：AccessibilityServiceImpl.onAccessibilityEvent
     * - TYPE_TOUCH_INTERACTION_END
     * - TYPE_VIEW_CLICKED
     * - TYPE_WINDOW_STATE_CHANGED (用户切换 app)
     */
    fun recordUserInteraction() {
        val now = System.currentTimeMillis()
        lastUserInteractionMs = now
        Log.d(TAG, "recordUserInteraction at $now")
    }

    /**
     * 记录 ZBB 自身操作（AccessibilityService 模拟点击/滑动）
     * 调用方：AutomationModule.tap / swipe / clickByText 等 RN 桥方法
     * 用途：ZBB 跑业务流期间不需要触发 5min 干活（避免自激）
     */
    fun recordZbbInteraction() {
        val now = System.currentTimeMillis()
        lastZbbInteractionMs = now
        Log.d(TAG, "recordZbbInteraction at $now")
    }

    /**
     * 拿最后任意一次操作时间（用户 + ZBB 两者最大）
     * Worker.doWork 内判定 5min 静默用
     */
    fun getLastInteractionMs(): Long {
        return maxOf(lastUserInteractionMs, lastZbbInteractionMs)
    }

    /**
     * 是否已静默 >= thresholdMs
     * thresholdMs = 0L 表示无任何操作记录 → 视为空闲（让首次干活能跑）
     */
    fun isUserIdle(thresholdMs: Long): Boolean {
        val last = getLastInteractionMs()
        return if (last == 0L) {
            Log.d(TAG, "isUserIdle($thresholdMs): no interaction history → idle")
            true
        } else {
            val delta = System.currentTimeMillis() - last
            val idle = delta >= thresholdMs
            Log.d(TAG, "isUserIdle($thresholdMs): last=$last delta=${delta}ms idle=$idle")
            idle
        }
    }

    /**
     * 5min 静默 + 5s 前置观察窗 复合判定（Worker.doWork 调）
     * 流程：
     *  1. 检查是否已静默 5min（否则直接跳过）
     *  2. 记录 preCheckStartLast
     *  3. 5s 后再读 getLastInteractionMs
     *  4. 如果 preCheckStartLast == preCheckEndLast → 5s 内无新操作 → 真空闲
     *  5. 否则 → 5s 内有操作 → 取消干活
     *
     * 返回：true = 5min+5s 静默真成立 / false = 5min 静默成立但 5s 内有新操作
     */
    suspend fun isIdleAfterPreCheck(thresholdMs: Long, preCheckMs: Long): Boolean {
        val start = System.currentTimeMillis()
        val preCheckStartLast = getLastInteractionMs()
        kotlinx.coroutines.delay(preCheckMs)
        val preCheckEndLast = getLastInteractionMs()
        val total = System.currentTimeMillis() - start
        val noNewInteraction = preCheckStartLast == preCheckEndLast
        Log.d(
            TAG,
            "isIdleAfterPreCheck(threshold=$thresholdMs preCheck=$preCheckMs): " +
                "preCheckStartLast=$preCheckStartLast preCheckEndLast=$preCheckEndLast " +
                "noNewInteraction=$noNewInteraction total=${total}ms"
        )
        return noNewInteraction
    }
}
