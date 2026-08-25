/**
 * V4.x 异常通知服务 (08-25 老板拍板 修法5B 实战反证金标准 + 修法6 V2.x 震动)
 *
 * 实战反证金标准 (V2.x v22.02.35):
 *   - 弹窗: SYSTEM_ALERT_WINDOW overlay权限 + LinearLayout(TextView + Button)
 *     用户点"我知道了" → dismiss overlay + JS promise.resolve(true)
 *     JS 收到回调 → 调 stopVibration 停震动
 *   - 震动: V2.x startPulseVibration (100ms震+200ms停=300ms周期, 30s 自动停)
 *
 * API:
 *   - raiseAlert(message, vibrateMs=30000)  系统弹窗 + 30s 震动 (实战反证金标准方案)
 *   - showSystemToast(message)              系统 Toast (无按钮, 5s 自动消失)
 *   - showSystemDialog(message, btnText)    系统 Dialog (有按钮, 等用户点)
 */

import ZBBAutomation from '@/native';

/**
 * 异常通知: 系统弹窗 + 30s 脉冲震动 (V2.x v22.02.35 实战反证金标准)
 *
 * 实战反证金标准 (08-25 老板拍板 修法5B):
 *   - 弹窗带"我知道了"按钮, 不依赖 ZBB app 在前台
 *   - 用户点按钮 → 弹窗 dismiss + 震动停止
 *   - 超时 30s → 弹窗自动 dismiss + 震动也自动停 (V2.x startPulseVibration 30s 自动停)
 *
 * @param message 弹窗消息 (文档示例: "小主,流程出问题了,请手动处理")
 * @param vibrateMs 震动时长 (默认 30000ms = 30s)
 */
export async function raiseAlert(message: string, vibrateMs = 30000): Promise<void> {
  console.error(`[alert] 异常通知: ${message} (震动 ${vibrateMs}ms)`);

  // 1. 启动脉冲震动 (V2.x 实战反证金标准: 30s 自动停)
  try {
    await ZBBAutomation.startPulseVibration();
  } catch (e) {
    console.warn(`[alert] startPulseVibration 失败 (忽略): ${e}`);
  }

  // 2. 系统级 Dialog 带"我知道了"按钮 (修法5B 实战反证金标准)
  //    showSystemDialog 返回:
  //      true  = 用户点了按钮 (实战反证金标准: 收到后立即调 stopVibration)
  //      false = 30s 超时 (震动 30s 也自动停, 这里再保险一次 stop)
  let userClicked = false;
  try {
    userClicked = await ZBBAutomation.showSystemDialog(message, '我知道了', vibrateMs);
  } catch (e) {
    console.warn(`[alert] showSystemDialog 失败 (忽略): ${e}`);
  }

  // 3. 用户点按钮 OR 超时 → 停震动
  try {
    await ZBBAutomation.stopVibration();
  } catch (e) {
    console.warn(`[alert] stopVibration 失败 (忽略): ${e}`);
  }

  console.log(`[alert] 异常通知结束 (用户点击=${userClicked})`);
}

/**
 * 系统级 Toast (无按钮, 5s 自动消失)
 */
export async function showSystemToast(message: string, durationMs = 5000): Promise<void> {
  try {
    await ZBBAutomation.showSystemToast(message, durationMs);
  } catch (e) {
    console.warn(`[alert] showSystemToast 失败: ${e}`);
  }
}

/**
 * 系统级 Dialog 带按钮 (等用户点)
 *
 * @returns true = 用户点了按钮, false = 超时
 */
export async function showSystemDialog(message: string, buttonText = '我知道了', autoDismissMs = 30000): Promise<boolean> {
  try {
    return await ZBBAutomation.showSystemDialog(message, buttonText, autoDismissMs);
  } catch (e) {
    console.warn(`[alert] showSystemDialog 失败: ${e}`);
    return false;
  }
}

/**
 * ZBB 内置 Toast (千机端在前台时不可见, 不推荐)
 */
export async function showToast(message: string): Promise<void> {
  try {
    await ZBBAutomation.showToast(message);
  } catch (e) {
    console.warn(`[alert] showToast 失败: ${e}`);
  }
}

/**
 * ZBB 内置弹窗 (千机端在前台时不可见, 不推荐)
 */
export async function showConfirmDialog(message: string, confirmText = '我知道了'): Promise<boolean> {
  try {
    return await ZBBAutomation.showCenteredDialog(message, confirmText);
  } catch (e) {
    console.warn(`[alert] showConfirmDialog 失败: ${e}`);
    return false;
  }
}

/**
 * 步骤2数字=0 提示用户 (V2.x 实战反证金标准: 弹窗"小主,当前无报备")
 *
 * 改用系统 Toast (千机端在前台时也能看见)
 */
export async function notifyNoReport(): Promise<void> {
  console.log('[alert] 当前无报备客户,提示用户');
  await showSystemToast('小主,当前无报备客户', 5000);
}