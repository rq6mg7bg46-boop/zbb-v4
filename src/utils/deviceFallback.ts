/**
 * 设备机型 fallback 坐标表 (08-26 老板拍板 方案 T5)
 *
 * 用途: 当 a11y.findByText 找不到节点 (mock 渲染 bug) 时,
 *       按 BuildConfig.MODEL 选对应坐标直接点击
 *
 * 实战:
 *   - 真千机 (生产): 走 a11y (无需 fallback)
 *   - nova (mock 测试): 找不到时用 fallback 坐标
 *
 * 老板拍板: mock 坐标 (530, 2220) px @ density 480
 *   - 530 px / 3 = 176.67 ≈ 177 dp
 *   - 2220 px / 3 = 740 dp
 *
 * 真千机基准 (002.xml): (360, 1426) px @ density 320
 *   - 360 px / 2 = 180 dp
 *   - 1426 px / 2 = 713 dp
 */
import { NativeModules } from 'react-native';

export interface DeviceFallbackCoords {
  forwardBtn: { x: number; y: number };      // "转发" 按钮
  copyBtn: { x: number; y: number };          // "复制" 按钮
  description: string;                       // 设备描述
}

// 老板拍板坐标表 (按 px, 实际使用按设备 density 缩放)
// key = appEnv ('mock' / 'production')
const FALLBACK_TABLE_PX: Record<string, Omit<DeviceFallbackCoords, 'description'> & { desc: string }> = {
  // mock (nova 测试) - 1080x2400, density 480
  // 老板 08-26 拍板:
  //   - mock 转发按钮 (530, 2220) px = (177, 740) dp
  //   - mock 复制按钮 (540, 1986) px = (180, 662) dp
  mock: {
    forwardBtn: { x: 530, y: 2220 },
    copyBtn: { x: 540, y: 1986 },
    desc: 'mock (nova 测试)',
  },
  // 真千机基准 - 720x1473, density 320 (e470 老板拍板)
  // 002.xml bounds=[40,1380][680,1473] → 中心 (360, 1426) px = (180, 713) dp
  production: {
    forwardBtn: { x: 360, y: 1426 },
    copyBtn: { x: 360, y: 1426 }, // 真千机转发提交后弹层, 复制在弹层中央
    desc: '真千机 (生产)',
  },
};

/**
 * 按 appEnv 查 fallback 坐标
 * 找不到对应 appEnv → 返回 null (走 raiseAlert, 不硬点)
 */
export function getDeviceFallbackCoords(): DeviceFallbackCoords | null {
  const buildConstants = NativeModules.ZBBAutomation?.getConstants?.() ?? {};
  const appEnv = buildConstants.appEnv ?? 'production';
  const density = buildConstants.DENSITY ?? 320; // 默认 320 (xhdpi)

  const entry = FALLBACK_TABLE_PX[appEnv];
  if (!entry) {
    console.warn(`[deviceFallback] appEnv=${appEnv} 无 fallback 坐标表`);
    return null;
  }

  // px → dp 转换 (density / 160 是 dpi 倍率)
  const scale = density / 160;
  const convert = (px: { x: number; y: number }) => ({
    x: Math.round(px.x / scale),
    y: Math.round(px.y / scale),
  });

  console.log(`[deviceFallback] appEnv=${appEnv} density=${density} scale=${scale.toFixed(2)}: ${entry.desc}`);
  console.log(`[deviceFallback] 转发按钮 fallback 坐标 dp=(${convert(entry.forwardBtn).x}, ${convert(entry.forwardBtn).y})`);

  return {
    forwardBtn: convert(entry.forwardBtn),
    copyBtn: convert(entry.copyBtn),
    description: entry.desc,
  };
}
