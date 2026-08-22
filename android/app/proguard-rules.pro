# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# ZBB 自定义 Native Module (2026-07-05 v2-fix: writeBusinessLog / triggerLogUploadNow)
-keep class com.zbb.automation.AutomationModule { *; }
-keepclassmembers class com.zbb.automation.** {
    @com.facebook.react.bridge.ReactMethod *;
}
-keep class com.zbb.automation.ZbbKeepAliveService { *; }
-keep class com.zbb.automation.LogUploadScheduler { *; }
-keep class com.zbb.automation.LogUploadWorker { *; }

# v6/v8/v9 commit: 5min 静默触发器 + 干活机制 (IdleTrigger*/WorkOrchestrator/OperationDetector)
# 不 keep 会被 R8 重命名, 导致 PendingIntent 触发时 ClassNotFoundException
# v9 2026-07-08 老板拍板 C 方案修复时增加
-keep class com.zbb.automation.IdleTriggerWorker { *; }
-keep class com.zbb.automation.IdleTriggerScheduler { *; }
-keep class com.zbb.automation.IdleTriggerReceiver { *; }
-keep class com.zbb.automation.WorkOrchestrator { *; }
-keep class com.zbb.automation.OperationDetector { *; }

# v11 老板拍板 D 方案: WorkOrchestrator.simulateUserTap() 通过 AccessibilityServiceImpl.instance.dispatchGesture 模拟触摸
# 不 keep 会被 R8 重命名为 a/b/c, 反射/直接引用都失败
-keep class com.zbb.automation.AccessibilityServiceImpl { *; }

# Add any project specific keep options here:
