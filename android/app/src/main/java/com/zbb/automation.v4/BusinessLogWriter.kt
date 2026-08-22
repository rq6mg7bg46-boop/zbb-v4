package com.zbb.automation.v4

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 业务日志本地写文件 —— 2026-07-05 v1.6.4.1-hotfix-fix-A 计划实现
 *
 * 设计目标 (老板 12:08 拍板修复 A 计划)：
 * - 不依赖 RN runtime / console hook，**Native 层任何调用点都可直接 append**
 *   → 拔线 / app 后台 / RN JS 冻结时, 业务事件仍能落到 filesDir
 * - 路径: <context.filesDir>/zbb_logs/business-YYYY-MM-DD.log (按天 rotate)
 * - 写失败时: Log.e 上报 logcat (即使是 release 也保留), 不静默
 * - 并发安全: 每个 file 用 synchronized 保护 appendText
 *
 * 调用方:
 *   1. AutomationModule.writeBusinessLog() — RN 端 log 调用
 *   2. AccessibilityServiceImpl.onAccessibilityEvent() — RN 后台也能写
 *   3. NotificationMonitorService.onNotificationReceived() — 千机/保利通知链路
 *
 * LogUploadWorker.readFromFilesDir() 读这个目录上传 server,
 * 增量游标 (B 计划) 用 byte offset 判断新内容.
 */
object BusinessLogWriter {
    private const val TAG = "ZbbNativeLog"
    private const val LOG_DIR = "zbb_logs"
    private const val FILE_PREFIX = "business-"
    private const val FILE_EXT = ".log"

    private val DATE_FMT_FILE = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val DATE_FMT_LINE = SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.CHINA)
    // 同步锁池 — 每个 file 一个锁, 避免多线程争夺同一个 file
    private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>()

    /**
     * 追加一条业务日志
     * @param context 任意 Context (用 applicationContext 取 filesDir)
     * @param level info/success/warn/error/debug
     * @param message 单行消息, 内部会替换 \n → ↵ 防错位
     * @return true=写盘成功, false=写盘失败 (调用方应上报 logcat)
     */
    fun append(context: Context, level: String, message: String): Boolean {
        return try {
            val appCtx = context.applicationContext
            val filesDir = appCtx.filesDir
            val logDir = File(filesDir, LOG_DIR)
            if (!logDir.exists()) logDir.mkdirs()
            val today = DATE_FMT_FILE.format(Date())
            val fileName = "$FILE_PREFIX$today$FILE_EXT"
            val logFile = File(logDir, fileName)

            val ts = DATE_FMT_LINE.format(Date())
            val levelShort = level.uppercase(Locale.US).padEnd(7)
            // 单行清洗: 把 \r\n 替换成转义字符, 防一行变多行破坏 incremental upload
            val safeMsg = message.replace("\r", "\\r").replace("\n", "\\n")
            val line = "$ts [$levelShort] $safeMsg\n"

            val lockKey = logFile.absolutePath
            val lock = locks.computeIfAbsent(lockKey) { Any() }
            synchronized(lock) {
                logFile.appendText(line, Charsets.UTF_8)
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "append failed: level=$level msg_len=${message.length} err=${e.message}", e)
            false
        }
    }

    /**
     * 拿到业务日志目录所有 .log 文件 — 供 LogUploadWorker 读
     */
    fun listLogFiles(context: Context): List<File> {
        val logDir = File(context.applicationContext.filesDir, LOG_DIR)
        if (!logDir.exists() || !logDir.isDirectory) return emptyList()
        return logDir.listFiles()
            ?.filter { it.isFile && it.name.startsWith(FILE_PREFIX) && it.name.endsWith(FILE_EXT) }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()
    }

    /**
     * 拿到具体某天业务日志文件 — 给 RN 端 debug 按日期拉
     */
    fun getLogFile(context: Context, dateStr: String): File? {
        val safeDate = dateStr.replace(Regex("[^0-9-]"), "")
        if (safeDate.length != 10) return null
        val logDir = File(context.applicationContext.filesDir, LOG_DIR)
        val f = File(logDir, "$FILE_PREFIX$safeDate$FILE_EXT")
        return if (f.exists() && f.isFile) f else null
    }

    /**
     * 清空某天的业务日志 — DebugReceiver 可调 (调试用)
     */
    fun clearLogFile(context: Context, dateStr: String): Boolean {
        val safeDate = dateStr.replace(Regex("[^0-9-]"), "")
        if (safeDate.length != 10) return false
        val logDir = File(context.applicationContext.filesDir, LOG_DIR)
        val f = File(logDir, "$FILE_PREFIX$safeDate$FILE_EXT")
        return f.exists() && f.delete()
    }
}
