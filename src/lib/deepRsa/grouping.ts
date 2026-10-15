/**
 * Deep RSA · 第 2 步：正样本 / 空白对照组 / 冲突组 / 中间组 / 待判定的分组规则。
 *
 * 只做「给定已算好的标签量 → 分到哪一组」，不取数、不改任何现有功能与交易逻辑。
 * 口径（用户指令，严格执行）：
 *   · 交易战役：正样本 = 理论 b > 3 **或** 盈亏比 > 3；空白对照 = 理论 b < 0.5 **或** 盈亏比 < 0.5。
 *     严格保留 OR，不改 AND；等于 3 不算正样本，等于 0.5 不算对照。
 *     同时满足两边的单列「冲突组」，不进二分类与标签 RDM；两边都不满足（数据完整）的是「中间组」。
 *   · 信号库：正样本 = 星级 ≥ 3（三星算正样本）；空白对照 = 星级 < 3；未评分 = 待判定。
 *   · 缺失、无效、未评分一律不当作 0：保留已知条件；无法确定最终分组的标「待判定」。
 * 战役与信号两类来源分别建组、分别报告；本文件不把两者混成一组。
 */

export type DeepRsaGroup = 'positive' | 'control' | 'conflict' | 'middle' | 'pending' | 'excluded';

/** 单个条件（理论 b / 盈亏比）的状态。na = 结构上不存在（如没有成交加仓的战役没有理论 b），与「该有却缺」区分。 */
export type ConditionState = 'gt3' | 'lt05' | 'mid' | 'missing' | 'na';

export const POSITIVE_THRESHOLD = 3;
export const CONTROL_THRESHOLD = 0.5;

/** 全精度比较，不取两位小数、不加容差：等于 3 与等于 0.5 都落在中间。 */
export function conditionStateOf(value: number | null | undefined, applicable = true): ConditionState {
  if (!applicable) return 'na';
  if (value == null || !Number.isFinite(value)) return 'missing';
  if (value > POSITIVE_THRESHOLD) return 'gt3';
  if (value < CONTROL_THRESHOLD) return 'lt05';
  return 'mid';
}

// ===================== 交易战役 =====================

/** 现算盈亏比的取数来源（与 campaignRealizedPnl.RealizedPnlBasis 同值）。 */
export type PayoffBasis = 'records' | 'mixed' | 'leg_snapshots' | 'events' | 'campaign_summary' | 'none';

export interface CampaignLabelInput {
  campaignId: string;
  symbol: string;
  /** trade_campaigns.direction：本阶段只研究做多，main_long 以外一律排除。 */
  direction: string;
  /** deleted_at 非空（回收站）。 */
  deleted: boolean;
  /** 现算后的状态（closed_profit / closed_loss / closed_breakeven / active / planned / abandoned）。 */
  status: string;
  /** 全部腿都已结算。 */
  settled: boolean;
  payoffBasis: PayoffBasis;
  /** 平仓价校正是否拉齐；null = 未知（例如来自应用导出、不带这个标记）。 */
  correctionsComplete: boolean | null;
  /** 锚点 t₀（主口径，epoch ms）；null = 取不到。 */
  anchorMs: number | null;
  /** 神奇的 b（理论），全精度；null = 算不出。 */
  theoreticalB: number | null;
  /** 是否结构上可能有理论 b：没有成交加仓的战役为 false（理论 b 记 na，不是缺失）。 */
  theoreticalBApplicable: boolean;
  /** 盈亏比（方法一）= 已实现净盈亏 ÷ L₀，全精度倍数（不是 ×100 的百分数）。 */
  payoffRatio: number | null;
  /** L₀（USDT）；≤ 1e-4 视为无效。 */
  initialExpectedMaxLoss: number | null;
}

export type CampaignPendingReason =
  | 'unresolved_status'      // 未结束 / 未全部结算
  | 'no_anchor'              // 取不到锚点
  | 'payoff_basis_weak'      // 盈亏比分子来自落库缓存或无数据
  | 'invalid_l0'             // L₀ 无效
  | 'corrections_incomplete' // 平仓价校正未拉齐（读数可能还会变）
  | 'corrections_unknown'    // 校正状态未知
  | 'condition_missing'      // 某条件该有却缺，最终分组可能翻转
  | 'no_condition_known';    // 两个条件都不可用

export type CampaignExcludedReason = 'deleted' | 'not_main_long';

export interface CampaignGrouping {
  campaignId: string;
  group: DeepRsaGroup;
  /** 理论 b 条件状态（按原始读数判，即使整场被判为待判定也保留）。 */
  theoreticalB: ConditionState;
  /** 盈亏比条件状态；分子来源不可靠或 L₀ 无效时记 missing。 */
  payoff: ConditionState;
  /** 只按已知条件看，正样本条件是否触发。 */
  positiveTriggered: boolean;
  /** 只按已知条件看，对照条件是否触发。 */
  controlTriggered: boolean;
  pendingReasons: CampaignPendingReason[];
  excludedReasons: CampaignExcludedReason[];
}

const WEAK_PAYOFF_BASES: ReadonlySet<PayoffBasis> = new Set(['campaign_summary', 'none']);
const RESOLVED_STATUSES: ReadonlySet<string> = new Set(['closed_profit', 'closed_loss', 'closed_breakeven']);
const L0_EPSILON = 1e-4;

export function groupCampaign(input: CampaignLabelInput): CampaignGrouping {
  const excludedReasons: CampaignExcludedReason[] = [];
  if (input.deleted) excludedReasons.push('deleted');
  if (input.direction !== 'main_long') excludedReasons.push('not_main_long');

  const l0Valid = input.initialExpectedMaxLoss != null && Number.isFinite(input.initialExpectedMaxLoss)
    && input.initialExpectedMaxLoss > L0_EPSILON;
  const payoffReliable = l0Valid && !WEAK_PAYOFF_BASES.has(input.payoffBasis);
  const theoreticalB = conditionStateOf(input.theoreticalB, input.theoreticalBApplicable);
  const payoff = payoffReliable ? conditionStateOf(input.payoffRatio) : 'missing';
  const states = [theoreticalB, payoff];
  const positiveTriggered = states.includes('gt3');
  const controlTriggered = states.includes('lt05');

  const base = { campaignId: input.campaignId, theoreticalB, payoff, positiveTriggered, controlTriggered, excludedReasons };
  if (excludedReasons.length) return { ...base, group: 'excluded', pendingReasons: [] };

  const pendingReasons: CampaignPendingReason[] = [];
  if (!RESOLVED_STATUSES.has(input.status) || !input.settled) pendingReasons.push('unresolved_status');
  if (input.anchorMs == null || !Number.isFinite(input.anchorMs)) pendingReasons.push('no_anchor');
  if (WEAK_PAYOFF_BASES.has(input.payoffBasis)) pendingReasons.push('payoff_basis_weak');
  if (!l0Valid) pendingReasons.push('invalid_l0');
  if (input.correctionsComplete === false) pendingReasons.push('corrections_incomplete');
  if (input.correctionsComplete == null) pendingReasons.push('corrections_unknown');

  // 冲突组只看已知条件：理论 b = 4、盈亏比 = 0.3 这种，无论数据硬不硬都已经「同时满足」。
  // 但整场数据本身不可靠（未结算、校正未拉齐……）时，读数还可能变，仍归待判定。
  const anyMissing = states.includes('missing');
  const anyKnown = states.some(state => state !== 'missing' && state !== 'na');
  let group: DeepRsaGroup;
  if (positiveTriggered && controlTriggered) group = 'conflict';
  else if (positiveTriggered || controlTriggered) {
    if (anyMissing) { group = 'pending'; pendingReasons.push('condition_missing'); }
    else group = positiveTriggered ? 'positive' : 'control';
  } else if (!anyKnown) { group = 'pending'; pendingReasons.push('no_condition_known'); }
  else if (anyMissing) { group = 'pending'; pendingReasons.push('condition_missing'); }
  else group = 'middle';

  if (pendingReasons.length && group !== 'pending') group = 'pending';
  return { ...base, group, pendingReasons };
}

// ===================== 信号库 =====================

export interface SignalLabelInput {
  signalId: string;
  symbol: string;
  /** 信号市场时刻（TradeSignal.timeMs）。 */
  anchorMs: number | null;
  /** 原始星级值（不经 Math.round）：只有 1–5 的整数算有效评分。 */
  quality: unknown;
  /** 兜底区原文。 */
  fallbackZone?: string | null;
  /** 已确认的不可跳转问题（锚点附近没有 U 本位合约 K 线）。 */
  jumpIssue?: unknown;
}

export type SignalPendingReason = 'unrated' | 'invalid_rating' | 'no_anchor';
export type SignalExcludedReason = 'no_market_data' | 'top_zone' | 'followup_outcome_note';

export interface SignalGrouping {
  signalId: string;
  group: DeepRsaGroup;
  stars: number | null;
  pendingReasons: SignalPendingReason[];
  excludedReasons: SignalExcludedReason[];
}

/** 「探顶区」是顶部位，不进做多研究（待用户确认语义前一律单列）。 */
const TOP_ZONE_RE = /探顶区/;
/** 兜底区里写着事后结果的跟进记录（「触发 涨至x」「成功触发」）：不作独立锚点。 */
const OUTCOME_NOTE_RE = /触发|涨至/;

export function groupSignal(input: SignalLabelInput): SignalGrouping {
  const excludedReasons: SignalExcludedReason[] = [];
  if (input.jumpIssue != null) excludedReasons.push('no_market_data');
  const zone = input.fallbackZone ?? '';
  if (TOP_ZONE_RE.test(zone)) excludedReasons.push('top_zone');
  if (OUTCOME_NOTE_RE.test(zone)) excludedReasons.push('followup_outcome_note');

  const raw = input.quality;
  const stars = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : null;
  const pendingReasons: SignalPendingReason[] = [];
  if (raw === undefined || raw === null) pendingReasons.push('unrated');
  else if (stars == null) pendingReasons.push('invalid_rating');
  if (input.anchorMs == null || !Number.isFinite(input.anchorMs)) pendingReasons.push('no_anchor');

  let group: DeepRsaGroup;
  if (excludedReasons.length) group = 'excluded';
  else if (pendingReasons.length) group = 'pending';
  else group = stars! >= 3 ? 'positive' : 'control';
  return { signalId: input.signalId, group, stars, pendingReasons, excludedReasons };
}

// ===================== 同一行情的关联与去重 =====================

export const WINDOW_MS = 48 * 60 * 60_000;

export interface ClusterableEvent {
  id: string;
  symbol: string;
  anchorMs: number;
}

export interface EventCluster {
  clusterId: string;
  symbol: string;
  /** 按锚点先后排列的成员 id。 */
  memberIds: string[];
  /** 代表事件：锚点最早的那个。 */
  representativeId: string;
  firstAnchorMs: number;
  lastAnchorMs: number;
}

/** 与 signalLibrary.normalizeSymbol 同口径：大写、去空格与斜杠、补 USDT。 */
export function normalizeResearchSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace(/[\s/]+/g, '');
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

/**
 * 同一标的、锚点相距不到一个观察窗（48 小时，[t₀−48h, t₀) 会重叠）的事件串成一簇（单链）。
 * 事件对不是独立样本：簇是去重与按时间切分的最小单位，训练 / 验证 / 测试不能把同一簇拆开。
 */
export function clusterEvents(events: readonly ClusterableEvent[], windowMs = WINDOW_MS): EventCluster[] {
  const bySymbol = new Map<string, ClusterableEvent[]>();
  for (const event of events) {
    if (!Number.isFinite(event.anchorMs)) continue;
    const key = normalizeResearchSymbol(event.symbol);
    if (!key) continue;
    const list = bySymbol.get(key) ?? [];
    list.push(event);
    bySymbol.set(key, list);
  }
  const clusters: EventCluster[] = [];
  for (const [symbol, list] of [...bySymbol.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort((a, b) => a.anchorMs - b.anchorMs || a.id.localeCompare(b.id));
    let current: ClusterableEvent[] = [];
    const flush = () => {
      if (!current.length) return;
      clusters.push({
        clusterId: `${symbol}@${current[0].anchorMs}`,
        symbol,
        memberIds: current.map(event => event.id),
        representativeId: current[0].id,
        firstAnchorMs: current[0].anchorMs,
        lastAnchorMs: current[current.length - 1].anchorMs,
      });
      current = [];
    };
    for (const event of sorted) {
      const last = current[current.length - 1];
      if (last && event.anchorMs - last.anchorMs >= windowMs) flush();
      current.push(event);
    }
    flush();
  }
  return clusters;
}

/** 簇内标签是否打架：同时含正样本与对照（例如同一段行情一盈一亏的两场战役）。 */
export function clusterLabelConflict(memberGroups: readonly DeepRsaGroup[]): boolean {
  return memberGroups.includes('positive') && memberGroups.includes('control');
}

// ===================== 随机背景时点 =====================

export interface BackgroundSampleInput {
  symbols: readonly string[];
  fromMs: number;
  toMs: number;
  count: number;
  seed: number;
  /** 离这些事件同标的锚点不足 minGapMs 的候选点丢弃（默认一个观察窗）。 */
  avoid?: readonly ClusterableEvent[];
  minGapMs?: number;
}

export interface BackgroundAnchor {
  id: string;
  symbol: string;
  anchorMs: number;
}

const FIVE_MINUTES_MS = 5 * 60_000;

/** 确定性伪随机（mulberry32）：同一 seed 每次得到同一批点，便于复现。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 背景对照：在给定标的池与时间段里随机抽 5 分钟整点作锚点。
 * 只是「背景」，不预设其结果为失败；结果要在第 5 步按同一套客观定义另算。
 */
export function sampleBackgroundAnchors(input: BackgroundSampleInput): BackgroundAnchor[] {
  const symbols = [...new Set(input.symbols.map(normalizeResearchSymbol).filter(Boolean))].sort();
  const from = Math.ceil(input.fromMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  const to = Math.floor(input.toMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  if (!symbols.length || !(to > from) || !(input.count > 0)) return [];
  const minGap = input.minGapMs ?? WINDOW_MS;
  const avoidBySymbol = new Map<string, number[]>();
  for (const event of input.avoid ?? []) {
    const key = normalizeResearchSymbol(event.symbol);
    avoidBySymbol.set(key, [...(avoidBySymbol.get(key) ?? []), event.anchorMs]);
  }
  const random = mulberry32(input.seed);
  const steps = (to - from) / FIVE_MINUTES_MS;
  const picked: BackgroundAnchor[] = [];
  const seen = new Set<string>();
  const maxTries = input.count * 50;
  for (let tries = 0; picked.length < input.count && tries < maxTries; tries += 1) {
    const symbol = symbols[Math.floor(random() * symbols.length)];
    const anchorMs = from + Math.floor(random() * (steps + 1)) * FIVE_MINUTES_MS;
    const key = `${symbol}@${anchorMs}`;
    if (seen.has(key)) continue;
    if ((avoidBySymbol.get(symbol) ?? []).some(t => Math.abs(t - anchorMs) < minGap)) continue;
    seen.add(key);
    picked.push({ id: `bg-${key}`, symbol, anchorMs });
  }
  return picked.sort((a, b) => a.anchorMs - b.anchorMs || a.symbol.localeCompare(b.symbol));
}

// ===================== 汇总 =====================

export interface GroupCounts {
  positive: number;
  control: number;
  conflict: number;
  middle: number;
  pending: number;
  excluded: number;
}

export function countGroups(groups: readonly { group: DeepRsaGroup }[]): GroupCounts {
  const counts: GroupCounts = { positive: 0, control: 0, conflict: 0, middle: 0, pending: 0, excluded: 0 };
  for (const { group } of groups) counts[group] += 1;
  return counts;
}

/** 两种口径分别分析：只按理论 b、只按盈亏比各自的触发计数（缺失 / na 单独计）。 */
export function conditionBreakdown(groupings: readonly CampaignGrouping[]) {
  const tally = (pick: (g: CampaignGrouping) => ConditionState) => {
    const out: Record<ConditionState, number> = { gt3: 0, lt05: 0, mid: 0, missing: 0, na: 0 };
    for (const g of groupings) out[pick(g)] += 1;
    return out;
  };
  return { theoreticalB: tally(g => g.theoreticalB), payoff: tally(g => g.payoff) };
}
