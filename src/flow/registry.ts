/**
 * V4.x 端流程注册表 (08-30 老板拍板 Flow Router)
 *
 * 老板 08-30 实战反证设计:
 *   - 加新端 = 1 个端文件 + registry 加 entry, 千机端零改动
 *   - 现有端: baoli (已实装), yuexiu (V4.x 暂未实装), zhaoshang (未来扩展)
 *
 * 未来扩展流程:
 *   1. 新建 src/flow/{端名}.ts, 实现 runXxxFlow(customer): Promise<boolean>
 *   2. 在本文件 import runXxxFlow
 *   3. 在 FLOW_REGISTRY 加 entry: { run, statePrefix: 'XXX', logTag: '端中文名' }
 *   4. 在 src/core/stateMachine/transitions.ts 加 XXX_COMPLETE / XXX_FAILED / XXX_INTERVENE
 *   5. 千机端 src/flow/qianji.ts 解析 customer.projectType 加新值
 */

import type { FlowConfig, ProjectType } from './types';
import { runBaoliFlow } from './baoli';

/**
 * 端流程注册表 (08-30 老板拍板 Flow Router)
 *
 * 字段:
 *   - run: 该端自主的流程入口 (内部负责 launchApp + 完整流程)
 *   - onComplete: 该端流程成功时发送的状态机事件 (e.g. 'BAOLI_COMPLETE')
 *   - onFailed: 该端流程失败时发送的状态机事件 (e.g. 'BAOLI_FAILED')
 *   - logTag: logger.info 的中文 tag (用于 server log 业务 log 段)
 */
export interface FlowRegistryEntry extends FlowConfig {
  onComplete: 'BAOLI_COMPLETE' | 'YUEXIU_COMPLETE' | 'ZHAOSHANG_COMPLETE' | 'UNKNOWN_COMPLETE';
  onFailed: 'BAOLI_FAILED' | 'YUEXIU_FAILED' | 'ZHAOSHANG_FAILED' | 'UNKNOWN_FAILED';
}

export const FLOW_REGISTRY: Record<ProjectType, FlowRegistryEntry> = {
  // 保利端 — 已实装 (08-23 老板拍板连续编号 9 步骤 + 2 轮)
  baoli: {
    run: runBaoliFlow,
    statePrefix: 'BAOLI',
    logTag: '保利',
    onComplete: 'BAOLI_COMPLETE',
    onFailed: 'BAOLI_FAILED',
  },

  // 越秀端 — V4.x 暂未实装 (08-30 老板拍板预留)
  yuexiu: {
    run: async () => {
      throw new Error('越秀端待实装 (V4.x S2.4)');
    },
    statePrefix: 'YUEXIU',
    logTag: '越秀',
    onComplete: 'YUEXIU_COMPLETE',
    onFailed: 'YUEXIU_FAILED',
  },

  // 招商端 — 未来扩展 (可能用飞书 / 其他 APP)
  zhaoshang: {
    run: async () => {
      throw new Error('招商端待实装');
    },
    statePrefix: 'ZHAOSHANG',
    logTag: '招商',
    onComplete: 'ZHAOSHANG_COMPLETE',
    onFailed: 'ZHAOSHANG_FAILED',
  },

  // 未知端 — 兜底
  other: {
    run: async () => {
      throw new Error('未知端类型');
    },
    statePrefix: 'UNKNOWN',
    logTag: '未知',
    onComplete: 'UNKNOWN_COMPLETE',
    onFailed: 'UNKNOWN_FAILED',
  },
};