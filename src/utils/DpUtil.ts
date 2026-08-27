/**
 * DP 工具 (老板实测 08-23 拍板 V4 跨机型适配)
 *
 * 复刻 V2.x src/utils/DpUtil.ts:
 * - 业务代码用 dp 写坐标
 * - px(dp) 自动按 DeviceProfile.pixelRatio 转换
 * - nova 7 5G (480dpi) 1dp=3px, vivo V2166A (320dpi) 1dp=2px
 *
 * 用法:
 *   import { px, screenHeightDp, centerXDp, getDeviceProfile } from '@/utils/DpUtil';
 *
 *   // 旧: await ZBBAutomation.swipe(540, 1500, 540, 800, 500);  // nova px 硬编码
 *   // 新: await ZBBAutomation.swipe(px(180), px(500), px(180), px(267), 500);  // 跨机型
 *
 * 实测 08-23:
 * - click / longPress / swipe 全部接受 px 入参 (业务代码转 dp 后再传)
 * - native 返回的坐标 (centerX/Y) 是 px, 直接用
 */

import { getDeviceProfile } from '@/config/DeviceProfile';

export function px(dpValue: number): number {
  return Math.round(dpValue * getDeviceProfile().pixelRatio);
}

export function dp(pxValue: number): number {
  return Math.round(pxValue / getDeviceProfile().pixelRatio);
}

export function screenWidthDp(): number {
  return getDeviceProfile().screenWidthDp;
}

export function screenHeightDp(): number {
  return getDeviceProfile().screenHeightDp;
}

export function appHeightDp(): number {
  return getDeviceProfile().appHeightDp;
}

export function centerXDp(): number {
  return Math.round(screenWidthDp() / 2);
}

export function centerYDp(): number {
  return Math.round(screenHeightDp() / 2);
}

export function navBarRecentsDp(): { x: number; y: number } {
  const p = getDeviceProfile();
  return { x: p.navBarRecentsXDp, y: p.navBarRecentsYDp };
}

export function navBarHomeDp(): { x: number; y: number } {
  const p = getDeviceProfile();
  return { x: p.navBarHomeXDp, y: p.navBarHomeYDp };
}

export function navBarBackDp(): { x: number; y: number } {
  const p = getDeviceProfile();
  return { x: p.navBarBackXDp, y: p.navBarBackYDp };
}

export function recentsClearAllDp(): { x: number; y: number } {
  const p = getDeviceProfile();
  return { x: p.recentsClearAllXDp, y: p.recentsClearAllYDp };
}

export function getRetryMaxAttempts(): number {
  return getDeviceProfile().retryMaxAttempts;
}

export function getRetryBaseDelayMs(): number {
  return getDeviceProfile().retryBaseDelayMs;
}

export function getPageLoadDelayMs(): number {
  return getDeviceProfile().pageLoadDelayMs;
}