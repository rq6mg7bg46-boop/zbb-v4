/**
 * Device Profile (老板实战反证金标准 08-23 拍板 V4 跨机型适配)
 *
 * 复刻 V2.x src/config/DeviceProfile.ts:
 * - nova 7 5G (480 dpi, 1dp = 3px) - 老板真机
 * - vivo V2166A (320 dpi, 1dp = 2px) - 老板家里旧机
 * - generic 兜底 (用 RN runtime 实时查询)
 *
 * 业务代码用 dp 写坐标, DpUtil.px(dp) 自动按机型转换
 *
 * 实战反证金标准 08-23: V4.x 跨机型适配 (老板拍板方案)
 * V4.x 第一次支持 nova + vivo 双机型 (V3.x 只支持 nova)
 */

import { PixelRatio, Dimensions, Platform } from 'react-native';

export interface DeviceProfile {
  name: string;
  modelId: string;
  screenWidthPx: number;
  screenHeightPx: number;
  densityDpi: number;
  pixelRatio: number;
  screenWidthDp: number;
  screenHeightDp: number;
  appHeightPx: number;
  appHeightDp: number;
  cutoutTopHeightPx: number;
  cutoutTopHeightDp: number;
  cutoutWidthPx: number;
  pageLoadDelayMs: number;
  retryBaseDelayMs: number;
  retryMaxAttempts: number;
  navBarRecentsXDp: number;
  navBarRecentsYDp: number;
  recentsClearAllXDp: number;
  recentsClearAllYDp: number;
  navBarHomeXDp: number;
  navBarHomeYDp: number;
  navBarBackXDp: number;
  navBarBackYDp: number;
}

/**
 * nova 7 5G (老板真机) - 480 dpi, 1dp = 3px
 */
const NOVA_7_5G: DeviceProfile = {
  name: 'nova 7 5G',
  modelId: 'JEF-AN00',
  screenWidthPx: 1080,
  screenHeightPx: 2400,
  densityDpi: 480,
  pixelRatio: 3,
  screenWidthDp: 360,
  screenHeightDp: 800,
  appHeightPx: 2153,
  appHeightDp: 717,
  cutoutTopHeightPx: 247,
  cutoutTopHeightDp: 82,
  cutoutWidthPx: 131,
  pageLoadDelayMs: 1000,
  retryBaseDelayMs: 1500,
  retryMaxAttempts: 5,
  navBarRecentsXDp: 100,
  navBarRecentsYDp: 767,
  recentsClearAllXDp: 180,
  recentsClearAllYDp: 717,
  navBarHomeXDp: 180,
  navBarHomeYDp: 767,
  navBarBackXDp: 20,
  navBarBackYDp: 767,
};

/**
 * vivo V2166A (老板家里旧机) - 320 dpi, 1dp = 2px
 */
const VIVO_V2166A: DeviceProfile = {
  name: 'vivo V2166A',
  modelId: 'V2166A',
  screenWidthPx: 720,
  screenHeightPx: 1600,
  densityDpi: 320,
  pixelRatio: 2,
  screenWidthDp: 360,
  screenHeightDp: 800,
  appHeightPx: 1480,
  appHeightDp: 740,
  cutoutTopHeightPx: 120,
  cutoutTopHeightDp: 60,
  cutoutWidthPx: 0,
  pageLoadDelayMs: 3000,
  retryBaseDelayMs: 2500,
  retryMaxAttempts: 5,
  navBarRecentsXDp: 100,
  navBarRecentsYDp: 779,
  recentsClearAllXDp: 270,
  recentsClearAllYDp: 723,
  navBarHomeXDp: 180,
  navBarHomeYDp: 779,
  navBarBackXDp: 255,
  navBarBackYDp: 779,
};

function buildGenericProfile(): DeviceProfile {
  const { width, height } = Dimensions.get('window');
  const ratio = PixelRatio.get();
  const dpi = ratio * 160;
  const cutoutDp = 50;
  return {
    name: 'generic',
    modelId: Platform.OS === 'android' ? 'unknown' : 'ios',
    screenWidthPx: Math.round(width * ratio),
    screenHeightPx: Math.round(height * ratio),
    densityDpi: dpi,
    pixelRatio: ratio,
    screenWidthDp: Math.round(width),
    screenHeightDp: Math.round(height),
    appHeightPx: Math.round((height - cutoutDp) * ratio),
    appHeightDp: Math.round(height - cutoutDp),
    cutoutTopHeightPx: Math.round(cutoutDp * ratio),
    cutoutTopHeightDp: cutoutDp,
    cutoutWidthPx: 0,
    pageLoadDelayMs: 1500,
    retryBaseDelayMs: 2000,
    retryMaxAttempts: 5,
    navBarRecentsXDp: 100,
    navBarRecentsYDp: 767,
    recentsClearAllXDp: 180,
    recentsClearAllYDp: 717,
    navBarHomeXDp: 180,
    navBarHomeYDp: 767,
    navBarBackXDp: 20,
    navBarBackYDp: 767,
  };
}

const PROFILES: Record<string, DeviceProfile> = {
  'JEF-AN00': NOVA_7_5G,
  'nova 7 5G': NOVA_7_5G,
  'V2166A': VIVO_V2166A,
  'vivo V2166A': VIVO_V2166A,
};

let cached: DeviceProfile | null = null;

export function getDeviceProfile(): DeviceProfile {
  if (cached) return cached;
  let detected: DeviceProfile | null = null;
  if (Platform.OS === 'android') {
    const modelId = (Platform as any).constants?.Model || (Platform as any).constants?.Brand;
    if (modelId && PROFILES[modelId]) detected = PROFILES[modelId];
    if (!detected) {
      const { width, height } = Dimensions.get('window');
      const ratio = PixelRatio.get();
      const wpx = Math.round(width * ratio);
      const hpx = Math.round(height * ratio);
      if (wpx === 1080 && hpx === 2400 && ratio === 3) detected = NOVA_7_5G;
      else if (wpx === 720 && hpx === 1600 && ratio === 2) detected = VIVO_V2166A;
    }
  }
  cached = detected || buildGenericProfile();
  return cached;
}

export function resetDeviceProfileCache(): void {
  cached = null;
}