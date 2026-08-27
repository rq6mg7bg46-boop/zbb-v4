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

// ================== 入口 2: 千机监听新客户 (08-27 接口预留) ==================
/**
 * 监听千机端收到符合要求的新客户, 触发 ZBB
 *
 * 08-27 老板拍板 (接口预留, 实装待补):
 *   - 触发对象: 千机收到合规新客户 (8 步骤流程里的步骤 2 / stepParseCustomerInfo 阶段)
 *   - 5s 防抢屏: 监听事件触发后等 5s 再启动 runZbbWorkflow (防系统动画 / 千机 toast 抢屏幕)
 *   - 关联运行:
 *     - 如果当前 Idle, 启动跑
 *     - 如果当前 Running 中 (千机/保利/越秀), 跳过 (并发守卫)
 *     - 如果当前 UserIntervention, 跳过 (异常不打扰)
 *
 * 🆕 实装接口签名 (锁定):
 *   listenForQianjiNewCustomer(callback?: (customerInfo) => void): () => void
 *     - callback: 收到新客户时同步回调 (供业务层打 log / 上报)
 *     - 返回: unsubscribe 函数
 *
 * 实装待老板确认延迟参数 (5s) 和触发阈值 (合规客户定义)
 *
 * @returns unsubscribe 函数
 */
export function listenForQianjiNewCustomer(
  callback?: (customerInfo: any) => void,
): () => void {
  // TODO(08-27): 实装千机端 notification / accessibility 监听, 检测"新客户到达"事件
  //   - 候选 1: NotificationMonitorService 监听千机 notification
  //   - 候选 2: 千机界面 a11y 节点扫描 (新增客户字段变化)
  //   - 实装时: 加 5s 防抢屏推迟 → runZbbWorkflow
  logger.info('listenForQianjiNewCustomer', '🆕 08-27 接口预留, 实装待老板拍板 (TODO)');
  // 占位: 返回空 unsubscribe, 不影响现有逻辑
  return () => {
    logger.info('listenForQianjiNewCustomer', 'unsubscribe (no-op)');
  };
}

// ================== 模块加载完成 log ==================
logger.info('services/index.ts', `已注册: 入口 3 反息屏监听 (入口 2 千机监听仅接口预留, 未实装)`);
