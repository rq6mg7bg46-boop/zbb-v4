/**
 * V4.x 端流程接口定义 (08-30 老板拍板 端路由 Flow Router)
 *
 * 老板 08-30 实战反证设计:
 *   - 千机端 = 纯识别 + 路由, 零 APP 知识
 *   - 每个端 = 自主 launchApp + 自主流程
 *   - 加新端 = 1 个端文件 + registry 加 entry, 千机端零改动
 *
 * 核心设计:
 *   1. ProjectType 枚举 = 端类型 ('baoli' | 'yuexiu' | 'zhaoshang' | ...)
 *   2. FlowConfig = 每个端的运行配置 (run 函数 + statePrefix + logTag)
 *   3. FLOW_REGISTRY = ProjectType → FlowConfig 的映射表
 *   4. runZbbWorkflow 按 FLOW_REGISTRY[customer.projectType] 路由
 */

import type { CustomerInfo } from './qianji';

/**
 * 端类型枚举 (08-30 老板拍板)
 *   - baoli: 保利端 (企业微信小程序)
 *   - yuexiu: 越秀端 (企业微信小程序, V4.x 暂未实装)
 *   - zhaoshang: 招商端 (未来扩展, 可能用飞书)
 *   - other: 未知端类型 → UserIntervention
 */
export type ProjectType = 'baoli' | 'yuexiu' | 'zhaoshang' | 'other';

/**
 * 端流程配置 (08-30 老板拍板)
 *
 * 字段说明:
 *   - run: 端流程入口函数, 接收 customer, 返回 true/false
 *   - statePrefix: 该端的状态机事件前缀 (大写), 用于动态生成 COMPLETE / FAILED 事件
 *   - logTag: 该端的 logger.info tag 前缀 (中文, 用于 server log 业务 log 段标识)
 */
export interface FlowConfig {
  run: (customer: CustomerInfo) => Promise<boolean>;
  statePrefix: string;  // 'BAOLI' | 'YUEXIU' | 'ZHAOSHANG'
  logTag: string;       // '保利' | '越秀' | '招商'
}