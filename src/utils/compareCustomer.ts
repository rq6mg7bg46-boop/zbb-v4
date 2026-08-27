/**
 * V4.x 客户信息对比工具 (08-25 老板拍板 A+B 方案)
 *
 * 实测 (08-25 实测):
 *   - varA 解析: 3 字段 (项目名/姓名/电话)  ← 轻量,只用于对比
 *   - varB 解析: 10 字段 (完整客户信息)      ← 用于写库
 *   - 对比 = 只比 3 字段 (项目/姓名/电话)
 *   - 对比成功 → 直接用 varB 写库 (不合并 A+B)
 *
 * mock 千机实测 (08-25):
 *   - A.phone = "联系方式 192****7209" (带前缀+空格, 首页拼装结果)
 *   - B.phone = "192****7209" (纯号码, 转发页拼装结果)
 *   → 必须归一化后再比 (去前缀"联系方式" + 去空格 + 统一 * 数量)
 */

import type { CustomerInfo } from '@/flow/qianji';

export interface CompareResult {
  isMatch: boolean;
  diffs: { field: string; aValue: string; bValue: string }[];
}

/**
 * 对比对象的最小类型 (只要 3 字段, 不强制 CustomerInfo 全字段)
 */
type CompareInput = Pick<CustomerInfo, 'projectName' | 'customerName' | 'phone'>;

/**
 * 🆕 08-25 实测: 只比 A 跟 B 都有的核心字段
 *   - projectName (项目)
 *   - customerName (姓名)
 *   - phone (电话)
 * varB 独有的字段 (propertyType/reportTime/expectedVisitTime/agent/agentNote)
 * 不在 A 里, 永远 A空≠B, 不应纳入对比
 */
const COMPARE_FIELDS: (keyof CompareInput)[] = [
  'projectName',
  'customerName',
  'phone',
];

/**
 * 归一化字段值用于对比 (08-25 实测: phone 残留前缀问题)
 *
 * 修法:
 *   - phone: 去"联系方式"前缀 + 去空格 + 保留数字+星号
 *   - 其他字段: 直接 trim
 */
function normalize(field: keyof CompareInput, value: string): string {
  let v = value.trim();
  if (field === 'phone') {
    // 实测: mock 千机首页 a11y 是 "联系方式 192****7209"
    // → 去"联系方式"前缀 + 去所有空白字符
    v = v.replace(/联系方式/g, '').replace(/\s+/g, '');
  }
  return v;
}

/**
 * 对比两个客户对象, 返回字段级差异
 */
export function compareCustomer(a: CompareInput, b: CompareInput): CompareResult {
  const diffs: CompareResult['diffs'] = [];

  for (const field of COMPARE_FIELDS) {
    const aValue = normalize(field, String(a[field] ?? ''));
    const bValue = normalize(field, String(b[field] ?? ''));
    if (aValue !== bValue) {
      diffs.push({ field, aValue: String(a[field] ?? ''), bValue: String(b[field] ?? '') });
    }
  }

  return {
    isMatch: diffs.length === 0,
    diffs,
  };
}

/**
 * 格式化对比结果用于日志
 */
export function formatCompareResult(result: CompareResult): string {
  if (result.isMatch) return '✓ A vs B 完全一致';
  const lines = [`✗ A vs B 不一致 (${result.diffs.length} 个字段差异)`];
  for (const d of result.diffs) {
    lines.push(`  - ${d.field}: A="${d.aValue}" vs B="${d.bValue}"`);
  }
  return lines.join('\n');
}