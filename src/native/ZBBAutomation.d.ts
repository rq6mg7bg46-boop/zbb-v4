// ZBBAutomation Native Module TypeScript Declarations
// 实测: 复用 V2.x native 60+ method, 不重写
// 来源: V2.x client/native/ZBBAutomation.d.ts (08-22 V2.x 跑通版)

/**
 * A11y 节点 (V2.x accessibility service 返回)
 */
export interface A11yNode {
  text: string;
  viewId?: string;
  bounds?: { left: number; top: number; right: number; bottom: number };
  centerX?: number;
  centerY?: number;
  clickable?: boolean;
  className?: string;
  packageName?: string;
  contentDesc?: string; // 🆕 08-26: mock 首页语义标签 (e.g. "楼盘 保利缦城和颂")
}

/**
 * OCR 识别结果
 */
export interface OcrResult {
  text: string;
  confidence: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

/**
 * 查找文字结果
 */
export interface FindTextResult {
  found: boolean;
  x?: number;
  y?: number;
  text?: string;
  error?: string;
}

/**
 * 提取内容结果
 */
export interface ExtractContentResult {
  phones?: string[];
  names?: string[];
  allTexts: string[];
}

/**
 * ZBBAutomation 完整 module 接口 (V2.x 60+ method)
 */
export interface ZBBAutomationModule {
  // 服务状态
  isAccessibilityServiceRunning(): Promise<boolean>;
  openAccessibilitySettings(): Promise<boolean>;

  // 🆕 08-27: 用户空闲检测 (供入口 2 千机监听动态 delay 计算)
  getLastInteractionMs(): Promise<number>;

  // 截图
  takeScreenshot(): Promise<string>;
  takeScreenshotAndSave(fileName: string): Promise<string>;
  takeScreenshotBase64(): Promise<string>;

  // 点击操作
  click(x: number, y: number): Promise<boolean>;
  longClick(x: number, y: number, duration: number, isLongPress: boolean): Promise<boolean>;
  clickWithVisualFeedback(x: number, y: number, showRipple: boolean, vibrate: boolean): Promise<boolean>;
  clickByText(text: string, isLongPress: boolean): Promise<boolean>;
  clickByViewId(viewId: string, isLongPress: boolean): Promise<boolean>;

  // 滑动操作
  swipe(startX: number, startY: number, endX: number, endY: number, duration: number): Promise<boolean>;
  swipeShell(startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<boolean>;
  threeFingerSwipeDown(startY: number, endY: number, duration: number): Promise<boolean>;
  threeFingerMultiStageGesture(stages: [number, number, number][], stageGapMs: number): Promise<boolean>;
  screenshotByKeyevent(keyCode1: number, keyCode2: number): Promise<boolean>;
  screenshotBySendevent(eventPath: string, keyCode1: number, keyCode2: number, gapMs: number): Promise<boolean>;
  setPointerLocation(enabled: boolean): Promise<boolean>;
  pullToRefresh(): Promise<boolean>;
  scrollUp(): Promise<boolean>;
  scrollDown(): Promise<boolean>;

  // 输入操作
  inputText(text: string): Promise<boolean>;
  clearInput(): Promise<boolean>;
  pasteText(text: string): Promise<boolean>;

  // 剪贴板
  getClipboardText(): Promise<string | null>;
  setClipboardText(text: string): Promise<boolean>;

  // 查找元素
  findElementByText(text: string): Promise<A11yNode | null>;
  findElementByViewId(viewId: string): Promise<A11yNode | null>;
  getClickableElements(): Promise<A11yNode[]>;
  findElementsByText(text: string): Promise<A11yNode[]>;

  // OCR
  findTextByMLKit(targetText: string): Promise<FindTextResult>;
  screenContainsText(targetText: string): Promise<boolean>;
  ocrContainsText(targetText: string): Promise<boolean>;
  screenshotAndFindText(targetText: string): Promise<FindTextResult>;
  recognizeScreen(): Promise<OcrResult[]>;
  extractScreenContent(type: 'phone' | 'name' | 'all'): Promise<ExtractContentResult>;
  screenshotForOcr(): Promise<string>;
  getAllTextNodes(): Promise<A11yNode[]>; // 🆕 08-24 加 contentDesc 字段 (千机端 80% 节点 text="", 必须靠 contentDesc 识别)
  recognizeTextWithPosition(): Promise<OcrResult[]>;
  setOcrOptions(usePreprocessing: boolean, useCorrection: boolean): void;

  // MediaProjection
  requestMediaProjectionPermission(): Promise<boolean>;
  isMediaProjectionEnabled(): Promise<boolean>;

  // 导航按键
  pressBack(): Promise<boolean>;
  pressHome(): Promise<boolean>;
  pressRecentApps(): Promise<boolean>;

  // 应用控制
  launchApp(packageName: string): Promise<boolean>;
  showToast(message: string): Promise<boolean>;
  showCenteredDialog(message: string, confirmText: string): Promise<boolean>;

  // 悬浮窗
  showFloatingWindow(): Promise<boolean>;
  hideFloatingWindow(): Promise<boolean>;
  updateFloatingStep(stepName: string, stepIndex: number, totalSteps: number): Promise<boolean>;
  updateFloatingAppInfo(appName: string): Promise<boolean>;
  setFloatingComplete(): Promise<boolean>;
  isOverlayPermissionGranted(): Promise<boolean>;
  openOverlaySettings(): Promise<boolean>;

  // 诊断
  dumpWindowTree(): Promise<boolean>;
  delay(ms: number): Promise<boolean>;

  // 等待
  waitForElement(text: string, timeout: number): Promise<boolean>;

  // 校准
  getLastClickCoordinates(): Promise<{ found: boolean; x?: number; y?: number }>;
  getRecentClick(maxAgeMs: number): Promise<{ found: boolean; x?: number; y?: number }>;
  clearClickHistory(): Promise<boolean>;
  getClickHistory(): Promise<{ x: number; y: number }[]>;

  // 自动化控制
  stopAutomation(): Promise<boolean>;

  // 🆕 08-25 老板拍板 全修方案: readBuildEnv + 系统弹窗 + 震动 (V2.x 实测)
  /**
   * 读 BuildConfig 注入的环境变量 (APP_ENV / qianjiPackage / qianjiMainActivity)
   * 实测 (V2.x v22.02.35): JS 端调此方法拿当前编译期环境
   * @returns null 时 fallback 到 APP_PACKAGES 默认值
   */
  readBuildEnv(): Promise<{ appEnv: string; qianjiPackage: string; qianjiMainActivity: string } | null>;

  /**
   * 系统级 Toast 弹窗 (SYSTEM_ALERT_WINDOW overlay权限)
   * 实测 (08-25 老板拍板修法5B): 千机端在前台时也能弹窗通知老板
   * 不依赖 ZBB app 在前台, 直接走 WindowManager SYSTEM_ALERT_WINDOW
   * @param message 弹窗消息
   * @param durationMs 显示时长 (默认 5000ms)
   */
  showSystemToast(message: string, durationMs?: number): Promise<boolean>;

  /**
   * 🆕 08-25 老板拍板 修法5B 实测: 系统级带按钮 Dialog
   *
   * 与 showSystemToast 区别:
   *   - Toast: 5s 自动消失, 无按钮
   *   - Dialog: 显示直到用户点按钮 或 30s 超时, 返回 Promise<boolean>
   *     true  = 用户点了按钮 (老板实测拍板: 收到回调后调 stopVibration)
   *     false = 超时 (震动超时自动停)
   *
   * 用法:
   *   const clicked = = await native.showSystemDialog('流程出问题', '我知道了', 30000);
   *   if (clicked) {
   *     await native.stopVibration();  // 用户确认后停震动
   *   }
   *
   * @param message 弹窗消息
   * @param buttonText 按钮文字 (默认 "我知道了")
   * @param autoDismissMs 超时毫秒 (默认 30000ms)
   */
  showSystemDialog(message: string, buttonText?: string, autoDismissMs?: number): Promise<boolean>;

  /**
   * 启动脉冲震动 (V2.x v22.02.35 实测)
   * 100ms 震 + 200ms 停 = 300ms 一周期
   * 30s 自动停止, isVibrating 标志防重入
   */
  startPulseVibration(): Promise<boolean>;

  /**
   * 停止震动
   */
  stopVibration(): Promise<boolean>;

  // 事件监听
  addListener(eventName: string): void;
  removeListeners(count: number): void;

  // 🆕 08-27 删冷却: setNativeTimeout / clearNativeTimeout 已删除 (Cooldown 不存在, 原 v32.19 用来跑 60s 倒计时)
}
