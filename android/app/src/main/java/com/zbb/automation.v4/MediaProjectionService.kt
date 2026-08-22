package com.zbb.automation.v4

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * ZBB 前台服务
 * 
 * 此服务是一个常驻前台服务，用于：
 * 1. 保持应用活跃状态
 * 2. 配合 AccessibilityService 进行自动化操作
 * 
 * 注意：MediaProjection 相关的功能已移至 ScreenshotService
 */
class MediaProjectionService : Service() {

    companion object {
        private const val TAG = "MediaProjectionService"
        private const val CHANNEL_ID = "ZBB_MediaProjection_Channel"
        private const val NOTIFICATION_ID = 10001
        
        @Volatile
        var instance: MediaProjectionService? = null
            private set
        
        /**
         * 启动前台服务
         */
        fun startService(context: Context) {
            try {
                val intent = Intent(context, MediaProjectionService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                Log.d(TAG, "前台服务启动命令已发送")
            } catch (e: Exception) {
                Log.e(TAG, "启动前台服务失败: ${e.message}")
            }
        }
        
        /**
         * 停止前台服务
         */
        fun stopService(context: Context) {
            try {
                val intent = Intent(context, MediaProjectionService::class.java)
                context.stopService(intent)
                Log.d(TAG, "前台服务停止命令已发送")
            } catch (e: Exception) {
                Log.e(TAG, "停止前台服务失败: ${e.message}")
            }
        }
        
        /**
         * 检查服务是否运行
         */
        fun isRunning(): Boolean = instance != null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.d(TAG, "前台服务 onCreate")
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "前台服务 onStartCommand")
        
        // 确保服务保持运行
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "前台服务 onDestroy")
        instance = null
    }
    
    // ==================== 通知相关 ====================
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ZBB 自动化服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "用于保持应用活跃的前台服务"
                setShowBadge(false)
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }
    
    private fun createNotification(): Notification {
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("ZBB 自动化工具")
            .setContentText("自动化服务运行中")
            .setSmallIcon(android.R.drawable.ic_menu_preferences)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
}
