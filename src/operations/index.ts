/**
 * V4.x Operations 统一入口 (老板实战反证金标准 08-22)
 *
 * 业务流程 = 只调 operations, 不写底层
 *   import { click, longPress, threeFingerSwipe, pressKey, a11y, judge, rollback } from '@/operations';
 *
 *   // 业务示例: 千机端 step
 *   await judge.waitForScreen('抖音');
 *   await click.byText('消息');
 *   const friend = await a11y.findByText('好友');
 *   await longPress.byText('消息', 600);
 *   await click.byText('复制');
 */

export { click, default as clickDefault } from './click';
export { longPress, default as longPressDefault } from './longPress';
export { threeFingerSwipe, default as threeFingerSwipeDefault } from './threeFingerSwipe';
export { pressKey, default as pressKeyDefault } from './pressKey';
export { a11y, default as a11yDefault } from './a11y';
export { judge, default as judgeDefault } from './judge';
export { rollback, default as rollbackDefault } from './rollback';
export type { A11yNode } from '@/native';
