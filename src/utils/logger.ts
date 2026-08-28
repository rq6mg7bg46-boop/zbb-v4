/**
 * V4.x 统一 log 工具 (08-27 老板拍板加时间戳 + 🆕 V32.30 emitNative 修正)
 *
 * 格式: [HH:MM:SS] [tag] message
 * 时区: Asia/Shanghai (北京时间)
 *
 * 🆕 08-27 23:50 老板拍板 (生产场景铁律):
 *   - 所有日志必须通过外网回传到日志服务器, 不能只靠 metro (metro 只在 adb logcat 临时可见)
 *   - 修法: logger 同时调 console.* (metro 调试) + NativeModules.ZBBAutomation.writeBusinessLog (写盘 + 上传)
 *   - writeBusinessLog 走 BusinessLogWriter.append → business-YYYY-MM-DD.log → LogUploadWorker → Tailscale Funnel → Win11 server
 *   - 异步不 await (不阻塞 UI), 静默失败兜底 (native 不可用时 console.log 还能给 metro 看到)
 *
 * 🆕 08-28 09:50 V32.30 commit (回滚 V32.28 console hook):
 *   - 老板反证: V32.28 console hook 在 Hermes release 下失效 (V2.x 实战也没写过 JS log)
 *   - 真因: Hermes/Metro 在 release 包里替换了 console 对象, hook 装的是 React Native 给我们的版本,
 *     业务代码调的是被 Hermes 重写过的版本, hook 拦截不到
 *   - 修法: 不依赖 console hook, logger.info/warn/error 内手动 emit native bridge
 *     (V32.27 commit 设计是对的, V32.28 改成 hook 是错的, 现在回滚)
 *
 * 已知未覆盖场景 (后续 task):
 *   - 业务代码直接调 console.log('[P+ humanTap] ...') 不会写盘
 *   - 26 kt native 端 Log.d/Log.i 直接 logcat, 不会被 logger 拦截
 *   - 修法: 全仓 grep console.* 替换成 logger.* (V32.18 commit 已批量替换 189 处)
 *
 * 格式: HH:MM:SS 秒级
 * 时区: 北京时间
 *
 * 用法:
 *   import { logger } from '@/utils/logger';
 *   logger.info('pollA11y', '→ true');            // [06:27:08] [pollA11y] → true
 *   logger.warn('qianji', '找不到报备');            // [06:27:09] [qianji] 找不到报备
 *   logger.error('Orchestrator', '非法转移');       // [06:27:10] [Orchestrator] 非法转移
 */

/**
 * 格式化日志行: [tag] message (不带头部时间戳, 由 native 端统一加)
 * 🆕 V32.30 commit: 去掉 [HH:MM:SS] 前缀, 避免双时间戳
 *   - metro log 自带 adb logcat 时间戳 (adb logcat -v time)
 *   - native 端 BusinessLogWriter.append 加 yyyy/MM/dd HH:mm:ss
 */
const format = (tag: string, msg: string): string => {
  return `[${tag}] ${msg}`;
};

/**
 * 🆕 V32.30 emit 到 native bridge (BusinessLogWriter.append → LogUploadWorker 上传)
 * 不 await (业务 log 不阻塞 UI), 静默失败 (native 不可用时 console.log 兜底)
 *
 * 不再依赖 console hook (V32.28 commit 验证 hook 在 Hermes release 失效)
 * logger.info/warn/error 直接调本函数
 */
const emitToNative = (level: 'info' | 'warn' | 'error', line: string): void => {
  const ZBBAutomation = (globalThis as any).NativeModules?.ZBBAutomation;
  if (!ZBBAutomation?.writeBusinessLog) {
    // 🆕 08-28 09:31 诊断: native 不可用时 warn 一次 (后续静默, 避免刷屏)
    if (!(globalThis as any).__zbbLogBridgeMissingLogged) {
      (globalThis as any).__zbbLogBridgeMissingLogged = true;
      // eslint-disable-next-line no-console
      console.warn('[zbb-logger] ⚠️ ZBBAutomation.writeBusinessLog 不可用, JS log 只走 console 不写盘 (native module 未注册或 native 不可用)');
    }
    return;  // native 不可用, 静默 (console 已打)
  }
  // 异步 fire-and-forget, 失败 warn 一次
  ZBBAutomation.writeBusinessLog(level, line).catch((e: any) => {
    if (!(globalThis as any).__zbbLogBridgeErrorLogged) {
      (globalThis as any).__zbbLogBridgeErrorLogged = true;
      // eslint-disable-next-line no-console
      console.warn('[zbb-logger] ⚠️ writeBusinessLog 调用失败:', e?.message ?? e);
    }
  });
};

export const logger = {
  info: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.log(line);         // 1. metro (R 键 reload 临时可见)
    emitToNative('info', line); // 2. native bridge 写盘 (server 持久化)
  },
  warn: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.warn(line);         // 1. metro
    emitToNative('warn', line); // 2. native bridge 写盘
  },
  error: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.error(line);         // 1. metro
    emitToNative('error', line); // 2. native bridge 写盘
  },
};

export default logger;