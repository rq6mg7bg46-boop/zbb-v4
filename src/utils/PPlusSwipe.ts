/**
 * V32.36.11 P+ 拟人化上滑/下滑工具 (09-02 老板反证金标准)
 *
 * V2.x 反证 client/services/BaoliService.ts L178-189 (humanSwipeWithBounceDp):
 *   - 接收 dp 坐标, 自动转 px (跨机型适配)
 *   - 多滑 20px X, 30px Y (手指惯性 overshoot)
 *   - delay(200ms)
 *   - 回弹 20px X, 30px Y (300ms 慢速, 拟人化)
 *   - 用 zbbAutomation.swipe (= AccessibilityService.dispatchGesture)
 *
 * V4 V32.36.10 bug 老板现场反证:
 *   - V4 用 swipeShell (input swipe), V2.x v22.02.30 用 swipe (dispatchGesture)
 *   - V2.x v22.x 老板实测 swipe 在企微工作台 OK
 *   - V4 老板实测 swipeShell 在企微工作台 失败
 *   - 改回 swipe (V2.x 同款)
 *
 * 区别 (老板反证金标准):
 *   - V4 swipeShell = Runtime.exec("input swipe x1 y1 x2 y2 ms") - 走 shell input 通道
 *   - V2.x swipe = AccessibilityService.dispatchGesture(gesture) - 走 A11y 通道
 *   - V2.x 在 v22.02.30 老板装机实测 swipe 在企微可上滑
 *   - V4 V32.36.10 老板实测 swipeShell 在企微不能上滑 (?)
 *   - 推测: nova 7 5G EMUI 10 system shell input swipe 被 EMUI security 拦截了
 *
 * 修法 (V32.36.11 老板 09-02 拍板): 改回 V2.x swipe + P+ 拟人化
 */

import { ZBBAutomation } from '@/native';
import { px, centerXDp, screenHeightDp, screenWidthDp } from '@/utils/DpUtil';
import { logger } from '@/utils/logger';

/**
 * P+ 拟人化上滑/下滑 (V2.x humanSwipeWithBounceDp 反证金标准)
 *
 * @param startXDp 起点 X (dp)
 * @param startYDp 起点 Y (dp)
 * @param endXDp 终点 X (dp)
 * @param endYDp 终点 Y (dp)
 * @param duration 主滑时长 (ms, 默认 500 越秀速度)
 *
 * 行为:
 *   1. swipe(x1Px, y1Px, x2Px+20, y2Px-30, duration)  ← 多滑 20px/30px 惯性 overshoot
 *   2. delay(200ms)                                    ← 等惯性
 *   3. swipe(x2Px+20, y2Px-30, x2Px, y2Px, 300ms)      ← 回弹 (300ms 慢速)
 */
export async function humanSwipeWithBounceDp(
  startXDp: number,
  startYDp: number,
  endXDp: number,
  endYDp: number,
  duration: number = 500
): Promise<boolean> {
  const x1Px = px(startXDp);
  const y1Px = px(startYDp);
  const x2Px = px(endXDp);
  const y2Px = px(endYDp);

  logger.info(
    'PPlusSwipe',
    `humanSwipeWithBounceDp: (${startXDp},${startYDp})dp → (${endXDp},${endYDp})dp duration=${duration}ms`
  );

  // 第 1 段: 主滑 + 惯性 overshoot (20px X, 30px Y)
  const swipe1Ok = await ZBBAutomation.swipe(x1Px, y1Px, x2Px + 20, y2Px - 30, duration);
  await ZBBAutomation.delay(200);

  // 第 2 段: 回弹 (300ms 慢速, 拟人化)
  const swipe2Ok = await ZBBAutomation.swipe(x2Px + 20, y2Px - 30, x2Px, y2Px, 300);

  logger.info('PPlusSwipe', `swipe1=${swipe1Ok}, swipe2=${swipe2Ok}`);
  return swipe1Ok && swipe2Ok;
}

/**
 * 屏幕中心上滑 (V2.x BaoliService L628 步骤3 金标准)
 * - 起点: 屏幕中心 X, 屏下 84% Y
 * - 终点: 屏幕中心 X, 屏上 28% Y
 * - duration 500ms (越秀速度)
 *
 * V2.x 反证: 起点 Y = appHeightDp() * 0.84, 终点 Y = appHeightDp() * 0.28
 */
export async function scrollUpPPlus(): Promise<boolean> {
  return humanSwipeWithBounceDp(
    centerXDp(),
    Math.round(screenHeightDp() * 0.84),
    centerXDp(),
    Math.round(screenHeightDp() * 0.28),
    500
  );
}

/**
 * 屏幕中心下滑 (V2.x BaoliService 步骤 16 截图前下滑 金标准)
 * - 起点: 屏幕中心 X, 屏上 28% Y
 * - 终点: 屏幕中心 X, 屏下 84% Y
 * - duration 500ms
 */
export async function scrollDownPPlus(): Promise<boolean> {
  return humanSwipeWithBounceDp(
    centerXDp(),
    Math.round(screenHeightDp() * 0.28),
    centerXDp(),
    Math.round(screenHeightDp() * 0.84),
    500
  );
}

/**
 * 拟人化随机延迟 (V2.x pGammaDelay 反证金标准)
 * - 范围 2000-2500ms (V2.x 步骤3 实战)
 * - 模拟用户操作间隔 (给企微/千机 WebView 渲染时间)
 */
export async function pPlusDelay(minMs: number = 2000, rangeMs: number = 500): Promise<void> {
  const wait = minMs + Math.floor(Math.random() * rangeMs);
  logger.info('PPlusSwipe', `pPlusDelay: ${wait}ms`);
  await ZBBAutomation.delay(wait);
}

// 默认导出 (V2.x 反证兼容)
export const pPlus = {
  humanSwipeWithBounceDp,
  scrollUp: scrollUpPPlus,
  scrollDown: scrollDownPPlus,
  delay: pPlusDelay,
};

export default pPlus;