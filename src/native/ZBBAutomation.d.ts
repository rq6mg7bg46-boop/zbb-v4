// ZBBAutomation Native Module TypeScript Declarations
// 实战反证金标准: 复用 V2.x native 60+ method, 不重写
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
  getAllTextNodes(): Promise<Array<{ text: string; centerX: number; centerY: number; type: string }>>;
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

  // 事件监听
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}
