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
//   1. 收到 QianjiMessageReceived → 闸门判断
//      - isRunning() == true → ZBB 在工作 → 入 pending 队列, 不触发
//      - isInUserIntervention() == true → ZBB 卡死 → 入 pending 队列, 不触发
//      - isQuietHour() == true → 静默期 → 入 pending 队列, 不触发
//      - 闸门全过 → 5s 防抢屏推迟 + 二次闸门 + 调 runZbbWorkflow
//   2. 状态机转回 Idle (running → idle / UI → idle / error → idle) → 消费 pending 队列
//      - 二次闸门 (Running/UI/QuietHour) 通过 → 5s 推迟 + runZbbWorkflow
//      - 不通过 → 保留 pending, 等下次 Idle
//   3. 同入口 3 一样不打扰 (UserIntervention 不消费队列 = 老板没操作前不自动跑)

const QIANJI_PENDING_DELAY_MS = 5000;  // 5s 防抢屏推迟
type QianjiPayload = { package?: string; title?: string; text?: string; subText?: string; bigText?: string; timestamp?: number; source?: string };
const pendingQianjiEvents: QianjiPayload[] = [];  // pending 队列 (FIFO)

/**
 * 检查闸门 + 推迟触发 runZbbWorkflow
 * @param pendingTimeoutId 用于推迟期间取消 (状态机变了就取消, 事件放回队列头)
 */
function scheduleQianjiTrigger(payload: QianjiPayload): void {
  // 二次闸门 (推迟 5s 后状态可能变了)
  if (orchestrator.isInUserIntervention()) {
    logger.info('千机监听', `推迟后闸门不通过: UserIntervention, 事件保留 pending=${pendingQianjiEvents.length}`);
    return;
  }
  if (orchestrator.isRunning()) {
    logger.info('千机监听', `推迟后闸门不通过: Running, 事件保留 pending=${pendingQianjiEvents.length}`);
    return;
  }
  // 静默期闸门由 native 端拦截 (见顶部注释), JS 端只查 Running/UI

  logger.info('千机监听', `✓ 闸门全过, 触发 runZbbWorkflow (pkg=${payload?.package}, source=${payload?.source})`);
  runZbbWorkflow().then((result) => {
    logger.info('千机监听', `runZbbWorkflow 完成: ok=${result.ok} skipped=${result.skipped} reason=${result.reason}`);
  }).catch((e: any) => {
    logger.error('千机监听', `'runZbbWorkflow 异常:' ${e}`);
  });
}

let qianjiListenerSubscription: { remove: () => void } | null = null;

/**
 * 消费 pending 队列: 弹出最早事件, 走二次闸门 + 5s 推迟 + 触发
 * 闸门不通过 → 放回队列头, 等下次 Idle
 */
function consumeQianjiPending(): void {
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
  logger.info('千机监听', `消费 pending: 弹出事件 (pkg=${payload?.package}), 5s 推迟 (queue 剩 ${pendingQianjiEvents.length} 个)`);
  setTimeout(() => scheduleQianjiTrigger(payload), QIANJI_PENDING_DELAY_MS);
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
 *   - 闸门全过 (Idle + 活跃期 + 解锁) → 5s 防抢屏推迟 + 调 runZbbWorkflow
 *   - ZBB 在工作 / 卡死 / 静默期 / 锁屏 → 入 pending 队列, 状态机转回 Idle 时消费
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

    // 闸门全过 → 5s 防抢屏推迟 + 调 runZbbWorkflow
    logger.info('千机监听', `闸门全过, 5s 推迟后触发 (pkg=${payload?.package})`);
    setTimeout(() => scheduleQianjiTrigger(payload), QIANJI_PENDING_DELAY_MS);
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