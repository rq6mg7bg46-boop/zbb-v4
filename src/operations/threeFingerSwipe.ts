/**
 * V4.x threeFingerSwipe operation (老板实战反证金标准 08-22)
 *
 * V2.x v22.02.30 老板实战反证金标准补丁: 三指下滑触发系统截图
 * - down(startY, endY, duration)    单次三指下滑
 * - multiStage(stages, gapMs)        多阶段三指手势 (V22.02.30)
 * - byKeyevent(keyCode1, keyCode2)   按键触发 (V22.02.30)
 * - bySendevent(path, kc1, kc2, gap)  sendevent 触发 (V22.02.30)
 *
 * 业务流程:
 *   import { threeFingerSwipe } from '@/operations/threeFingerSwipe';
 *   await threeFingerSwipe.down(); // 默认从屏幕顶部滑到底部
 */

import { ZBBAutomation } from '@/native';

const DEFAULT_START_Y = 500;
const DEFAULT_END_Y = 1500;
const DEFAULT_DURATION = 100;

/**
 * 三指下滑 (单次, 默认参数)
 */
export async function down(
  startY: number = DEFAULT_START_Y,
  endY: number = DEFAULT_END_Y,
  duration: number = DEFAULT_DURATION,
): Promise<boolean> {
  return ZBBAutomation.threeFingerSwipeDown(startY, endY, duration);
}

/**
 * 多阶段三指手势 (V22.02.30 老板实战反证金标准)
 * stages: [[手指1角度, 手指2角度, 手指3角度], ...]
 */
export async function multiStage(
  stages: [number, number, number][],
  stageGapMs: number = 50,
): Promise<boolean> {
  return ZBBAutomation.threeFingerMultiStageGesture(stages, stageGapMs);
}

/**
 * 按键触发三指截图 (V22.02.30)
 */
export async function byKeyevent(
  keyCode1: number,
  keyCode2: number,
): Promise<boolean> {
  return ZBBAutomation.screenshotByKeyevent(keyCode1, keyCode2);
}

/**
 * sendevent 触发 (V22.02.30, 终极方案)
 */
export async function bySendevent(
  eventPath: string,
  keyCode1: number,
  keyCode2: number,
  gapMs: number = 5,
): Promise<boolean> {
  return ZBBAutomation.screenshotBySendevent(eventPath, keyCode1, keyCode2, gapMs);
}

/**
 * 触发截图 (优先用 multiStage, 失败 fallback 到 down)
 */
export async function triggerScreenshot(): Promise<boolean> {
  // 1. 试 multiStage (V22.02.30 老板实战反证金标准)
  const ok1 = await multiStage([
    [0, 1000, 2000],
    [0, 1000, 2000],
  ], 30);
  if (ok1) return true;

  // 2. fallback 到简单三指下滑
  return down();
}

export const threeFingerSwipe = {
  down,
  multiStage,
  byKeyevent,
  bySendevent,
  triggerScreenshot,
};
export default threeFingerSwipe;
