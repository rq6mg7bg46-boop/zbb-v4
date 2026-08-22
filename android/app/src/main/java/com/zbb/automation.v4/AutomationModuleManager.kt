package com.zbb.automation.v4

import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext

/**
 * AutomationModule 实例管理器
 * 用于从 MainActivity 获取 AutomationModule 实例
 */
object AutomationModuleManager {
    
    private const val TAG = "AutomationModuleManager"
    
    private var moduleInstance: AutomationModule? = null
    
    /**
     * 注册 AutomationModule 实例
     * 在 AutomationModule 构造时调用
     */
    fun registerModule(module: AutomationModule) {
        Log.d(TAG, ">>> AutomationModule 已注册")
        moduleInstance = module
    }
    
    /**
     * 获取 AutomationModule 实例
     * 在 MainActivity.onActivityResult 中调用
     */
    fun getModule(): AutomationModule? {
        return moduleInstance
    }
    
    /**
     * 取消注册
     * 在模块销毁时调用
     */
    fun unregisterModule() {
        Log.d(TAG, ">>> AutomationModule 已取消注册")
        moduleInstance = null
    }
}
