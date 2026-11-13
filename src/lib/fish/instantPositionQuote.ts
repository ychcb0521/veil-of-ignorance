import { assertBinancePublicAllowed, noteBinanceRateLimit } from '@/lib/binanceRateLimit';
import { isTuringCupSymbol } from '@/lib/turingCupSymbol';
import type { InstantPositionInput } from './instantCampaign';

type Source = InstantPositionInput['source'];
export interface InstantPositionQuote { at: number; price: number; kind: 'mark' | 'close' }
export const instantQuoteKey = (source: Source) =>
  [source.exchange ?? 'binance', source.market ?? 'crypto', source.binanceSymbol ?? source.symbol].join(':');

export async function readInstantPositionQuote(source: Source, signal: AbortSignal, request: typeof fetch = fetch): Promise<InstantPositionQuote> {
  const exchange = source.exchange ?? 'binance';
  const symbol = source.symbol.toUpperCase();
  if (isTuringCupSymbol(symbol) || !/^[A-Z0-9]+USDT$/.test(symbol)) throw Error('此市场暂无实时报价');
  const base = symbol.slice(0, -4);
  const contract = source.binanceSymbol ?? symbol;
  const routes = {
    binance: 'https://fapi.binance.com/fapi/v1/premiumIndex?' + new URLSearchParams({ symbol: contract }),
    okx: 'https://www.okx.com/api/v5/public/mark-price?' + new URLSearchParams({ instType: 'SWAP', instId: base + '-USDT-SWAP' }),
    bitget: 'https://api.bitget.com/api/v2/mix/market/ticker?' + new URLSearchParams({ productType: 'USDT-FUTURES', symbol }),
    gate: 'https://api.gateio.ws/api/v4/futures/usdt/tickers?' + new URLSearchParams({ contract: base + '_USDT' }),
  };
  if (exchange !== 'binance' && exchange !== 'okx' && exchange !== 'bitget' && exchange !== 'gate') throw Error('此市场暂无实时报价');
  if (exchange === 'binance') assertBinancePublicAllowed();
  const response = await request(routes[exchange], { signal, cache: 'no-store' });
  if (!response.ok) {
    if (exchange === 'binance' && (response.status === 418 || response.status === 429)) noteBinanceRateLimit(response);
    throw Error('标记价格暂不可用');
  }
  const receivedAt = Date.now();
  const body = await response.json();
  const rows = Array.isArray(body?.data) ? body.data : [];
  let value: unknown, timestamp: unknown;
  switch (exchange) {
    case 'binance':
      if (body?.symbol === contract) { value = body.markPrice; timestamp = body.time; }
      break;
    case 'okx': {
      const row = rows.find(item => item?.instId === base + '-USDT-SWAP');
      value = row?.markPx;
      timestamp = row?.ts;
      break;
    }
    case 'bitget': {
      const row = rows.find(item => item?.symbol === symbol);
      value = row?.markPrice;
      timestamp = row?.ts ?? body?.requestTime;
      break;
    }
    case 'gate': {
      const row = Array.isArray(body) ? body.find(item => item?.contract === base + '_USDT') : undefined;
      value = row?.mark_price;
      // This endpoint has no exchange timestamp. Record when the response arrived.
      timestamp = receivedAt;
      break;
    }
  }
  const price = Number(value), at = Number(timestamp);
  if (!(price > 0 && Number.isFinite(price) && Number.isSafeInteger(at) && at > 0 && at <= receivedAt + 15_000)) throw Error('标记价格暂不可用');
  return { at, price, kind: 'mark' };
}
