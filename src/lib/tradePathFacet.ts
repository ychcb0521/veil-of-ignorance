/**
 * 路径主动权切面 · ex-post 谁握着方向盘。
 *
 * 和错题集 / 证伪质量同一份已复盘交易，换一个切面：不按「错误种类」「证伪质量」切，
 * 按「平仓后这条路径把主动权握住了、还是交了出去」切。
 *
 * 录音稿的第一性原理：一笔对的交易从第一手就是盈利的，不该有浮亏；浮亏 = 主动权不在自己手里。
 * 终点指标（赢 / 亏、R 倍数）看不见这一层 —— 扛单赢和干净赢，终点都是赢。
 * 最危险的恰恰是「扛单赢」(变相马丁)：胜率高却靠扛过止损 / 摊低成本换来。
 *
 * 但模拟器握有完整历史 K 线 + 开 / 平仓时间，整条浮盈浮亏路径是「免费」可还原的。
 * 代价：K 线是实时拉取的（useReplayKlines），没法对全部交易一次性批量算 MAE。所以这一层两段式：
 *   1) 即时代理档（本函数）：只用 journal + 成交记录就能定的「路径画像」——
 *      爆仓 / 失控亏 / 受控亏 是看得见的；赢则先记为「待验证」，因为扛单赢藏在赢里。
 *   2) 逐笔按需还原（buildReplayRequest + deriveTradePath）：点开某一笔时才拉那一段 K 线，
 *      把「待验证的赢」拆成干净赢 / 扛单赢，露出 MAE / MFE / 浸亏时长 / 主动权。
 *
 * 这一层是纯函数、无副作用：代理分类 + 聚合 + 还原请求构造，全部可测。
 */
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import type { LegTone } from '@/lib/structureLoop';
import type { TradePathInput } from '@/lib/tradePath';
import { isReviewedMainTrade } from '@/lib/errorTypes';

/**
 * 即时路径代理档（只用成交记录 + 快照就能定，不拉 K 线）：
 *   clean_tp_win    打到止盈离场的赢 —— 大概率干净，但仍可能是扛出来的，待还原验证；
 *   win_unverified  手动 / 其它方式离场的赢 —— 扛单赢最爱藏这里，待还原验证；
 *   controlled_loss 受控亏 —— 按预案止损，主动权握在手里；
 *   overrun_loss    失控亏 —— 平仓还在止损外，扛过了头，主动权交了出去；
 *   liquidated      爆仓 —— 被强平，主动权彻底丧失；
 *   flat            保本 / 走平 —— 没有明确盈亏路径。
 */
export type ProxyPathClass =
  | 'clean_tp_win'
  | 'win_unverified'
  | 'controlled_loss'
  | 'overrun_loss'
  | 'liquidated'
  | 'flat';

export interface ProxyReadout {
  cls: ProxyPathClass;
  tone: LegTone;
  /** 这一档的代理只是「先验」，需要拉 K 线还原才能定论（仅赢需要：拆干净赢 / 扛单赢）。 */
  needsReplay: boolean;
  /** 平仓是否落在止损外（long exit<stop / short exit>stop）；无止损 / 无平仓价为 null。 */
  exitBeyondStop: boolean | null;
  label: string;
}

interface ClassMeta {
  label: string;
  tone: LegTone;
  hint: string;
}

/** 好 → 坏的固定阅读顺序：赢（待验证）在前，失控 / 爆仓在后，保本垫底。 */
export const CLASS_ORDER: ProxyPathClass[] = [
  'clean_tp_win',
  'win_unverified',
  'controlled_loss',
  'overrun_loss',
  'liquidated',
  'flat',
];

export const CLASS_META: Record<ProxyPathClass, ClassMeta> = {
  clean_tp_win: {
    label: '止盈赢 · 待验证',
    tone: 'good',
    hint: '打到止盈离场；但终点看不出是不是扛出来的 —— 点开用 K 线验证主动权',
  },
  win_unverified: {
    label: '手动赢 · 待验证',
    tone: 'warn',
    hint: '手动离场的赢；最危险的「扛单赢」就藏在这里 —— 点开还原浮亏路径',
  },
  controlled_loss: {
    label: '受控亏',
    tone: 'warn',
    hint: '按预案止损，主动权握在手里 —— 亏得干净',
  },
  overrun_loss: {
    label: '失控亏',
    tone: 'bad',
    hint: '平仓还在止损外 —— 扛过了头，主动权交了出去',
  },
  liquidated: {
    label: '爆仓',
    tone: 'bad',
    hint: '被强平 —— 主动权彻底丧失，路径已无需还原',
  },
  flat: {
    label: '保本 / 走平',
    tone: 'muted',
    hint: '没有明确盈亏路径',
  },
};

export interface PathFacetItem {
  journal: TradeJournal;
  record: TradeRecord;
  proxy: ProxyReadout;
}

export interface PathProxyBucket {
  cls: ProxyPathClass;
  label: string;
  tone: LegTone;
  hint: string;
  count: number;
}

export interface TradePathFacet {
  /** 已复盘且已成交的主力单，最近在前。 */
  items: PathFacetItem[];
  /** 按代理档固定顺序聚合。 */
  buckets: PathProxyBucket[];
  totalReviewed: number;
  /** 赢但路径尚未验证的笔数（扛单赢的潜在藏身处）。 */
  unverifiedWinCount: number;
  /** 失控亏笔数（平仓还在止损外）。 */
  overrunCount: number;
  /** 受控亏笔数（按预案止损）。 */
  controlledLossCount: number;
  /** 爆仓笔数。 */
  liquidatedCount: number;
}

/** 方向：以快照 direction 为准，no_entry / 缺失时退回成交记录的 side。 */
function sideOf(j: TradeJournal, record: TradeRecord): 'long' | 'short' {
  if (j.direction === 'long' || j.direction === 'short') return j.direction;
  return record.side === 'SHORT' ? 'short' : 'long';
}

/** 平仓是否落在止损外。无止损价 / 无平仓价 → null（无从判断）。 */
function exitBeyondStopOf(j: TradeJournal, record: TradeRecord): boolean | null {
  const stop = j.pre_planned_stop_loss;
  const exit = record.exitPrice;
  if (stop == null || exit == null) return null;
  return sideOf(j, record) === 'long' ? exit < stop : exit > stop;
}

const isTpExit = (record: TradeRecord): boolean =>
  record.exit_method === 'tp1' || record.exit_method === 'tp2' || record.exit_method === 'tp3';

const isLiquidation = (record: TradeRecord): boolean =>
  record.action === 'LIQUIDATION' || record.exit_method === 'liquidation';

/** 只用成交记录 + 快照，给一笔交易定即时路径代理档。纯函数。 */
export function classifyTradePathProxy(j: TradeJournal, record: TradeRecord): ProxyReadout {
  const exitBeyondStop = exitBeyondStopOf(j, record);
  const outcome = j.post_outcome;

  let cls: ProxyPathClass;
  if (isLiquidation(record)) {
    cls = 'liquidated';
  } else if (outcome === 'win') {
    cls = isTpExit(record) ? 'clean_tp_win' : 'win_unverified';
  } else if (outcome === 'loss') {
    cls = exitBeyondStop === true ? 'overrun_loss' : 'controlled_loss';
  } else {
    cls = 'flat';
  }

  const meta = CLASS_META[cls];
  return {
    cls,
    tone: meta.tone,
    needsReplay: cls === 'clean_tp_win' || cls === 'win_unverified',
    exitBeyondStop,
    label: meta.label,
  };
}

function tsOf(j: TradeJournal): number {
  const s = j.post_reviewed_at ?? j.pre_real_time ?? j.created_at;
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 把已复盘主力单 join 成交记录后，切成路径主动权切面。纯函数。
 * 只纳入能 join 到成交记录的单子（有 trade_record_id 且记录存在）。
 */
export function aggregateTradePathFacet(
  journals: TradeJournal[],
  records: TradeRecord[],
): TradePathFacet {
  const recById = new Map(records.map(r => [r.id, r]));
  const base = journals.filter(isReviewedMainTrade);

  const items: PathFacetItem[] = [];
  for (const j of base) {
    if (!j.trade_record_id) continue;
    const record = recById.get(j.trade_record_id);
    if (!record) continue;
    items.push({ journal: j, record, proxy: classifyTradePathProxy(j, record) });
  }
  items.sort((a, b) => tsOf(b.journal) - tsOf(a.journal));

  const counts = new Map<ProxyPathClass, number>(CLASS_ORDER.map(c => [c, 0]));
  for (const it of items) counts.set(it.proxy.cls, (counts.get(it.proxy.cls) ?? 0) + 1);

  const buckets = CLASS_ORDER.map(cls => ({
    cls,
    label: CLASS_META[cls].label,
    tone: CLASS_META[cls].tone,
    hint: CLASS_META[cls].hint,
    count: counts.get(cls) ?? 0,
  }));

  return {
    items,
    buckets,
    totalReviewed: items.length,
    unverifiedWinCount: (counts.get('clean_tp_win') ?? 0) + (counts.get('win_unverified') ?? 0),
    overrunCount: counts.get('overrun_loss') ?? 0,
    controlledLossCount: counts.get('controlled_loss') ?? 0,
    liquidatedCount: counts.get('liquidated') ?? 0,
  };
}

// ===== 逐笔按需还原：构造拉 K 线 + deriveTradePath 的请求 =====

const MAX_REPLAY_BARS = 500;
const INTERVALS: { interval: string; ms: number }[] = [
  { interval: '1m', ms: 60_000 },
  { interval: '5m', ms: 5 * 60_000 },
  { interval: '15m', ms: 15 * 60_000 },
  { interval: '1h', ms: 60 * 60_000 },
  { interval: '4h', ms: 4 * 60 * 60_000 },
  { interval: '1d', ms: 24 * 60 * 60_000 },
];

/** 选周期：让持仓时长内的 K 线数 ≲ 500，避免一次拉太多。最长退回日线。 */
export function pickInterval(fromTime: number, toTime: number): string {
  const span = Math.max(0, toTime - fromTime);
  for (const { interval, ms } of INTERVALS) {
    if (span / ms <= MAX_REPLAY_BARS) return interval;
  }
  return '1d';
}

export interface ReplayRequest {
  symbol: string;
  fromTime: number;
  toTime: number;
  interval: string;
  /** 喂给 deriveTradePath 的入参，缺 bars —— bars 由调用方拉到 K 线后补上。 */
  input: Omit<TradePathInput, 'bars'>;
}

/**
 * 为某一笔构造「拉 K 线 + 还原路径」的请求。
 * 缺开 / 平仓时间或时间不合法时返回 null（无从还原）。
 */
export function buildReplayRequest(j: TradeJournal, record: TradeRecord): ReplayRequest | null {
  const from = record.openTime;
  const to = record.closeTime;
  if (!(from > 0) || !(to > 0) || to <= from) return null;

  return {
    symbol: record.symbol,
    fromTime: from,
    toTime: to,
    interval: pickInterval(from, to),
    input: {
      side: sideOf(j, record),
      entryPrice: record.entryPrice,
      plannedStop: j.pre_planned_stop_loss ?? null,
      plannedTarget: j.pre_planned_take_profit ?? null,
      exitPrice: record.exitPrice ?? null,
      outcome: j.post_outcome ?? null,
    },
  };
}
