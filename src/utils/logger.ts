/**
 * V4.x 统一 log 工具 (08-27 老板拍板加时间戳 + 🆕 V32.27 native bridge + 🆕 V32.28 console hook)
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
 * 🆕 08-27 23:55 老板拍板 (console hook):
 *   - 业务代码直接调 console.log('[P+ humanTap] ...') 也要写盘 (V2.x AutomationLogger 全局 hook 设计)
 *   - 修法: installConsoleHook() 替换 console.log/warn/error/info/debug, 全部 fan-out 到 appendToBusinessLog
 *   - V32.18 commit 漏接 console hook, V32.27 commit 修了 logger.* 但漏了直接 console.* 的业务代码
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
 * 安全 stringify (避免循环引用)
 * 抄 V2.x AutomationLogger.ts L62-72
 */
const safeStringify = (o: unknown): string => {
  if (typeof o === 'string') return o;
  if (o === null) return 'null';
  if (o === undefined) return 'undefined';
  try {
    return JSON.stringify(o);
  } catch {
    return String(o);
  }
};

/**
 * 🆕 08-27 23:50 异步 emit 到 native bridge (BusinessLogWriter.append → LogUploadWorker 上传)
 * 不 await (业务 log 不阻塞 UI), 静默失败 (native 不可用时 console.log 兜底)
 */
const appendToBusinessLog = (level: 'info' | 'warn' | 'error', line: string): void => {
  const ZBBAutomation = (globalThis as any).NativeModules?.ZBBAutomation;
  if (!ZBBAutomation?.writeBusinessLog) {
    return;  // native 不可用, 静默 (console 已打)
  }
  // 异步, 不 catch error (静默失败)
  ZBBAutomation.writeBusinessLog(level, line).catch(() => {});
};

/**
 * 🆕 08-27 23:55 console 全局 hook
 * 抄 V2.x AutomationLogger.ts installConsoleHook (L80-118)
 * 业务代码直接调 console.log('[P+ humanTap] ...') 也能写盘
 */
const originalLog = console.log.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);
const originalInfo = console.info.bind(console);
const originalDebug = console.debug.bind(console);

const installConsoleHook = (): void => {
  // 只装一次 (避免 HMR / module reload 重复)
  if ((globalThis as any).__zbbConsoleHooked) return;
  (globalThis as any).__zbbConsoleHooked = true;

  console.log = (...args: unknown[]): void => {
    originalLog(...args);
    appendToBusinessLog('info', args.map(safeStringify).join(' '));
  };
  console.warn = (...args: unknown[]): void => {
    originalWarn(...args);
    appendToBusinessLog('warn', args.map(safeStringify).join(' '));
  };
  console.error = (...args: unknown[]): void => {
    originalError(...args);
    appendToBusinessLog('error', args.map(safeStringify).join(' '));
  };
  console.info = (...args: unknown[]): void => {
    originalInfo(...args);
    appendToBusinessLog('info', args.map(safeStringify).join(' '));
  };
  console.debug = (...args: unknown[]): void => {
    originalDebug(...args);
    appendToBusinessLog('info', args.map(safeStringify).join(' '));
  };
};

installConsoleHook();

export const logger = {
  info: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.log(line);
    // 注意: console.log 已经被 hook 拦截, 会自动写盘
    // 不需要再调一次 appendToBusinessLog
  },
  warn: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.warn(line);
    // 同上, console.warn hook 已写盘
  },
  error: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    console.error(line);
    // 同上, console.error hook 已写盘
  },
};

export default logger;