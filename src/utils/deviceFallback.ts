/**
 * 设备机型 fallback 坐标表 (08-26 老板拍板 方案 T5)
 *
 * 用途: 当 a11y.findByText 找不到节点 (mock 渲染 bug) 时,
 *       按 appEnv 选对应坐标直接点击
 *
 * 设计:
 *   - 坐标表存 dp (老板按 dp 计算, 跨机型通用)
 *   - 运行时按 PixelRatio 换 px, native tap 接收 px
 *   - 真千机 (生产): 走 a11y (无需 fallback)
 *   - nova (mock 测试): 找不到时用 fallback 坐标
 *
 * 老板拍板:
 *   - mock 转发按钮 (180, 740) dp = (540, 2220) px @ nova (3x)
 *   - mock 复制按钮 (180, 662) dp = (540, 1986) px @ nova (3x)
 *   - 真千机基准 (002.xml) (180, 713) dp = (360, 1426) px @ 真千机 (2x)
 */
import { loadAppEnv } from '@/config/env';
import { PixelRatio } from 'react-native';

export interface DeviceFallbackCoords {
  forwardBtn: { x: number; y: number };      // "转发" 按钮 (dp)
  copyBtn: { x: number; y: number };          // "复制" 按钮 (dp)
  description: string;                       // 设备描述
}

// 老板拍板坐标表 (存 dp, 运行时按 PixelRatio 换 px)
// key = appEnv ('mock' / 'production')
const FALLBACK_TABLE_DP: Record<string, Omit<DeviceFallbackCoords, 'description'> & { desc: string }> = {
  // mock (nova 测试) - 老板拍板 dp 坐标
  //   - 转发按钮 (180, 740) dp = (540, 2220) px @ 3x
  //   - 复制按钮 (180, 662) dp = (540, 1986) px @ 3x
  mock: {
    forwardBtn: { x: 180, y: 740 },
    copyBtn: { x: 180, y: 662 },
    desc: 'mock (nova 测试)',
  },
  // 真千机基准 - 002.xml bounds=[40,1380][680,1473] → 中心 (180, 713) dp @ 2x
  production: {
    forwardBtn: { x: 180, y: 713 },
    copyBtn: { x: 180, y: 713 }, // 真千机转发提交后弹层, 复制在弹层中央
    desc: '真千机 (生产)',
  },
};

/**
 * 异步查 fallback 坐标 (返回 dp, 调用方用 PixelRatio 换 px)
 * 找不到对应 appEnv → 返回 null (走 raiseAlert, 不硬点)
 */
export async function getDeviceFallbackCoords(): Promise<DeviceFallbackCoords | null> {
  // 用 loadAppEnv (跟 env.ts 一致, 读 assets/env.json)
  let appEnv: string;
  try {
    const env = await loadAppEnv();
    appEnv = env.appEnv;
  } catch (e) {
    console.warn(`[deviceFallback] loadAppEnv 失败, 用 production:`, e);
    appEnv = 'production';
  }

  const entry = FALLBACK_TABLE_DP[appEnv];
  if (!entry) {
    console.warn(`[deviceFallback] appEnv=${appEnv} 无 fallback 坐标表`);
    return null;
  }

  // 显示 px 换算 (老板需要看到实际 px 值)
  const scale = PixelRatio.get();
  const dpi = Math.round(160 * scale);
  console.log(`[deviceFallback] appEnv=${appEnv} density=${dpi} scale=${scale.toFixed(2)}: ${entry.desc}`);
  console.log(`[deviceFallback] 转发按钮 fallback 坐标 dp=(${entry.forwardBtn.x}, ${entry.forwardBtn.y}) → px=(${Math.round(entry.forwardBtn.x * scale)}, ${Math.round(entry.forwardBtn.y * scale)})`);

  return {
    forwardBtn: entry.forwardBtn,
    copyBtn: entry.copyBtn,
    description: entry.desc,
  };
}

/**
 * dp → px 转换 (供 qianji.ts 调用 click.byCoords 前用)
 */
export function dpToPx(dp: { x: number; y: number }): { x: number; y: number } {
  const scale = PixelRatio.get();
  return {
    x: Math.round(dp.x * scale),
    y: Math.round(dp.y * scale),
  };
}
