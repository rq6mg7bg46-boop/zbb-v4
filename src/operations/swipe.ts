/**
 * V4.x 单指上下滑 operation (08-25 老板拍板 B 方案: 文档步骤2a + 步骤3a)
 *
 * 文档实测:
 *   - 千机端步骤2a: "下滑1次 (调用'下滑'方法) 刷新"
 *   - 千机端步骤3a: "上滑1次 (调用'上滑'方法)"
 *
 * API:
 *   - swipeUp(distancePx?)     上滑 N 像素 (默认 600px)
 *   - swipeDown(distancePx?)   下滑 N 像素
 *   - swipeUpByDp(dp)          上滑 N dp (跨机型适配)
 *   - swipeDownByDp(dp)        下滑 N dp
 *
 * 实现: 用 native swipe() (单指,跟三指下滑区分)
 *
 * 注意: V4.x native 已有 scrollUp/scrollDown, 但那是 hardcoded 距离, 不灵活
 *       本文件提供 distancePx/Dp 参数化的上下滑
 */

import { ZBBAutomation } from '@/native';
import { logger } from '@/utils/logger';

const DEFAULT_DISTANCE_PX = 600;
const DEFAULT_DURATION_MS = 300;

/**
 * 上滑 N 像素 (从屏幕中部往下滑, 让下方内容滚到上方)
 *
 * @param distancePx 滑动距离 (px), 默认 600
 * @param durationMs 滑动时长 (ms), 默认 300
 */
export async function swipeUp(distancePx: number = DEFAULT_DISTANCE_PX, durationMs: number = DEFAULT_DURATION_MS): Promise<boolean> {
  // 起点: 屏幕中部偏下, 终点: 起点 - distancePx
  const startX = 540;  // nova 7 5G 屏幕宽度 1080/2 = 540
  const startY = 1500; // nova 屏幕中部偏下
  const endY = Math.max(100, startY - distancePx);

  logger.info('swipe', `swipeUp: (${startX},${startY}) → (${startX},${endY}) 距离=${distancePx}px 时长=${durationMs}ms`);
  return ZBBAutomation.swipe(startX, startY, startX, endY, durationMs);
}

/**
 * 下滑 N 像素 (从屏幕中部往下滑, 让上方内容滚到下方)
 */
export async function swipeDown(distancePx: number = DEFAULT_DISTANCE_PX, durationMs: number = DEFAULT_DURATION_MS): Promise<boolean> {
  const startX = 540;
  const startY = 500; // nova 屏幕中部偏上
  const endY = Math.min(2200, startY + distancePx);

  logger.info('swipe', `swipeDown: (${startX},${startY}) → (${startX},${endY}) 距离=${distancePx}px 时长=${durationMs}ms`);
  return ZBBAutomation.swipe(startX, startY, startX, endY, durationMs);
}

/**
 * 上滑 N dp (跨机型适配, nova 1dp=3px / vivo 1dp=2px)
 */
export async function swipeUpByDp(dp: number = 200, durationMs: number = DEFAULT_DURATION_MS): Promise<boolean> {
  // 老板实测 08-23 V4.x 跨机型 dp 适配
  const { px } = await import('../utils/DpUtil');
  return swipeUp(px(dp), durationMs);
}

/**
 * 下滑 N dp (跨机型适配)
 */
export async function swipeDownByDp(dp: number = 200, durationMs: number = DEFAULT_DURATION_MS): Promise<boolean> {
  const { px } = await import('../utils/DpUtil');
  return swipeDown(px(dp), durationMs);
}

/**
 * 单指上下滑 operations 命名空间 (08-25 老板拍板 B 方案)
 */
export const swipe = {
  up: swipeUp,
  down: swipeDown,
  upByDp: swipeUpByDp,
  downByDp: swipeDownByDp,
};

export default swipe;