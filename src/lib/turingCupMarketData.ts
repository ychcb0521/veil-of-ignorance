import { isTuringCupSymbol, turingCupTicker } from './turingCupSymbol';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

type KlineQuery = { startTime?: number; endTime?: number; limit?: number };
type MarketClient = Pick<SupabaseClient<Database>, 'rpc'>;
let marketClient: MarketClient | undefined;

// Chart workers share the parsers but do not initialize an authenticated browser client.
export function connectTuringCupMarket(client: MarketClient): void {
  marketClient = client;
}

function clientFor(signal?: AbortSignal): MarketClient {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  if (!marketClient) throw Error('图灵杯离线行情连接尚未就绪');
  return marketClient;
}

/** Same row shape as the market readers already use, served from the signed-in account's archive. */
export async function readTuringCupKlines(
  symbol: string, interval: string, query: KlineQuery, signal?: AbortSignal,
): Promise<unknown[][]> {
  const request = clientFor(signal).rpc('read_turing_cup_klines', {
    p_symbol: turingCupTicker(symbol), p_interval: interval,
    p_start: query.startTime == null ? null : Math.ceil(query.startTime),
    p_end: query.endTime == null ? null : Math.floor(query.endTime),
    p_limit: query.limit ?? 1000,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  if (error) throw Error('图灵杯离线行情暂不可读，请确认已登录且数据仓库已就绪');
  if (!Array.isArray(data) || !data.every(Array.isArray)) throw Error('图灵杯离线 K 线格式无效');
  return data;
}

export async function readTuringCupTickSize(symbol: string, signal?: AbortSignal): Promise<number | null> {
  const request = clientFor(signal).rpc('read_turing_cup_tick_size', { p_symbol: turingCupTicker(symbol) });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  const size = Number(data);
  return !error && Number.isFinite(size) && size > 0 ? size : null;
}

/** Route only namespaced requests to the archive. Ordinary Binance requests keep their transport. */
export async function fetchSignalMarketKlines(url: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<Response> {
  const params = new URL(url).searchParams;
  const symbol = params.get('symbol') ?? '';
  if (!isTuringCupSymbol(symbol)) return signal ? fetcher(url, { signal }) : fetcher(url);
  const number = (key: string) => params.has(key) ? Number(params.get(key)) : undefined;
  const rows = await readTuringCupKlines(symbol, params.get('interval') ?? '1m', {
    startTime: number('startTime'), endTime: number('endTime'), limit: number('limit'),
  }, signal);
  return Response.json(rows);
}
