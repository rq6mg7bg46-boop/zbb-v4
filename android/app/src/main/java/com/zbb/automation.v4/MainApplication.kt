package com.zbb.automation.v4

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // 添加 ZBB 自动化模块
              add(AutomationPackage())
            }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)

    // 2026-07-04 v1.6.4.1-huawei-hotfix：启动后立即调度一次日志上传
    // 之后由 LogUploadWorker.doWork() 成功路径自动排 24h 链式任务
    LogUploadScheduler.scheduleInitialAndLoop(this)

    // 2026-07-07 v6 方向 L 调整：5min 静默 + 干活机制（替换 v5 ZbbAntiSleepWorker 的 5min WakeLock 5s）
    // v5 强制 WakeLock 5s 在 release 模式 + 锁屏下被 EMUI doze 拒绝
    // v6 等 5min 真静默后启动干活流程，屏幕自然亮，锁屏问题自然消解
    // 之后由 IdleTriggerWorker.doWork() 成功路径自动排 5min 链式任务
    IdleTriggerScheduler.scheduleInitialAndLoop(this)

    // 🆕 v19.44 (07-21) 老板拍板 D12-C: 启动时强制重置 mutex
    // 防止 RN/Hermes native state 跨 session 残留 + force-stop 后 state 未释放
    // （14:47 / 15:36 / 15:54 mutex fail 真凶: BaoliService.isRunning=true 残留至少 27 分钟）
    // 实现：emit DeviceEventEmitter("ZBB_FORCE_RESET_MUTEX") → _layout.tsx listener 调 forceReset()
    // 用 reactHost 拿 ReactContext + JS 端 RCTDeviceEventEmitter 跨 JS/Native
    try {
      val ctx = reactHost.currentReactContext
      if (ctx != null) {
        ctx.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("ZBB_FORCE_RESET_MUTEX", null)
      }
    } catch (e: Exception) {
      android.util.Log.w("MainApplication", "forceResetMutex emit failed (best-effort): ${e.message}")
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
