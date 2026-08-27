/**
 * 拟人化坐标偏移 (老板实测 08-23 拍板)
 *
 * 老板 08-23 实测:
 * - vivo V2166A y=-5 偏移超 ±2 阈值 → 老代码 Math.round(Math.random() * 10 - 5)
 *   = -5..+5 (11 个值) 实测导致命中失败
 * - 修法: Math.round(Math.random() * 4 - 2) = -2..+2 (5 个值: -2, -1, 0, 1, 2)
 *
 * 3 档 (老板 08-23 拍板):
 * - PRECISE = 档1 = ±2 / ±2 (默认, V2.x 实测)
 * - NORMAL = 档2 = ±5 / ±5 (V2.x 老代码默认)
 * - WIDE = 档3 = ±10 / ±5 (X 宽 Y 窄, 大按钮)
 *
 * 用法:
 *   import { HumanLevel, applyHumanOffset } from '@/utils/HumanOffset';
 *   const { x, y } = applyHumanOffset(540, 1100, HumanLevel.PRECISE);
 *   await ZBBAutomation.click(x, y);
 */

export enum HumanLevel {
  PRECISE = 'precise', // ±2 / ±2 默认
  NORMAL = 'normal',   // ±5 / ±5
  WIDE = 'wide',       // ±10 / ±5 (X 宽 Y 窄)
}

const OFFSET_RANGES: Record<HumanLevel, { xMax: number; yMax: number }> = {
  [HumanLevel.PRECISE]: { xMax: 2, yMax: 2 },
  [HumanLevel.NORMAL]: { xMax: 5, yMax: 5 },
  [HumanLevel.WIDE]: { xMax: 10, yMax: 5 },
};

/**
 * 加拟人化偏移 (单位 px)
 * @param x  原 x (px)
 * @param y  原 y (px)
 * @param level 档位 (默认 PRECISE)
 * @returns {x, y} 加偏移后的坐标
 */
export function applyHumanOffset(
  x: number,
  y: number,
  level: HumanLevel = HumanLevel.PRECISE,
): { x: number; y: number } {
  const range = OFFSET_RANGES[level];
  // 5 个值: -range, -range/2, 0, +range/2, +range (xMax=2 → -2,-1,0,1,2)
  const dx = Math.round((Math.random() * 2 - 1) * range.xMax);
  const dy = Math.round((Math.random() * 2 - 1) * range.yMax);
  // 老板实测 08-24: logcat 打印偏移量, 老板 nova 实测能看到
  console.log(`[humanOffset] level=${level} (${x},${y}) → (${x + dx},${y + dy}) dx=${dx} dy=${dy}`);
  return { x: Math.round(x + dx), y: Math.round(y + dy) };
}