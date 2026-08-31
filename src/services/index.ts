/**
 * V4.x services/index.ts (08-27 老板拍板: 重构自动触发链路, 删冷却)
 *
 * 自动触发入口 (V4.x 08-27):
 *   - 入口 1: HomeScreen.handleStart → runZbbWorkflow (老板点"开始干活", 已存在)
 *   - 入口 2: 千机监听新客户 → listenForQianjiNewCustomer → runZbbWorkflow (08-27 接口预留, 实装待补)
 *   - 入口 3: native 反息屏 5min 触发 → emit 'zbbIdleWorkTrigger' → 本文件监听 → runZbbWorkflow (native 端已实装, JS 端 08-27 补齐)
 *   - 入口 4 (JS 5min setInterval): 已删除 (08-27 老板拍板, 语义跟 native 反息屏冲突)
 *
 * 守卫 (runZbbWorkflow 内部已实现):
 *   - 状态守卫: 当前不在 RUNNING_STATES 才允许启动
 *   - UserIntervention 守卫: 流程异常结束期间, 反息屏 / 千机监听 / 老板点击 都跳过自动触发
 *   - 千机监听: 5s 防抢屏推迟 (08-27 接口预留, 实装待老板拍板延迟参数)
 *
 * 反息屏 5min 时间基准:
 *   - native ZbbKeepAliveService.kt 检查 OperationDetector.getLastInteractionMs()
 *   - lastInteraction = 最后操作时间 (含 ZBB 操作和老板操作)
 *   - 设计意图: 永远比系统 10min 熄屏早 5min 触发 → 屏幕不熄
 *   - 流程正常结束 = 一次 ZBB 操作 → lastInteraction 已刷新 → 反息屏重计时 5min
 *   - 流程异常结束 = UserIntervention → 老板不操作 → lastInteraction 不变 → 反息屏不会触发 (符合预期)
 *
 * 自动接龙语义 (08-27 重构后):
 *   - 流程正常结束 → Idle → 老板点 / 千机监听 / 反息屏 都能立刻启动下一次
 *   - 流程异常结束 → UserIntervention → 只有老板点"开始干活"才能恢复 (反息屏 / 千机监听都被守卫挡掉)
 *
 * 🆕 08-27 实装入口 2: 千机监听 + pending 队列
 *   老板拍板核心规则 (08-27 16:45):
 *   - ZBB 在工作 (Running) 或 卡死 (UserIntervention) → 不立刻触发 → 入 pending 队列
 *   - 状态机转回 Idle 时 → 消费 pending 队列 (5s 防抢屏推迟后再触发)
 *   - 静默期 / 锁屏 → 入 pending 队列 (跟入口 3 闸门一致)
 *   - 5s 防抢屏推迟期间状态机变了 → 取消触发, 把事件放回队列头
 */

import { NativeEventEmitter, NativeModules } from 'react-native';
import { runZbbWorkflow } from '@/flow';
import { orchestrator } from '@/core/stateMachine';
import { loadAppEnv } from '@/config/env';
import { logger } from '@/utils/logger';

// 🆕 08-24: 启动时从 native BuildConfig 读 APP_ENV + 千机包名 (实装待补)
loadAppEnv().then((env) => {
  logger.info('services/index.ts', `APP_ENV=${env.appEnv}, qianji=${env.qianjiPackage}`);
}).catch((e) => {
  logger.error('services/index.ts', `'loadAppEnv 失败:' ${e}`);
});

/**
 * 🆕 08-27 老板拍板 (入口 2 实装语义):
 *   - 闸门全过 (Idle + 闸门过滤已通过) → 5s 防抢屏推迟 + 调 runZbbWorkflow
 *   - ZBB 在工作 (Running) 或卡死 (UserIntervention) → 入 pending 队列, 不立刻触发
 *   - 静默期闸门由 native 端 AccessibilityServiceImpl.handleAccessibilityNotification 拦截
 *     (V32.22 commit 已清'方案 2' tag, 闸门逻辑保留), 事件到 JS 时已经过滤过静默期
 *   - 状态机转回 Idle 时 → 消费 pending 队列
 *   - 同入口 3 一样不打扰 (UserIntervention 不消费队列 = 老板没操作前不自动跑)
 */

// ================== 入口 3: native 反息屏 5min 触发监听 ==================
// native 端 WorkOrchestrator.startIdleWork emit 'zbbIdleWorkTrigger' (source=5min_idle_trigger, ts=...)
// JS 端收到事件 → runZbbWorkflow (复用同一套流程)
const ZBBAutomation = NativeModules.ZBBAutomation;
const nativeEmitter = ZBBAutomation ? new NativeEventEmitter(ZBBAutomation) : null;

if (nativeEmitter) {
  nativeEmitter.addListener('zbbIdleWorkTrigger', (payload?: { source?: string; timestamp?: number; reason?: string }) => {
    const reason = payload?.reason ?? 'unknown';
    logger.info('zbbIdleWorkTrigger', `收到反息屏事件 source=${payload?.source} reason=${reason}`);

    // 守卫: UserIntervention / Running → 跳过
    if (orchestrator.isInUserIntervention()) {
      logger.info('zbbIdleWorkTrigger', '跳过: UserIntervention 中 (反息屏不打扰异常结束)');
      return;
    }
    if (orchestrator.isRunning()) {
      logger.info('zbbIdleWorkTrigger', '跳过: 业务已在运行中 (反息屏不打断 ZBB)');
      return;
    }

    // 调 runZbbWorkflow (并发守卫复用)
    runZbbWorkflow().then((result) => {
      logger.info('zbbIdleWorkTrigger', `runZbbWorkflow 完成: ok=${result.ok} skipped=${result.skipped} reason=${result.reason}`);
    }).catch((e: any) => {
      logger.error('zbbIdleWorkTrigger', `'runZbbWorkflow 异常:' ${e}`);
    });
  });
  logger.info('services/index.ts', '入口 3 监听器已注册: zbbIdleWorkTrigger → runZbbWorkflow');
} else {
  logger.info('services/index.ts', 'ZBBAutomation native module 不可用, 跳过入口 3 监听器注册');
}

// ================== 入口 2: 千机监听新客户 (🆕 08-27 实装) ==================
// 🆕 08-27 老板拍板核心语义:
//   1. 收到 QianjiMessageReceived → 白名单匹配 + 闸门判断
//      - 白名单: text 必须含"待审核" + 项目名 ∈ TRIGGER_PROJECTS (抄 V2.x)
//      - isRunning() == true → ZBB 在工作 → 入 pending 队列, 不触发
//      - isInUserIntervention() == true → ZBB 卡死 → 入 pending 队列, 不触发
//      - 闸门全过 → **动态用户空闲检测** delay = max(0, lastInteraction + 5000 - now)
//        例子 A: 用户已 idle 5s+ → delay=0 → 立刻触发
//        例子 B: 用户 3s 前操作过 → delay=2s → 2s 后再触发
//        例子 C: 用户一直操作 → 等用户停止操作后 5s 立刻触发
//   2. 状态机转回 Idle (running → idle / UI → idle / error → idle) → 消费 pending 队列
//      - 二次闸门 (Running/UI) 通过 → 重新算 delay + runZbbWorkflow
//      - 不通过 → 保留 pending, 等下次 Idle
//   3. 同入口 3 一样不打扰 (UserIntervention 不消费队列 = 老板没操作前不自动跑)
//   4. 🆕 debug log 显示 delay 计算细节 (老板拍板: 方便验证动态空闲检测设计)

const QIANJI_PENDING_DELAY_MS = 5000;  // 用户空闲阈值 (5s 不操作 = idle)
// 🆕 08-27 抄 V2.x QianjiService.ts:288 默认值 (实战验证过的项目列表)
const TRIGGER_PROJECTS = ['保利缦城和颂', '越秀金水云启'];
const DAI_SHEN_HE_KEYWORD = '待审核';

type QianjiPayload = { package?: string; title?: string; text?: string; subText?: string; bigText?: string; timestamp?: number; source?: string };
const pendingQianjiEvents: QianjiPayload[] = [];  // pending 队列 (FIFO)

// 🆕 V32.36.2: native push 模式缓存 lastUserInteractionMs (不依赖 RN bridge Promise)
// - 监听 DeviceEventEmitter 'UserInteractionRecorded' 事件
// - native 端 AccessibilityService 触摸事件 / AutomationModule.recordUserInteraction 都 emit
// - JS 端缓存 timestamp 到 local variable
// - calcIdleDelayMs 同步读 local 变量, 不调 RN bridge Promise
let cachedLastUserInteractionMs: number = 0;
let nativeEmitterUserInteraction: { remove: () => void } | null = null;
function setupUserInteractionListener(): void {
  if (nativeEmitterUserInteraction) {
    return;  // 单例防重复订阅
  }
  if (!nativeEmitter) {
    logger.warn('services/index.ts', 'native emitter 不可用, 跳过 UserInteractionRecorded 监听');
    return;
  }
  nativeEmitterUserInteraction = nativeEmitter.addListener('UserInteractionRecorded', (event: { timestamp?: number; source?: string }) => {
    if (event?.timestamp) {
      cachedLastUserInteractionMs = event.timestamp;
      logger.info('services/index.ts', `UserInteraction 推送: ts=${event.timestamp} source=${event.source}`);
    }
  });
  logger.info('services/index.ts', '入口 4 监听器已注册: UserInteractionRecorded → 缓存 lastUserInteractionMs');
}

/**
 * 匹配白名单: text 必须含"待审核" + 项目名 ∈ TRIGGER_PROJECTS
 * 抄 V2.x QianjiService.ts:1413 设计
 * @returns { matched: boolean, project?: string }
 */
function matchQianjiTrigger(text: string | undefined): { matched: boolean; project?: string } {
  if (!text) return { matched: false };
  const hasDaiShenHe = text.includes(DAI_SHEN_HE_KEYWORD);
  const projectHit = TRIGGER_PROJECTS.find((p) => text.includes(p));
  if (!projectHit || !hasDaiShenHe) {
    logger.info('千机监听', `未命中白名单 (${TRIGGER_PROJECTS.join('/')}) + ${DAI_SHEN_HE_KEYWORD}, 跳过 text=${text.slice(0, 60)}`);
    return { matched: false };
  }
  return { matched: true, project: projectHit };
}

/**
 * 计算动态 delay (老板拍板核心公式):
 *   delay = max(0, lastInteractionMs + 5000 - nowMs)
 *   - 例子 A: 用户已 idle 5s+ → delay=0 → 立刻触发
 *   - 例子 B: 用户 3s 前操作过 → delay=2s → 2s 后再触发
 *   - 例子 C: 用户一直操作 → 等用户停止操作后 5s 立刻触发
 */
/**
 * 🆕 V32.36.2: 计算动态 delay (本地缓存版, 不依赖 RN bridge Promise)
 *   delay = max(0, cachedLastUserInteractionMs + 5000 - nowMs)
 *   - cachedLastUserInteractionMs 由 DeviceEventEmitter 'UserInteractionRecorded' push
 *   - native 端 AccessibilityService 触摸 / AutomationModule.recordUserInteraction 都 emit
 *   - 不调 RN bridge Promise, RN bridge queue 堵塞不影响 (老板 08-31 装机验证 bug 根因)
 *
 * 兜底: 如果 cachedLastUserInteractionMs 仍是 0 (native 端还没 emit 过), 视为从未操作 → delay=0 → 立刻触发
 */
function calcIdleDelayMs(): number {
  const nowMs = Date.now();
  const lastUserMs = cachedLastUserInteractionMs;
  const elapsedSinceInteraction = lastUserMs === 0 ? Infinity : nowMs - lastUserMs;
  const delay = Math.max(0, lastUserMs + QIANJI_PENDING_DELAY_MS - nowMs);
  logger.info('千机监听', `delay 计算 (本地缓存): nowMs-lastUserMs=${elapsedSinceInteraction === Infinity ? '∞ (从未操作)' : elapsedSinceInteraction + 'ms'}, delay=${delay}ms`);
  return delay;
}

/**
 * 🆕 V32.36.0 修法 A+B: 检查闸门 + 持续轮询 delay (不再是 setTimeout 一次性)
 *
 * 老板 08-31 装机验证 V32.35.0 发现 bug:
 *   - 13:02:37 收到吴丽华, delay=2329ms 推迟后再触发
 *   - 但 setTimeout(2329) 二次调 scheduleQianjiTrigger 在 async 链被吞
 *   - 直到 13:03:21 收到赵华才触发 (44 秒后)
 *
 * 设计要求 (老板拍板):
 *   - 接收到符合条件的信息后, 判断前后合计 5S 的时间是否无触摸
 *   - 如果没触摸 → 启动
 *   - 有触摸 → 推迟再触发 (持续判断, 不能 delay 一次就放弃)
 *
 * V32.36.0 修法:
 *   - 不用 setTimeout 一次性递归 (有 race condition)
 *   - 改 setInterval 每 500ms 轮询, 闸门 + delay 满足 → trigger
 *   - trigger 后立即 clearInterval, 不留悬挂
 *   - 同时拆 5min 静默与千机监听 (getLastUserInteractionMs / getLastZbbInteractionMs)
 */
async function scheduleQianjiTrigger(payload: QianjiPayload): Promise<void> {
  // 闸门 1: UserIntervention
  if (orchestrator.isInUserIntervention()) {
    logger.info('千机监听', `闸门不通过: UserIntervention, 事件保留 pending=${pendingQianjiEvents.length}`);
    return;
  }
  // 闸门 2: Running
  if (orchestrator.isRunning()) {
    logger.info('千机监听', `闸门不通过: Running, 事件保留 pending=${pendingQianjiEvents.length}`);
    return;
  }

  // 首次算 delay + log (同步, 不再 await)
  const initialDelay = calcIdleDelayMs();
  logger.info('千机监听', `开始轮询等用户空闲, 初始 delay=${initialDelay}ms (每 500ms 重新判断)`);

  // 持续轮询: 每 500ms 重算 delay, 闸门 + delay 满足 → 触发
  // 🆕 V32.36.0.1 bug fix: setInterval 跟 async callback 不兼容 (08-31 老板装机验证)
  //   老板反馈: 14:52:21 delay=1750ms 开始轮询, 14:53:24 才收到第二个推送 (63 秒空窗)
  //   → 中间 126 次 setInterval callback 全部 await calcIdleDelayMs() 悬挂
  //   → 闸门2 (isRunning) 永远不返回, trigger 永不调
  // 修法: 用 setTimeout 递归代替 setInterval, 等前一次 Promise 链完成再排下一次
  const POLL_INTERVAL_MS = 500;
  const MAX_WAIT_MS = 60000; // 最多等 60s (防御悬挂)
  let startTime = Date.now();

  const pollOnce = async (): Promise<void> => {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_WAIT_MS) {
      logger.warn('千机监听', `轮询超时 ${MAX_WAIT_MS}ms, 放弃本事件 (pkg=${payload?.package})`);
      return;
    }

    // 闸门再检 (轮询期间状态可能变了)
    if (orchestrator.isInUserIntervention()) {
      logger.info('千机监听', `轮询中闸门不通过: UserIntervention, 放弃 (pkg=${payload?.package})`);
      return;
    }
    if (orchestrator.isRunning()) {
      logger.info('千机监听', `轮询中闸门不通过: Running, 放弃 (pkg=${payload?.package})`);
      return;
    }

    // 重算 delay (同步, 不再 await)
    const delay = calcIdleDelayMs();
    if (delay === 0) {
      // 满足 5s 无触摸 → 触发
      logger.info('千机监听', `✓ 5s 无触摸窗口已满足, 触发 runZbbWorkflow (pkg=${payload?.package}, 等待 ${elapsed}ms)`);
      triggerQianjiRun(payload);
      return;
    }
    // 否则继续轮询 (delay > 0 = 还有触摸, 等下一轮)
    logger.info('千机监听', `轮询中: delay=${delay}ms, 继续等 ${POLL_INTERVAL_MS}ms 后再判 (elapsed=${elapsed}ms)`);
    setTimeout(pollOnce, POLL_INTERVAL_MS);
  };

  // 启动轮询 (首次调)
  setTimeout(pollOnce, 0);
}

/**
 * 真正调 runZbbWorkflow
 */
function triggerQianjiRun(payload: QianjiPayload): void {
  logger.info('千机监听', `✓ 闸门全过, 触发 runZbbWorkflow (pkg=${payload?.package}, project=${payload?.text?.slice(0, 60)})`);
  runZbbWorkflow().then((result) => {
    logger.info('千机监听', `runZbbWorkflow 完成: ok=${result.ok} skipped=${result.skipped} reason=${result.reason}`);
  }).catch((e: any) => {
    logger.error('千机监听', `'runZbbWorkflow 异常:' ${e}`);
  });
}

let qianjiListenerSubscription: { remove: () => void } | null = null;

/**
 * 消费 pending 队列: 弹出最早事件, 走二次闸门 + 动态 delay + 触发
 * 闸门不通过 → 放回队列头, 等下次 Idle
 */
async function consumeQianjiPending(): Promise<void> {
  if (pendingQianjiEvents.length === 0) {
    return;
  }

  // 二次闸门 (消费前必检, 闸门不通过就放回去)
  if (orchestrator.isInUserIntervention() || orchestrator.isRunning()) {
    logger.info('千机监听', `消费 pending: 闸门不通过 (Running/UI), 保留 ${pendingQianjiEvents.length} 个 pending`);
    return;
  }
  // 静默期闸门由 native 端拦截

  const payload = pendingQianjiEvents.shift()!;
  const delay = calcIdleDelayMs();  // 🆕 V32.36.2: 同步, 不再 await
  logger.info('千机监听', `消费 pending: 弹出事件 (pkg=${payload?.package}), delay=${delay}ms (queue 剩 ${pendingQianjiEvents.length} 个)`);
  if (delay === 0) {
    triggerQianjiRun(payload);
  } else {
    setTimeout(() => scheduleQianjiTrigger(payload), delay);
  }
}

/**
 * 注册状态机变化监听: Running/UI/Error → Idle 时消费 pending
 */
orchestrator.onChange((newState, prevState) => {
  // 任意非 Idle → Idle = 状态恢复 (流程跑完 / 老板处理完异常)
  const wasBusy = prevState !== 'Idle';
  const isNowIdle = newState === 'Idle';
  if (wasBusy && isNowIdle) {
    logger.info('千机监听', `状态机转回 Idle: ${prevState} → ${newState}, 准备消费 pending`);
    consumeQianjiPending();
  }
});

/**
 * 监听千机端收到符合要求的新客户, 触发 ZBB
 *
 * 🆕 08-27 老板拍板语义 (入口 2 实装):
 *   - 白名单: 待审核 + 项目名 ∈ TRIGGER_PROJECTS (抄 V2.x)
 *   - 闸门全过 (Idle + 闸门过滤已通过) → **动态用户空闲检测** delay = max(0, lastInteraction + 5000 - now)
 *   - ZBB 在工作 (Running) 或卡死 (UserIntervention) → 入 pending 队列, 不立刻触发
 *   - 静默期闸门由 native 端拦截
 *   - 状态机转回 Idle 时 → 消费 pending 队列
 *
 * 🆕 08-27 bug fix: 改为模块加载时立即订阅 (跟入口 3 形态一致)
 *   - 旧设计: export function, 需外部调用才会触发
 *   - 新设计: 模块加载时 IIFE 自动调一次, 保留 export 兼容外部调用
 *   - 单例模式: qianjiListenerSubscription 全局唯一, 防重复订阅
 *
 * @param callback 收到新客户时同步回调 (供业务层打 log / 上报)
 * @returns unsubscribe 函数
 */
function subscribeQianjiNewCustomer(
  callback?: (customerInfo: any) => void,
): () => void {
  // 单例模式: 已订阅过直接返回 unsub (防止多个 component 重复订阅)
  if (qianjiListenerSubscription) {
    logger.warn('listenForQianjiNewCustomer', '已订阅, 返回已有 unsub');
    return () => {
      qianjiListenerSubscription?.remove();
      qianjiListenerSubscription = null;
    };
  }

  if (!nativeEmitter) {
    logger.warn('listenForQianjiNewCustomer', 'native emitter 不可用, 跳过订阅');
    return () => {};
  }

  qianjiListenerSubscription = nativeEmitter.addListener('QianjiMessageReceived', (payload: QianjiPayload) => {
    logger.info('千机监听', `收到 QianjiMessageReceived pkg=${payload?.package} text=${payload?.text?.slice(0, 60)} source=${payload?.source}`);

    // 业务层回调 (供业务层打 log / 上报)
    callback?.(payload);

    // 白名单匹配: 待审核 + 项目名 ∈ TRIGGER_PROJECTS
    const matchResult = matchQianjiTrigger(payload?.text);
    if (!matchResult.matched) {
      return;  // matchQianjiTrigger 已 log
    }
    logger.info('千机监听', `✓ 命中白名单: 项目=${matchResult.project} + ${DAI_SHEN_HE_KEYWORD}`);

    // 闸门 1: ZBB 在工作 (Running)
    if (orchestrator.isRunning()) {
      pendingQianjiEvents.push(payload);
      logger.info('千机监听', `ZBB 在工作, 事件入队 pending=${pendingQianjiEvents.length} (等 Idle 消费)`);
      return;
    }

    // 闸门 2: ZBB 卡死 (UserIntervention)
    if (orchestrator.isInUserIntervention()) {
      pendingQianjiEvents.push(payload);
      logger.info('千机监听', `ZBB 卡死, 事件入队 pending=${pendingQianjiEvents.length} (等老板恢复后消费)`);
      return;
    }

    // 闸门 3: 静默期由 native 端拦截 (见顶部注释), JS 端不查
    // (AccessibilityServiceImpl.handleAccessibilityNotification 已经过滤 21:00-07:00)

    // 闸门全过 → 动态用户空闲检测 delay + runZbbWorkflow
    scheduleQianjiTrigger(payload);
  });

  logger.info('services/index.ts', '入口 2 监听器已注册: QianjiMessageReceived → pending 队列 + Idle 消费');
  return () => {
    qianjiListenerSubscription?.remove();
    qianjiListenerSubscription = null;
    logger.info('listenForQianjiNewCustomer', 'unsubscribe 已移除监听器');
  };
}

// 🆕 08-27 bug fix: 模块加载时立即订阅 (跟入口 3 形态一致)
// 旧 bug: export function 需外部调用才会订阅, 没人调 = 永远不触发
// 修法: IIFE 自动调一次, 单例防重复
subscribeQianjiNewCustomer();

// 🆕 V32.36.2: 模块加载时立即订阅 UserInteractionRecorded (native push 模式)
setupUserInteractionListener();

/**
 * 导出函数: 兼容外部调用 (返回 unsub)
 * 注意: 内部已模块加载时订阅, 此函数仅返回 unsub 用于清理
 */
export function listenForQianjiNewCustomer(
  callback?: (customerInfo: any) => void,
): () => void {
  return subscribeQianjiNewCustomer(callback);
}

// ================== 模块加载完成 log ==================
logger.info('services/index.ts', `已注册: 入口 2 千机监听 + 入口 3 反息屏监听 (pending 队列消费闸门)`);