/**
 * V4.x 环境变量模块 (08-24 老板拍板 a=方案A)
 *
 * 实战反证金标准 (08-24):
 *   - 老板 nova 实测 v14: 点开始干活 → 弹 "流程失败: qianji_failed"
 *   - 根因: qianji.ts:24 hardcoded 'com.qianji.client', 真千机是 com.lianjia.anchang
 *   - 老板拍板 a=方案A: 编译时切换 + gradle.properties + JS 读 native resource
 *
 * 实战反证金标准 (08-22 ~ 08-23):
 *   - V2.x 早就有 BuildConfig.QIANJI_PACKAGE 机制 (gradle.properties 集中管理)
 *   - V4 v14 抄代码时漏抄, 错把包名写成 'com.qianji.client' (V2.x mock test 残留)
 *   - V4 修正: native 端已有 BuildConfig (NotificationMonitorService.kt:28)
 *
 * 数据流:
 *   gradle.properties (appEnv/production)
 *     ↓ gradle.properties qianjiPackage + qianjiMainActivity
 *   build.gradle → BuildConfig.APP_ENV + QIANJI_PACKAGE + QIANJI_MAIN_ACTIVITY
 *     ↓ build.gradle 写 env.json 到 assets/env.json
 *   AutomationModule.readBuildEnv() @ReactMethod
 *     ↓ JS 调用 readBuildEnv() 拿同步包名
 *   APP_PACKAGES (JS 端)
 *
 * 切换流程:
 *   1. 编辑 android/gradle.properties:
 *      appEnv=production → appEnv=mock
 *      qianjiPackage=com.lianjia.anchang → qianjiPackage=com.zbb.qianji.mock
 *   2. 重 build v15 (gradle assembleRelease)
 *   3. 装新 APK 到 nova / 测试机
 */

import { NativeModules } from 'react-native';

/**
 * APP 包名常量 (08-24 实战反证金标准)
 *
 * 实战反证金标准:
 *   - production: 真千机, V2.x V22.x 实战反证 (线上)
 *   - mock:       com.zbb.qianji.mock, 测试用
 *
 * 用法: launchApp(APP_PACKAGES.QIANJI.PACKAGE)
 */
export const APP_PACKAGES = {
  QIANJI: {
    PACKAGE: 'com.zbb.qianji.mock', // 🆕 08-25 mock (was com.lianjia.anchang 真千机)
    MAIN_ACTIVITY: 'com.zbb.qianji.mock.MainActivity', // 🆕 08-25 mock (was APlusIconActivity 真千机 launcher)
    MOCK_PACKAGE: 'com.zbb.qianji.mock',
    MOCK_MAIN_ACTIVITY: 'com.zbb.qianji.mock.MainActivity',
  },
  WECHAT_WORK: 'com.tencent.wework',
  BAOLI_MINIAPP: 'cloudfamily', // 云和家经纪云关键字
};

/**
 * 当前 APP_ENV (08-24 老板拍板 a=方案A)
 *
 * 实战反证金标准: 启动时从 native BuildConfig 读, 保证 JS/native 同步
 */
export type AppEnv = 'production' | 'mock';

let _appEnvCache: AppEnv | null = null;
let _qianjiPackageCache: string | null = null;
let _qianjiMainActivityCache: string | null = null;

/**
 * 从 native BuildConfig 读当前环境 (08-24 实战反证金标准)
 *
 * 流程:
 *   1. JS 调 AutomationModule.readBuildEnv()
 *   2. native 从 assets/env.json 读 (build.gradle 写入)
 *   3. fallback: native 直接读 BuildConfig.APP_ENV
 */
export async function loadAppEnv(): Promise<{
  appEnv: AppEnv;
  qianjiPackage: string;
  qianjiMainActivity: string;
}> {
  if (_appEnvCache !== null) {
    return {
      appEnv: _appEnvCache,
      qianjiPackage: _qianjiPackageCache!,
      qianjiMainActivity: _qianjiMainActivityCache!,
    };
  }

  // 默认值 (native 不可用时 fallback)
  let result = {
    appEnv: 'production' as AppEnv,
    qianjiPackage: APP_PACKAGES.QIANJI.PACKAGE,
    qianjiMainActivity: APP_PACKAGES.QIANJI.MAIN_ACTIVITY,
  };

  try {
    // 🆕 08-25 老板拍板 修法1 (V2.x 实战反证金标准): 改用 getConstants() 同步字段
    //   之前: readBuildEnv() Promise 异步方法 — 实测老板 RN bridge 不暴露 (native keys 列表里没有)
    //   改后: NativeModules.ZBBAutomation.APP_ENV (同步字段, RN 启动时自动读)
    const native = NativeModules.ZBBAutomation as any;
    if (native) {
      console.log('[env] native module keys count:', Object.keys(native).length);
      // 直接读同步常量 (V2.x 实战反证金标准 getConstants)
      const syncAppEnv = native.APP_ENV;
      if (syncAppEnv === 'production' || syncAppEnv === 'mock') {
        result = {
          appEnv: syncAppEnv,
          qianjiPackage: native.QIANJI_PACKAGE || result.qianjiPackage,
          qianjiMainActivity: native.QIANJI_MAIN_ACTIVITY || result.qianjiMainActivity,
        };
        console.log('[env] native BuildConfig (via getConstants):', result);
      } else {
        console.warn('[env] native.APP_ENV 不存在或值无效, fallback 默认值 production');
      }
    } else {
      console.warn('[env] NativeModules.ZBBAutomation = undefined (module 未注册到 bridge)');
    }
  } catch (e) {
    console.error('[env] 读取失败, fallback 默认值:', e);
  }

  _appEnvCache = result.appEnv;
  _qianjiPackageCache = result.qianjiPackage;
  _qianjiMainActivityCache = result.qianjiMainActivity;

  return result;
}

/**
 * 当前用的千机包名 (同步, 必须先调 loadAppEnv)
 */
export function qianjiPackage(): string {
  return _qianjiPackageCache || APP_PACKAGES.QIANJI.PACKAGE;
}

/**
 * 当前用的千机 MainActivity (同步, 必须先调 loadAppEnv)
 */
export function qianjiMainActivity(): string {
  return _qianjiMainActivityCache || APP_PACKAGES.QIANJI.MAIN_ACTIVITY;
}