/**
 * V4.x pressKey operation (老板实战反证金标准 08-22)
 *
 * 系统按键封装:
 * - back()       点击返回键
 * - home()       点击 Home 键
 * - recent()     点击多功能键 (最近任务)
 * - trash()      点击垃圾箱 (清后台 = back 多次 + home)
 *
 * 业务流程:
 *   import { pressKey } from '@/operations/pressKey';
 *   await pressKey.back();
 */

import { ZBBAutomation } from '@/native';

/**
 * 点击返回键
 */
export async function back(): Promise<boolean> {
  return ZBBAutomation.pressBack();
}

/**
 * 点击 Home 键
 */
export async function home(): Promise<boolean> {
  return ZBBAutomation.pressHome();
}

/**
 * 点击多功能键 (最近任务)
 */
export async function recent(): Promise<boolean> {
  return ZBBAutomation.pressRecentApps();
}

/**
 * 点击"垃圾箱" = 清空最近任务
 * 实现: pressRecent → 等 1s → pressHome
 * (原生没 pressTrash method, 通过 recent + home 组合实现)
 */
export async function trash(): Promise<boolean> {
  const ok1 = await ZBBAutomation.pressRecentApps();
  if (!ok1) return false;
  await ZBBAutomation.delay(1000);
  return ZBBAutomation.pressHome();
}

export const pressKey = { back, home, recent, trash };
export default pressKey;
