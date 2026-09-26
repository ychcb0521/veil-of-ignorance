/**
 * 「计算与显示分开」的测试夹具：按时长缩放的 TUT 型战役 + 本地合成的币安 fapi K 线。
 *
 * 一场战役按时长缩放（约 1 小时 / 5 小时 / 12 小时 / 8 天），计算用周期分别是 1m / 5m / 15m / 1h；
 * K 线由 fetch 垫片按 URL 参数现场合成（openTime 是数字、价格是字符串，与 fapi 一样），
 * 影线长度按周期放大——同一段行情换一个周期，峰值浮盈一定不同，
 * 页面若有哪一处计算偷读了盘面那一份 K 线，对照测试就会翻红。
 */
// 只引类型：页面测试会在 vi.mock 的工厂里动态 import 这个夹具。
import type { KlineData } from '@/hooks/useBinanceData';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import {
  CORRECTED_LOSS_OPENED_AT,
  correctedLossLegs,
  correctedLossStoredCampaign,
  correctedLossTradeRecords,
} from '@/test/fixtures/correctedLossCampaign';

export const SYNTH_T0 = Date.parse(CORRECTED_LOSS_OPENED_AT);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const SYNTH_INTERVAL_MS: Record<string, number> = {
  '1m': MINUTE,
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '1h': HOUR,
};

/** 按时长缩放的几场战役：原夹具是 1 小时，按倍数把全部时间拉长。 */
export const SYNTH_CAMPAIGNS = {
  'tut-1h': { scale: 1, label: '约 1 小时' },
  'tut-5h': { scale: 5, label: '约 5 小时' },
  // 12 小时：2.1 倍视窗只有约 300 根 5 分钟线，放得下；是 51 倍拉取超过 6000 根才放宽到 15 分钟
  'tut-12h': { scale: 12, label: '约 12 小时' },
  'tut-8d': { scale: 192, label: '约 8 天' },
} as const;
export type SynthCampaignId = keyof typeof SYNTH_CAMPAIGNS;

function scaleMs(ms: number, scale: number): number {
  return SYNTH_T0 + (ms - SYNTH_T0) * scale;
}
function scaleIso(value: string | null | undefined, scale: number): string | null {
  if (!value) return value ?? null;
  return new Date(scaleMs(Date.parse(value), scale)).toISOString();
}

export interface SynthCampaignData {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
}

export function synthCampaign(id: SynthCampaignId): SynthCampaignData {
  const { scale } = SYNTH_CAMPAIGNS[id];
  const base = correctedLossStoredCampaign({ id });
  const campaign: TradeCampaign = {
    ...base,
    id,
    campaign_code: `C-${id.toUpperCase()}`,
    title: `TUTUSDT ${SYNTH_CAMPAIGNS[id].label}`,
    opened_at: scaleIso(base.opened_at, scale)!,
    closed_at: scaleIso(base.closed_at, scale),
  };
  const legs = correctedLossLegs().map(leg => ({
    ...leg,
    id: `${id}:${leg.id}`,
    campaign_id: id,
    trade_record_id: leg.trade_record_id ? `${id}:${leg.trade_record_id}` : null,
    pre_simulated_time: scaleIso(leg.pre_simulated_time, scale)!,
  }));
  const tradeRecords = correctedLossTradeRecords().map(record => ({
    ...record,
    id: `${id}:${record.id}`,
    positionId: `${id}:${record.positionId}`,
    openTime: scaleMs(record.openTime, scale),
    closeTime: scaleMs(record.closeTime, scale),
  }));
  return { campaign, legs, tradeRecords };
}

/** 连续的价格路径：两条正弦叠加，落在 TUT 那一场的价格带（0.083–0.096）里。 */
export function synthPrice(timeMs: number): number {
  const t = timeMs - SYNTH_T0;
  return 0.0895
    + 0.003 * Math.sin((2 * Math.PI * t) / (2 * HOUR))
    + 0.0015 * Math.sin((2 * Math.PI * t) / (37 * HOUR));
}

/** 一根合成 K 线的原始行（与 fapi /klines 同形：openTime 为数字，价格为字符串）。影线按周期放大。 */
export function synthRawCandle(openTime: number, intervalMs: number): [number, string, string, string, string, string] {
  const open = synthPrice(openTime);
  const close = synthPrice(openTime + intervalMs);
  const wick = 0.0004 * (intervalMs / MINUTE);
  const high = Math.max(open, close) * (1 + wick);
  const low = Math.min(open, close) * (1 - wick);
  return [openTime, open.toFixed(7), high.toFixed(7), low.toFixed(7), close.toFixed(7), '100'];
}

function toKline(raw: ReturnType<typeof synthRawCandle>): KlineData {
  return {
    time: raw[0],
    open: parseFloat(raw[1]),
    high: parseFloat(raw[2]),
    low: parseFloat(raw[3]),
    close: parseFloat(raw[4]),
    volume: parseFloat(raw[5]),
  };
}

/** fapi 的一页：openTime ∈ [startTime, endTime]，按周期对齐，最多 limit 根。 */
export function synthFapiPage(interval: string, startTime: number, endTime: number, limit: number) {
  const intervalMs = SYNTH_INTERVAL_MS[interval];
  if (!intervalMs) throw new Error(`合成夹具不认识的周期：${interval}`);
  const rows: Array<ReturnType<typeof synthRawCandle>> = [];
  for (let time = Math.ceil(startTime / intervalMs) * intervalMs; time <= endTime && rows.length < limit; time += intervalMs) {
    rows.push(synthRawCandle(time, intervalMs));
  }
  return rows;
}

/** useReplayKlines 按分页拉完整个窗口后得到的那一份（参考答案用）。 */
export function synthKlineRange(interval: string, fromTime: number, toTime: number): KlineData[] {
  return synthFapiPage(interval, fromTime, toTime, Number.MAX_SAFE_INTEGER).map(toKline);
}

export interface SynthFetchCall {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
}

/**
 * 本地 fetch 垫片：只认 fapi /klines，按 URL 参数合成；failIntervals 里的周期回 429；
 * holdIntervals 里的周期先压着不回，调 releaseHeld() 才放行（模拟某一份 K 线比另一份晚到）。
 * 任何其它地址一律抛错——测试里不许发真实网络请求。
 */
export function createSynthFapiFetch() {
  const calls: SynthFetchCall[] = [];
  const failIntervals = new Set<string>();
  const holdIntervals = new Set<string>();
  const held: Array<() => void> = [];
  const releaseHeld = () => {
    holdIntervals.clear();
    held.splice(0).forEach(resume => resume());
  };
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== 'fapi.binance.com' || url.pathname !== '/fapi/v1/klines') {
      throw new Error(`测试里不许发真实网络请求：${url.href}`);
    }
    const interval = url.searchParams.get('interval') ?? '';
    const startTime = Number(url.searchParams.get('startTime'));
    const endTime = Number(url.searchParams.get('endTime'));
    const limit = Number(url.searchParams.get('limit') ?? '500');
    calls.push({ symbol: url.searchParams.get('symbol') ?? '', interval, startTime, endTime });
    if (holdIntervals.has(interval)) await new Promise<void>(resume => { held.push(resume); });
    if (failIntervals.has(interval)) {
      return { ok: false, status: 429, json: async () => ({ code: -1003 }) } as unknown as Response;
    }
    const rows = synthFapiPage(interval, startTime, endTime, limit);
    return { ok: true, status: 200, json: async () => rows } as unknown as Response;
  };
  return { fetchImpl, calls, failIntervals, holdIntervals, releaseHeld };
}

/** 按周期数请求：{ '1m': 3, '5m': 1 }。 */
export function countCallsByInterval(calls: SynthFetchCall[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of calls) counts[call.interval] = (counts[call.interval] ?? 0) + 1;
  return counts;
}
