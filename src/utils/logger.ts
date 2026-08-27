/**
 * V4.x 统一 log 工具 (08-27 老板拍板加时间戳)
 *
 * 格式: [HH:MM:SS] [tag] message
 * 时区: Asia/Shanghai (北京时间)
 * 输出: 走 console.log/warn/error, metro Reload 可见
 *
 * 老板要求 (08-27):
 *   - V2.x 回传日志有时间, V4 metro 没有 → 补齐
 *   - 格式: HH:MM:SS 秒级
 *   - 时区: 北京时间
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

export const logger = {
  info: (tag: string, msg: string): void => {
    console.log(format(tag, msg));
  },
  warn: (tag: string, msg: string): void => {
    console.warn(format(tag, msg));
  },
  error: (tag: string, msg: string): void => {
    console.error(format(tag, msg));
  },
};

export default logger;
