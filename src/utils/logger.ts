/**
 * V4.x 统一 log 工具 (B方案: 完整回滚到 V2.x 实战验证的设计)
 *
 * 🆕 V32.34 B方案 (08-30 老板拍板): 完整回滚到 V2.x AutomationLogger 设计
 *   - V2.x vivo server log 14 天实战反证: 3 路并打 (console + sendToServer HTTP POST + native writeBusinessLog) 都 work
 *   - V4 V32.27/V32.30/V32.31/V32.33 失败 4 轮, 因为只走了 native bridge (RN 0.81.5 Legacy 不暴露 @ReactMethod Promise 方法)
 *   - B方案: 完整学 V2.x 实战反证设计:
 *     1. console.log 永远保留 (debug 用)
 *     2. sendToServer HTTP POST EXPO_PUBLIC_BACKEND_BASE_URL/api/v1/logs (V2.x 主链路, 不依赖 RN bridge)
 *     3. native writeBusinessLog 走 V32.33 治本改法 (去 Promise 参数) — fallback
 *     4. installConsoleHook 拦截 console.* — V2.x 实验证 Hermes release 仍 work (V4 V32.30 删错了)
 *
 * 🆕 V32.34 sendToServer (B方案核心):
 *   - V2.x 实战反证 14 天稳定: JS log → fetch POST → server log 业务 log 段
 *   - 完全不走 RN bridge, 不依赖 @ReactMethod 暴露
 *   - V2.x vivo server log 字串 `[千机:步骤1]` 走的就是 sendToServer 这条
 *
 * 已知:
 *   - 业务代码调 logger.* (V4 V32.18 已全仓批量替换 189 处 console.* → logger.*)
 *   - V4 logger.info/warn/error API 命名不变, 只改内部实现
 *   - V2.x sendToServer 同时给 V2.x 的 fetch 调用 - V4 直接复用
 */

import { NativeModules } from 'react-native';

const ZBBNative = (NativeModules as any).ZBBAutomation as
  | {
      writeBusinessLog(level: string, message: string): Promise<boolean>;
      triggerLogUploadNow(): Promise<boolean>;
    }
  | undefined;

type LogLevel = 'info' | 'success' | 'warn' | 'error';

/**
 * 取北京时间 HH:MM:SS (秒级) — V32.32 老板拍板双时间戳格式保留
 */
const getBjTime = (): string => {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });
};

/**
 * V32.32 格式化: [HH:MM:SS] [tag] message
 *   - [HH:MM:SS] 作为"是否 JS 端写盘"的诊断标记
 *   - metro log 自带 adb logcat 时间戳, 这个 [HH:MM:SS] 是给 server log 用的
 */
const format = (tag: string, msg: string): string => {
  return `[${getBjTime()}] [${tag}] ${msg}`;
};

/**
 * V32.34 B方案: 异步追加写业务日志到 Native (V2.x 设计)
 * - fire-and-forget, 不阻塞主流程
 * - V32.33 native writeBusinessLog 是 void fire-and-forget, 不返回 Promise
 *   - 但 JS 端仍用 await 调用, native 内部 sync 写盘
 */
async function appendToBusinessLog(level: LogLevel, line: string): Promise<void> {
  if (!ZBBNative || typeof ZBBNative.writeBusinessLog !== 'function') {
    // Native module 不可用 (debug + release 都可能踩 RN bridge 暴露坑)
    // 不 warning, 不报错 — V2.x 实战反证 silent fail 即可
    return;
  }
  try {
    // V32.33 native writeBusinessLog 是 void fire-and-forget, 但 JS 端 await 等同步返回
    // V2.x 实战反证: await Promise<void> 即使 native 不返回 Promise 也不会卡死
    await ZBBNative.writeBusinessLog(level, line);
  } catch (e) {
    // native write 失败 — 不静默, console.error 一份 + 后续走 sendToServer (双保险)
    console.error('[zbb-logger] writeBusinessLog failed:', e);
    sendToServerDirect(level, line + ' [FALLBACK: native write failed]');
  }
}

/**
 * 🆕 V32.34 B方案核心: sendToServer HTTP POST 链路
 * - V2.x 实战反证 14 天稳定 work
 * - 不依赖 RN bridge 暴露
 * - 走 EXPO_PUBLIC_BACKEND_BASE_URL 环境变量配置 server URL
 * - V4 仓新增: V32.18 V32.30 都没这链路, 是 JS log 上 server 的核心缺
 */
function sendToServer(level: LogLevel, message: string): void {
  sendToServerDirect(level, message);
}

function sendToServerDirect(level: LogLevel | string, message: string): void {
  // 🆕 V32.34 B方案修复: 跟 native LogUploadWorker 一致走 /log endpoint
  //  - V2.x AutomationLogger 写 /api/v1/logs (V2.x 仓 server 端是这个 endpoint)
  //  - V4 server 端 zbb_log_receiver.py 是 /log endpoint (跟 native LogUploadWorker 一致)
  //  - V4 logger sendToServer 必须走 /log, 否则 404
  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'https://desktop-hi4ajgj.taildab2db.ts.net';

  // 🆕 V32.34 B方案修复: server 端 /log 期望的字段格式 (跟 LogUploadWorker 一致)
  //  - device_id: 设备 serial
  //  - timestamp: ms
  //  - log: 完整 log 文本 (不是 message)
  //  - source: log source (qianji/yuexiu/baoli/orchestrator/business/js-direct)
  //  - app_version: 应用版本
  //  - user_id: 用户 ID (双层目录用)
  //  - heartbeat: 心跳 meta (JS 端不带)
  //  - seq/total_seq/terminal: 分片累积 (单 chunk default 0/1/True)
  const deviceId = 'QMF4C20528002273'; // V4 nova serial, hardcoded for now
  const userId = 'nova';
  const appVersion = '1.0.0';

  // 把 level + message 拼成 server 期望的 "log" 字段 (跟 native LogUploadWorker + BusinessLogWriter 格式一致)
  //  native BusinessLogWriter 格式: "2026/08/30 10:30:00 [INFO   ] message\n"
  //  - DATE_FMT_LINE = "yyyy/MM/dd HH:mm:ss" (Locale.CHINA)
  //  - levelShort = level.uppercase().padEnd(7) (e.g. "INFO   ", "WARN   ", "ERROR  ")
  const now = new Date();
  const ts =
    `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ` +
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const levelShort = level.toUpperCase().padEnd(7);
  // 单行清洗: 把 \r\n 替换成转义字符 (跟 native 一致, 防一行变多行破坏 incremental upload)
  const safeMsg = message.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  const logText = `${ts} [${levelShort}] ${safeMsg}\n`;

  fetch(`${baseUrl}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceId,
      user_id: userId,
      app_version: appVersion,
      source: 'js-direct',
      timestamp: Date.now(),
      seq: 0,
      total_seq: 1,
      terminal: true,
      is_new_data: true,
      log: logText,
    }),
  }).catch(() => {
    // 静默失败, 不影响主流程 (V2.x 设计)
  });
}

/**
 * 🆕 V32.34 B方案: 安全的 stringify (V2.x 设计, 防循环引用)
 */
function safeStringify(o: unknown): string {
  if (typeof o === 'string') return o;
  if (o === null) return 'null';
  if (o === undefined) return 'undefined';
  try {
    return JSON.stringify(o);
  } catch {
    return String(o);
  }
}

/**
 * 🆕 V32.34 B方案: 全局 console hook (V2.x 实战反证, Hermes release 仍 work)
 * - V2.x vivo 14 天实战反证: installConsoleHook + Hermes release = console.log/warn/error 仍被拦截
 * - V4 V32.30 commit 删 console hook 的理由 "Hermes release 替换 console 对象" 错了
 * - B方案恢复 console hook, 防止漏网之鱼 (业务代码直接 console.log)
 */
const originalLog = console.log.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);
const originalInfo = console.info.bind(console);
const originalDebug = console.debug.bind(console);

function installConsoleHook() {
  // 只装一次
  if ((globalThis as any).__zbbConsoleHooked) return;
  (globalThis as any).__zbbConsoleHooked = true;

  console.log = (...args: unknown[]) => {
    originalLog(...args);
    void appendToBusinessLog('info', args.map(safeStringify).join(' '));
    sendToServer('info', args.map(safeStringify).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    void appendToBusinessLog('warn', args.map(safeStringify).join(' '));
    sendToServer('warn', args.map(safeStringify).join(' '));
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    void appendToBusinessLog('error', args.map(safeStringify).join(' '));
    sendToServer('error', args.map(safeStringify).join(' '));
  };
  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    void appendToBusinessLog('info', args.map(safeStringify).join(' '));
    sendToServer('info', args.map(safeStringify).join(' '));
  };
  console.debug = (...args: unknown[]) => {
    originalDebug(...args);
    void appendToBusinessLog('info', args.map(safeStringify).join(' '));
    sendToServer('info', args.map(safeStringify).join(' '));
  };
}

installConsoleHook();

/**
 * 🆕 V32.34 B方案核心: logToBoth (V2.x 设计, 3 路并打)
 * - 1. console.log (debug 用)
 * - 2. sendToServer HTTP POST (V2.x 主链路, 不依赖 RN bridge)
 * - 3. appendToBusinessLog native writeBusinessLog (fallback)
 */
function logToBoth(level: LogLevel, line: string): void {
  // 1. 输出到控制台
  const prefix = getPrefix(level);
  switch (level) {
    case 'warn':
      originalWarn(`${prefix} ${line}`);
      break;
    case 'error':
      originalError(`${prefix} ${line}`);
      break;
    case 'success':
      originalLog(`${prefix} ${line}`);
      break;
    default:
      originalLog(`${prefix} ${line}`);
  }

  // 2. 发送到服务端日志 (best-effort)
  sendToServer(level, line);

  // 3. 追加到本地业务日志文件 (fire-and-forget)
  void appendToBusinessLog(level, line);
}

/**
 * V32.32 老板拍板 level 前缀
 */
function getPrefix(level: LogLevel): string {
  switch (level) {
    case 'success':
      return '✅';
    case 'warn':
      return '⚠️';
    case 'error':
      return '❌';
    default:
      return '📋';
  }
}

/**
 * 调试用: 手动触发 LogUploadWorker (Native 端提供)
 */
export function triggerLogUploadNow(): void {
  if (ZBBNative && typeof ZBBNative.triggerLogUploadNow === 'function') {
    ZBBNative.triggerLogUploadNow().catch(() => {});
  }
}

/**
 * V4 logger API (V32.18 全仓替换 189 处 console.* → logger.* 的命名保持不变)
 * - 内部实现走 logToBoth (V2.x 3 路并打设计)
 */
export const logger = {
  info: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    logToBoth('info', line);
  },
  success: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    logToBoth('success', line);
  },
  warn: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    logToBoth('warn', line);
  },
  error: (tag: string, msg: string): void => {
    const line = format(tag, msg);
    logToBoth('error', line);
  },
};

export default logger;