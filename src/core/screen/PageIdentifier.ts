/**
 * V4 PageIdentifier - 实战反证金标准 08-24
 *
 * 实战反证:
 * - 千机端 (com.lianjia.anchang) 80% 节点 text="" 必须看 contentDesc
 * - 复用 V2.x v3.0 PageIdentifier 架构 (chromeTexts / required / anyOf / notAny)
 * - 新增 chromeContents 字段给千机端
 */

import ZBBAutomation from '@/native';

const CHROME_TOP_Y_MIN = 40;
const CHROME_TOP_Y_MAX = 150;

// ========== 页面 ID 枚举 ==========

export type QianjiPageId =
  | 'qianji_home'              // 实战反证金标准 001 首页 (待审核/报备量)
  | 'qianji_customer_detail'   // 实战反证金标准 002 客户详情 (王女士/赵主献, 全 content-desc)
  | 'qianji_share_dialog'      // 实战反证金标准 003 分享弹层 (微信/短信/取消)
  | 'qianji_invalid_reason'    // 实战反证金标准 004 无效原因 (请选择无效原因 + 7 checkbox + 提交)
  | 'qianji_other'             // 千机兜底
  | 'zbb_home'                 // ZBB 主页 (开始干活)
  | 'desktop_home'             // Android 桌面
  | 'wework_home'              // 企微 (罕见)
  | 'unknown';                 // 兜底

// ========== 页面签名 ==========

interface PageSignature {
  required?: string[];
  anyOf?: string[];
  notAny?: string[];
  chromeTexts?: string[];    // 顶部 chrome text (40<=cy<=150)
  chromeContents?: string[]; // 🆕 08-24 实战反证金标准: content-desc 锚点 (千机端必备)
}

// 实战反证金标准 (08-24): 千机端 4 个签名 (基于老板 C:\Users\lt-ceo\Desktop\qianji\ 截图)
const QIANJI_SIGNATURES: Record<QianjiPageId, PageSignature> = {
  qianji_home: {
    // 实战反证金标准 001: 首页独有 (报备数据)
    required: ['以下是您的待处理任务', '报备待审核', '今日报备量'],
    anyOf: ['今日带看量', '您好'], // 兜底 (用户名"您好,XXX")
  },
  qianji_customer_detail: {
    // 实战反证金标准 002: 关键! 千机端 text="" 全在 content-desc
    required: [],
    chromeContents: ['客户姓名', '客户联系方式', '报备项目', '经纪人姓名'],
    notAny: ['分享至'], // 排除 003 分享弹层
  },
  qianji_share_dialog: {
    // 实战反证金标准 003: 分享弹层 content-desc
    chromeContents: ['分享至', '微信', '短信', '取消', '复制'],
  },
  qianji_invalid_reason: {
    // 实战反证金标准 004: 无效原因 +提交按钮
    required: ['请选择无效原因'],
    anyOf: ['已被其他经纪人报备带看', '隐号撞号需要补全号', '客户在开发商系统已存在'],
    chromeContents: ['提交'],
  },
  qianji_other: { required: [] },
  zbb_home: {
    required: ['Action Surrogate', '开始干活'],
    chromeTexts: ['Action Surrogate'], // V4 debug bar 实战反证金标准
  },
  desktop_home: {
    chromeTexts: [], // 桌面无固定 chrome,靠 packageName 判断
  },
  wework_home: {
    chromeTexts: ['消息', '工作台'],
  },
  unknown: { required: [] },
};

// ========== 实战反证金标准 getCurrentAllNodes ==========

interface NodeInfo {
  text: string;
  contentDesc?: string;
  centerX: number;
  centerY: number;
  type: string;
}

/**
 * 获取当前界面所有节点 (含 content-desc)
 * 🆕 08-24 实战反证金标准: 用 contentDesc 字段 (千机端 80% 节点 text="")
 */
async function getCurrentAllNodes(): Promise<{ nodes: NodeInfo[]; texts: string[]; contents: string[]; chromeTexts: string[]; chromeContents: string[]; foregroundPkg: string }> {
  const nodesResult = await ZBBAutomation.getAllTextNodes().catch(() => []);
  const getFg = (ZBBAutomation as any).getForegroundPackage;
  const foregroundPkg: string = typeof getFg === 'function' ? await getFg().catch(() => '') : '';

  const nodes: NodeInfo[] = (nodesResult as any[]).map(n => ({
    text: n.text || '',
    contentDesc: n.contentDesc || '',
    centerX: typeof n.centerX === 'number' ? n.centerX : 0,
    centerY: typeof n.centerY === 'number' ? n.centerY : 0,
    type: n.type || 'text',
  }));

  const texts: string[] = [];
  const contents: string[] = [];
  const chromeTexts: string[] = [];
  const chromeContents: string[] = [];
  const seenText = new Set<string>();
  const seenContent = new Set<string>();
  const seenChromeText = new Set<string>();
  const seenChromeContent = new Set<string>();

  for (const n of nodes) {
    if (n.text && !seenText.has(n.text)) {
      texts.push(n.text);
      seenText.add(n.text);
    }
    if (n.contentDesc && !seenContent.has(n.contentDesc)) {
      contents.push(n.contentDesc);
      seenContent.add(n.contentDesc);
    }
    if (n.centerY >= CHROME_TOP_Y_MIN && n.centerY <= CHROME_TOP_Y_MAX) {
      if (n.text && !seenChromeText.has(n.text)) {
        chromeTexts.push(n.text);
        seenChromeText.add(n.text);
      }
      if (n.contentDesc && !seenChromeContent.has(n.contentDesc)) {
        chromeContents.push(n.contentDesc);
        seenChromeContent.add(n.contentDesc);
      }
    }
  }

  return { nodes, texts, contents, chromeTexts, chromeContents, foregroundPkg };
}

// ========== 实战反证金标准 scorePage ==========

function scorePage(
  sig: PageSignature,
  allTexts: string,
  allContents: string,
  chromeTexts: string[],
  chromeContents: string[]
): number {
  let score = 0;

  // chromeTexts 实战反证金标准: 优先级最高 (+300)
  if (sig.chromeTexts && sig.chromeTexts.length > 0) {
    let hit = false;
    for (const ct of sig.chromeTexts) {
      if (chromeTexts.includes(ct)) { hit = true; break; }
    }
    if (!hit) return 0;
    score += 300;
  }

  // chromeContents 实战反证金标准 08-24: 千机端 +250
  if (sig.chromeContents && sig.chromeContents.length > 0) {
    let hit = false;
    for (const cc of sig.chromeContents) {
      if (chromeContents.includes(cc)) { hit = true; break; }
    }
    if (!hit) return 0;
    score += 250;
  }

  // required 实战反证金标准: 全命中 (+100 each)
  if (sig.required && sig.required.length > 0) {
    for (const req of sig.required) {
      if (!allTexts.includes(req)) return 0;
      score += 100;
    }
  }

  // notAny 实战反证金标准: 任一命中返 0
  if (sig.notAny && sig.notAny.length > 0) {
    for (const nt of sig.notAny) {
      if (allTexts.includes(nt) || allContents.includes(nt)) return 0;
    }
  }

  // anyOf 实战反证金标准: 命中加分 (+1 each)
  if (sig.anyOf && sig.anyOf.length > 0) {
    for (const opt of sig.anyOf) {
      if (allTexts.includes(opt) || allContents.includes(opt)) score += 1;
    }
  }

  return score;
}

// ========== 实战反证金标准 classifyCurrentPage ==========

export async function classifyCurrentPage(): Promise<{ page: QianjiPageId; score: number }> {
  const { texts, contents, chromeTexts, chromeContents, foregroundPkg } = await getCurrentAllNodes();
  const allTexts = texts.join('|');
  const allContents = contents.join('|');

  // 实战反证金标准: 前台包名粗筛 (千机/ZBB/桌面)
  const isQianji = foregroundPkg === 'com.lianjia.anchang' || foregroundPkg.includes('qianji');
  const isZbb = foregroundPkg === 'com.zbb.automation.v4';

  // 只对相关端评分 (实战反证金标准: 减少无意义匹配)
  const candidates: QianjiPageId[] = [];
  if (isQianji) {
    candidates.push('qianji_home', 'qianji_customer_detail', 'qianji_share_dialog', 'qianji_invalid_reason', 'qianji_other');
  } else if (isZbb) {
    candidates.push('zbb_home');
  } else if (foregroundPkg.includes('huawei.android.launcher') || foregroundPkg.includes('launcher')) {
    candidates.push('desktop_home');
  } else if (foregroundPkg.includes('tencent.wework')) {
    candidates.push('wework_home');
  } else {
    candidates.push('unknown');
  }

  let bestPage: QianjiPageId = 'unknown';
  let bestScore = 0;
  for (const pid of candidates) {
    const sig = QIANJI_SIGNATURES[pid];
    const score = scorePage(sig, allTexts, allContents, chromeTexts, chromeContents);
    if (score > bestScore) {
      bestScore = score;
      bestPage = pid;
    }
  }
  return { page: bestPage, score: bestScore };
}

// ========== 实战反证金标准 classifyScreenKind ==========

/**
 * 入口判断: 老板要的 3 种情况
 * - 当前 = 千机 (任何 pageId) → 'qianji_inside'
 * - 当前 = ZBB → 'zbb_home'
 * - 当前 = 桌面 → 'desktop_home'
 * - 其他 → 'other'
 */
export type ScreenKind = 'qianji_inside' | 'zbb_home' | 'desktop_home' | 'other';

export async function classifyScreenKind(): Promise<ScreenKind> {
  const { page } = await classifyCurrentPage();
  if (page === 'qianji_home' || page === 'qianji_customer_detail' || page === 'qianji_share_dialog' || page === 'qianji_invalid_reason' || page === 'qianji_other') {
    return 'qianji_inside';
  }
  if (page === 'zbb_home') return 'zbb_home';
  if (page === 'desktop_home') return 'desktop_home';
  return 'other';
}