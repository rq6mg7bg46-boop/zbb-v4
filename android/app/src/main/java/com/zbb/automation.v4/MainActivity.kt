package com.zbb.automation.v4
import expo.modules.splashscreen.SplashScreenManager

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  companion object {
    @Volatile
    var instance: MainActivity? = null
  }

  // 发起 MediaProjection 授权请求
  private var pendingProjectionCallback: ((Int, android.content.Intent?) -> Unit)? = null
  
  /**
   * 请求 MediaProjection 权限
   */
  fun requestMediaProjectionPermission(callback: (Int, android.content.Intent?) -> Unit) {
    pendingProjectionCallback = callback
    val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? android.media.projection.MediaProjectionManager
    if (projectionManager != null) {
      startActivityForResult(
        projectionManager.createScreenCaptureIntent(),
        ScreenshotService.PROJECTION_REQUEST_CODE
      )
    }
  }
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
    instance = this
    // v8 老板设计 2026-07-08: 保持屏幕常亮 (24h 工作手机模式, 借鉴地图类导航方案)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    Log.i("MainActivity", "✅ FLAG_KEEP_SCREEN_ON 已开启 (24h 工作手机模式)")
  }
  
  /**
   * 处理 Activity 结果
   * 用于接收 MediaProjection 权限结果
   */
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    Log.d("MainActivity", "onActivityResult: requestCode=$requestCode, resultCode=$resultCode")
    
    // 将结果传递给 ScreenshotService
    if (requestCode == ScreenshotService.Companion.PROJECTION_REQUEST_CODE) {
      if (resultCode == RESULT_OK && data != null) {
        ScreenshotService.startService(this)
        val intent = android.content.Intent(this, ScreenshotService::class.java).apply {
          action = ScreenshotService.ACTION_INIT_PROJECTION
          putExtra("resultCode", resultCode)
          putExtra("resultData", data)
        }
        startService(intent)
      } else {
        Log.w("MainActivity", "MediaProjection 授权取消")
      }
      return
    }
    
    // 将结果传递给 AutomationModule
    try {
      val module = AutomationModuleManager.getModule()
      module?.onMediaProjectionResult(requestCode, resultCode, data)
    } catch (e: Exception) {
      Log.e("MainActivity", "传递结果失败: ${e.message}")
    }
  }
  
  override fun onResume() {
    super.onResume()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
