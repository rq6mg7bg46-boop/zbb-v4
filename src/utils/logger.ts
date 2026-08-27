/**
 * V4.x 统一 log 工具 (08-27 老板拍板加时间戳 + 🆕 08-27 23:50 实装 native bridge)
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
 * 取北京时间 HH:MM:SS (秒级)
 * 用 toLocaleString 显式指定 timeZone, 避免宿主时区差异
 */
const getBjTime = (): string => {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });
};

/**
 * 格式化日志行: [HH:MM:SS] [tag] message
 */
const format = (tag: string, msg: string): string => {
  return `[${getBjTime()}] [${tag}] ${msg}`;
};

/**
 * 🆕 08-27 23:50 异步 emit 到 native bridge (BusinessLogWriter.append → LogUploadWorker 上传)
 * 不 await (业务 log 不阻塞 UI), 静默失败 (native 不可用时 console.log 兜底)
 */
const emitToNative = (level: 'info' | 'warn' | 'error', line: string): void => {
  const ZBBAutomation = (globalThis as any).NativeModules?.ZBBAutomation;
  if (!ZBBAutomation?.writeBusinessLog) {
    return;  // native 不可用, 静默 (console 已打)
  }
  // 异步, 不 catch error (静默失败)
  ZBBAutomation.writeBusinessLog(level, line).catch(() => {});
};

export const logger = {
  info: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.log(line);
    emitToNative('info', line);
  },
  warn: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.warn(line);
    emitToNative('warn', line);
  },
  error: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.error(line);
    emitToNative('error', line);
  },
};

export default logger;