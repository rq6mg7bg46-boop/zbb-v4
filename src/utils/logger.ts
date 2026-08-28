/**
 * V4.x 统一 log 工具 (08-27 老板拍板加时间戳 + 🆕 V32.30 emitNative + 🆕 V32.32 双时间戳诊断)
 *
 * 🆕 08-27 23:50 老板拍板 (生产场景铁律):
 *   - 所有日志必须通过外网回传到日志服务器, 不能只靠 metro
 *   - logger 同时调 console.* (metro 调试) + NativeModules.ZBBAutomation.writeBusinessLog (写盘 + 上传)
 *   - 异步 fire-and-forget, 静默失败兜底
 *
 * 🆕 08-28 10:15 老板拍板 (V32.32 双时间戳格式):
 *   - 老板实战反证: V32.31 release 装的 nova metro log 有 JS log, server log 没 JS log
 *   - 老板拍板加 [HH:MM:SS] 前缀作为"是否 JS 端写盘"的诊断标记
 *   - 期望 server log 格式: 2026/08/28 [INFO   ] [09:44:31] [千机:步骤1] 正在打开千机...
 *     ↑ native 日期    ↑ native level   ↑ JS 时间戳(诊断标记)  ↑ JS tag    ↑ JS msg
 *   - 如果 server log 看到 [HH:MM:SS] 字串 → JS 端写盘成功 (native bridge 工作)
 *   - 如果 server log 没看到 [HH:MM:SS] 字串 → 写盘失败 (定位 native bridge 路径)
 *
 * 🆕 V32.30 emitNative 设计:
 *   - logger.info/warn/error 内手动调 emitToNative (不依赖 console hook)
 *   - V32.28 commit 装的 console hook 在 Hermes release 失效 (老板实战反证)
 *   - V32.30 删 hook, 改 logger.* 内手动 emit
 *
 * 已知未覆盖:
 *   - 业务代码直接调 console.log('[P+ humanTap] ...') 不会写盘
 *   - 26 kt native 端 Log.d/Log.i 直接 logcat, 不会被 logger 拦截
 *   - 修法: 全仓 grep console.* 替换成 logger.* (V32.18 commit 已批量替换 189 处)
 */

/**
 * 取北京时间 HH:MM:SS (秒级)
 */
const getBjTime = (): string => {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });
};

/**
 * 🆕 V32.32 格式化: [HH:MM:SS] [tag] message
 *   - [HH:MM:SS] 作为"是否 JS 端写盘"的诊断标记
 *   - metro log 自带 adb logcat 时间戳, 这个 [HH:MM:SS] 是给 server log 用的
 */
const format = (tag: string, msg: string): string => {
  return `[${getBjTime()}] [${tag}] ${msg}`;
};

/**
 * V32.30 emit 到 native bridge (BusinessLogWriter.append → LogUploadWorker 上传)
 * 不 await (业务 log 不阻塞 UI), 静默失败兜底
 */
const emitToNative = (level: 'info' | 'warn' | 'error', line: string): void => {
  const ZBBAutomation = (globalThis as any).NativeModules?.ZBBAutomation;
  if (!ZBBAutomation?.writeBusinessLog) {
    if (!(globalThis as any).__zbbLogBridgeMissingLogged) {
      (globalThis as any).__zbbLogBridgeMissingLogged = true;
      // eslint-disable-next-line no-console
      console.warn('[zbb-logger] ⚠️ ZBBAutomation.writeBusinessLog 不可用, JS log 只走 console 不写盘');
    }
    return;
  }
  ZBBAutomation.writeBusinessLog(level, line).then((ok: boolean) => {
    // 🆕 V32.32 诊断: native 端 resolve 后打成功标记, 但不在 metro log 里刷屏
    if (ok && !(globalThis as any).__zbbLogBridgeOkLogged) {
      (globalThis as any).__zbbLogBridgeOkLogged = true;
      // eslint-disable-next-line no-console
      console.warn('[zbb-logger] ✓ writeBusinessLog resolve=true (native 写盘成功)');
    }
  }).catch((e: any) => {
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
    console.log(line);         // 1. metro
    emitToNative('info', line); // 2. native bridge
  },
  warn: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.warn(line);         // 1. metro
    emitToNative('warn', line); // 2. native bridge
  },
  error: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.error(line);         // 1. metro
    emitToNative('error', line); // 2. native bridge
  },
};

export default logger;