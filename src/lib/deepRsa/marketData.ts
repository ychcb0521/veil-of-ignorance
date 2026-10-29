import { assertBinancePublicAllowed, noteBinanceRateLimit, BinanceRateLimitError } from '@/lib/binanceRateLimit';
/**
 * Deep RSA：在用户自己的浏览器里取币安 U 本位永续行情（与主图同一个公开接口，不需要登录币安、不需要密钥）。
 *
 * - 5m K 线保留主动买入量列（parseBinanceKlineRow），分页 1500 根一次。
 * - 主域名网关 / 断网失败可换 www.binance.com 备用域名；限频不换域名，与 useReplayKlines 同一套做法。
 * - 429 / 418 按 Retry-After 保存共享冷却，停止本批次，冷却后可重试；标的不存在（400）直接报「无此合约」，不重试。
 * - 资金费历史：/fapi/v1/fundingRate。
 * - 同一会话内按（标的, 起止）缓存，重跑不重复下载。
 * fetchFn 可注入，测试里不连网。
 */
import { BAR_MS, parseBinanceKlineRow, type ResearchBar } from '@/lib/deepRsa/window';
import type { FundingEvent } from '@/lib/deepRsa/backtest';

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> }>;

export type MarketDataErrorKind = 'no_symbol' | 'rate_limit' | 'network' | 'invalid' | 'aborted';

export class MarketDataError extends Error {
  constructor(message: string, readonly kind: MarketDataErrorKind) {
    super(message);
  }
}

const HOSTS = ['https://fapi.binance.com', 'https://www.binance.com'];
const KLINE_LIMIT = 1500;
/**
 * 币安按请求里的 limit 计权重：≤ 1000 根 = 5，> 1000 根 = 10（每分钟总额有限，超了就限流退避）。
 * 所以只要实际需要的根数；一段不超过 1000 根时权重减半。
 */
export const KLINE_LIGHT_LIMIT = 1000;
const MAX_ATTEMPTS = 4;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new MarketDataError('已取消', 'aborted')); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new MarketDataError('已取消', 'aborted')); }, { once: true });
  });
}

async function getJson(path: string, fetchFn: FetchFn, signal?: AbortSignal): Promise<unknown> {
  let lastError: MarketDataError = new MarketDataError('请求失败', 'network');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    if (signal?.aborted) throw new MarketDataError('已取消', 'aborted');
    try { assertBinancePublicAllowed(); } catch(e) { throw new MarketDataError((e as Error).message,'rate_limit'); }
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await fetchFn(`${host}${path}`, { signal });
    } catch (error) {
      if (signal?.aborted) throw new MarketDataError('已取消', 'aborted');
      lastError = new MarketDataError(`网络错误：${error instanceof Error ? error.message : String(error)}`, 'network');
      await sleep(300 * 2 ** attempt, signal);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 400) throw new MarketDataError('币安没有这个永续合约', 'no_symbol');
    if (res.status === 429 || res.status === 418) {
      noteBinanceRateLimit(res);let body:unknown;try{body=await res.json();}catch{/* Headers still enforce cooldown. */}
      throw new MarketDataError(new BinanceRateLimitError(noteBinanceRateLimit(res,body)).message,'rate_limit');
    }
    lastError = new MarketDataError(`币安返回 ${res.status}`, 'network');
    await sleep(300 * 2 ** attempt, signal);
  }
  throw lastError;
}

const klineCache = new Map<string, ResearchBar[]>();
const fundingCache = new Map<string, FundingEvent[]>();

/** 测试之间清缓存。 */
export function clearMarketDataCache(): void {
  klineCache.clear();
  fundingCache.clear();
}

/** 研究可用的 K 线周期（币安 U 本位合约支持的）。默认 5m。 */
export const RESEARCH_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] as const;
export type ResearchInterval = (typeof RESEARCH_INTERVALS)[number];
export function intervalMs(interval: ResearchInterval): number {
  const n = Number.parseInt(interval, 10);
  const unit = interval.slice(String(n).length);
  return n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
}

/** [fromMs, toMs) 内开盘的 K 线（默认 5m，含主动买入量）；非法行丢弃，由覆盖率体现。 */
export async function fetchResearchKlines(
  symbol: string, fromMs: number, toMs: number, fetchFn: FetchFn = fetch as unknown as FetchFn, signal?: AbortSignal,
  /** Deep dig 可选别的周期；默认 5m（Deep RSA 各步与 24h 客观结果都用 5m）。 */
  interval: ResearchInterval = '5m',
): Promise<ResearchBar[]> {
  const barMs = intervalMs(interval);
  const from = Math.floor(fromMs / barMs) * barMs;
  const key = `${symbol}|${interval}|${from}|${toMs}`;
  const hit = klineCache.get(key);
  if (hit) return hit;
  const out: ResearchBar[] = [];
  let cursor = from;
  while (cursor < toMs) {
    const limit = Math.max(1, Math.min(KLINE_LIMIT, Math.ceil((toMs - cursor) / barMs)));
    const qs = new URLSearchParams({ symbol, interval, startTime: String(cursor), endTime: String(toMs - 1), limit: String(limit) });
    const raw = await getJson(`/fapi/v1/klines?${qs}`, fetchFn, signal);
    if (!Array.isArray(raw)) throw new MarketDataError('K 线响应格式无效', 'invalid');
    if (raw.length === 0) break;
    let lastOpen = cursor;
    for (const row of raw) {
      const bar = Array.isArray(row) ? parseBinanceKlineRow(row) : null;
      if (bar && bar.openTime >= from && bar.openTime < toMs) out.push(bar);
      const open = Array.isArray(row) ? Number(row[0]) : Number.NaN;
      if (Number.isFinite(open)) lastOpen = Math.max(lastOpen, open);
    }
    if (raw.length < limit) break;
    cursor = lastOpen + barMs;
  }
  klineCache.set(key, out);
  return out;
}

/** (fromMs, toMs] 内的资金费结算记录。 */
export async function fetchFundingHistory(
  symbol: string, fromMs: number, toMs: number, fetchFn: FetchFn = fetch as unknown as FetchFn, signal?: AbortSignal,
): Promise<FundingEvent[]> {
  const key = `${symbol}|${fromMs}|${toMs}`;
  const hit = fundingCache.get(key);
  if (hit) return hit;
  const out: FundingEvent[] = [];
  let cursor = fromMs;
  while (cursor < toMs) {
    const qs = new URLSearchParams({ symbol, startTime: String(cursor), endTime: String(toMs), limit: '1000' });
    const raw = await getJson(`/fapi/v1/fundingRate?${qs}`, fetchFn, signal);
    if (!Array.isArray(raw)) throw new MarketDataError('资金费响应格式无效', 'invalid');
    for (const item of raw as { fundingTime?: unknown; fundingRate?: unknown }[]) {
      const fundingTime = Number(item?.fundingTime);
      const rate = Number(item?.fundingRate);
      if (Number.isFinite(fundingTime) && Number.isFinite(rate) && fundingTime > fromMs && fundingTime <= toMs) out.push({ fundingTime, rate });
    }
    if (raw.length < 1000) break;
    cursor = Math.max(cursor + 1, ...out.map(f => f.fundingTime)) + 1;
  }
  out.sort((a, b) => a.fundingTime - b.fundingTime);
  fundingCache.set(key, out);
  return out;
}

/** 有限并发地逐个处理，每完成一个回调一次进度；单个失败不打断其他。 */
export async function mapLimit<T, R>(
  items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>, onDone?: (done: number) => void,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
