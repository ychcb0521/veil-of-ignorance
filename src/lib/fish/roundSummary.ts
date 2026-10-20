/**
 * 每一轮捕捞的过程摘要：这一轮扫了哪些币、各自截止时的读数与结论。用来回答
 * 「凭什么击中」（本币读数在本轮排第几）与「为什么避开了其他噪音」（其余币分别卡在哪一步）。
 * 【用户要求】2026-10-20「在捕捉到的信号后面加一列（捕捞过程），点开之后要能够看到凭什么击中到了信号、以及为什么能避开其他噪音」。
 * 只存浏览器本机（按账号分区），不改鱼的记录、不进交易状态同步；只留最近 40 轮。
 */
import { getUserPrefix } from '@/lib/userStoragePrefix';

export interface FishRoundRow { symbol: string; exchange?: string; market?: string; reading: number; outcome: string }
export interface FishRoundEntry { symbol: string; exchange?: string; market?: string; reading: number; outcome: string }
export interface FishRoundSummary {
  version: 1;
  /** 单算法：该算法的键；多重算法：组合键（交集 / 并集各不相同）。 */
  algorithmKey: string;
  /** 单算法：截止时刻；多重算法：各算法的截止时刻都记在 cutoffs。 */
  cutoffMs: number;
  cutoffs?: number[];
  anchorMs: number;
  createdAt: number;
  direction: '>' | '<';
  threshold: number;
  scale: number;
  unit: string;
  /** 扫描被取消：只覆盖了一部分币。 */
  partial: boolean;
  total: number;
  /** 各结论的币数：hit / below / unknown / blocked / readings / gap / history / failed / skipped。 */
  counts: Record<string, number>;
  /** 截止时读数有效（有限数）的币数，排名的分母。 */
  valid: number;
  /** 有效读数的分位数（原值，显示时乘 scale）。 */
  quantiles: { min: number; p50: number; p90: number; p99: number; max: number } | null;
  /** 读数最靠前的 10 个币（按方向：> 从高到低，< 从低到高）。 */
  top: FishRoundEntry[];
  /** 命中币的排名（1 = 最靠前），键见 fishRoundIdentity。 */
  ranks: Record<string, number>;
  /** 多重算法：合并方式、各算法的键与命中数。 */
  combination?: 'and' | 'or';
  members?: { algorithmKey: string; hits: number }[];
}

export const fishRoundIdentity = (r: { exchange?: string; market?: string; symbol: string }) => `${r.exchange ?? 'binance'}|${r.market ?? 'crypto'}|${r.symbol}`;
const storageKey = () => `veil:fish-rounds:v1:${getUserPrefix()}`;
const LIMIT = 40;

function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return lo === hi ? sorted[lo] : sorted[lo] * (1 - (at - lo)) + sorted[hi] * (at - lo);
}

/** 由本轮逐币结果算摘要（纯计算）。 */
export function summarizeFishRound(rows: readonly FishRoundRow[], meta: Pick<FishRoundSummary, 'algorithmKey' | 'cutoffMs' | 'anchorMs' | 'direction' | 'threshold' | 'scale' | 'unit' | 'partial'> & { createdAt?: number }): FishRoundSummary {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const better = (a: number, b: number) => meta.direction === '<' ? a - b : b - a;
  const readable = rows.filter(r => Number.isFinite(r.reading));
  const ordered = [...readable].sort((a, b) => better(a.reading, b.reading) || fishRoundIdentity(a).localeCompare(fishRoundIdentity(b)));
  const ranks: Record<string, number> = {};
  ordered.forEach((r, i) => { if (r.outcome === 'hit') ranks[fishRoundIdentity(r)] = i + 1; });
  const sorted = readable.map(r => r.reading).sort((a, b) => a - b);
  return {
    version: 1, algorithmKey: meta.algorithmKey, cutoffMs: meta.cutoffMs, anchorMs: meta.anchorMs, createdAt: meta.createdAt ?? Date.now(),
    direction: meta.direction, threshold: meta.threshold, scale: meta.scale, unit: meta.unit, partial: meta.partial,
    total: rows.length, counts, valid: readable.length,
    quantiles: sorted.length ? { min: sorted[0], p50: quantile(sorted, .5), p90: quantile(sorted, .9), p99: quantile(sorted, .99), max: sorted[sorted.length - 1] } : null,
    top: ordered.slice(0, 10).map(r => ({ symbol: r.symbol, exchange: r.exchange, market: r.market, reading: r.reading, outcome: r.outcome })),
    ranks,
  };
}

function readAll(): FishRoundSummary[] {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? '[]');
    return Array.isArray(x) ? x.filter((s): s is FishRoundSummary => !!s && s.version === 1 && typeof s.algorithmKey === 'string' && Number.isFinite(s.cutoffMs)) : [];
  } catch { return []; }
}
/** 存一轮（同一算法、同一截止只留最新一份）。存不下就放弃——这只是可重算的说明，不影响捕捞。 */
export function saveFishRound(summary: FishRoundSummary): void {
  const same = (s: FishRoundSummary) => s.algorithmKey === summary.algorithmKey && s.cutoffMs === summary.cutoffMs;
  const next = [summary, ...readAll().filter(s => !same(s))].slice(0, LIMIT);
  try { localStorage.setItem(storageKey(), JSON.stringify(next)); }
  catch { try { localStorage.setItem(storageKey(), JSON.stringify(next.slice(0, 5))); } catch { /* 本机存不下：点开时说明没有本轮记录 */ } }
}
/** 找某条鱼所在那一轮：单算法按（算法键, 截止）；多重算法按（组合键, 截止在 cutoffs 里）。 */
export function readFishRound(algorithmKey: string | undefined, cutoffMs: number | undefined): FishRoundSummary | null {
  if (!algorithmKey || !Number.isFinite(cutoffMs)) return null;
  return readAll().find(s => s.algorithmKey === algorithmKey && (s.cutoffMs === cutoffMs || !!s.cutoffs?.includes(cutoffMs!))) ?? null;
}
