import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { intervalToMs } from '@/hooks/useBinanceData';
import { useReplayKlines } from '@/hooks/useReplayKlines';
import { assertBinancePublicAllowed, noteBinanceRateLimit } from '@/lib/binanceRateLimit';
import { RESEARCH_INTERVALS, type ResearchInterval } from '@/lib/deepRsa/marketData';
import { getPriceDecimals } from '@/lib/formatters';
import type { InstantPositionFill } from '@/lib/fish/instantCampaign';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { isTuringCupSymbol } from '@/lib/turingCupSymbol';
import { ReplayKlineChart } from '@/components/journal/ReplayKlineChart';
import type { PositionTicker } from './TickerBar';

export interface PositionChartPreview {
  symbol: string;
  at: number;
  live: boolean;
  livePositionKey?: string;
  source?: InstantPositionFill['source'];
}

const HISTORY_MS = 3 * 24 * 60 * 60_000;
const INITIAL_BARS = 240;
const QUOTE_REFRESH_MS = 15_000;

type BinanceFields = Record<string, unknown>;

function marketNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function readBinancePreview(path: string, symbol: string, signal: AbortSignal): Promise<BinanceFields> {
  assertBinancePublicAllowed();
  const query = new URLSearchParams({ symbol });
  const response = await fetch('https://fapi.binance.com/fapi/v1/' + path + '?' + query, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 418 || response.status === 429) noteBinanceRateLimit(response);
    throw Error('行情暂不可用');
  }
  const row: BinanceFields = await response.json();
  if (row?.symbol !== symbol) throw Error('行情标的不匹配');
  return row;
}

function useBinancePositionTicker(symbol: string | undefined) {
  const [result, setResult] = useState<{ symbol: string; ticker: PositionTicker; lastPrice?: number }>();
  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden) return;
      const [quote, daily] = await Promise.allSettled([
        readBinancePreview('premiumIndex', symbol, controller.signal),
        readBinancePreview('ticker/24hr', symbol, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const mark = quote.status === 'fulfilled' ? quote.value : undefined;
      const stats = daily.status === 'fulfilled' ? daily.value : undefined;
      setResult({
        symbol,
        lastPrice: marketNumber(stats?.lastPrice),
        ticker: {
          markPrice: marketNumber(mark?.markPrice),
          indexPrice: marketNumber(mark?.indexPrice),
          fundingRate: marketNumber(mark?.lastFundingRate),
          nextFundingAt: marketNumber(mark?.nextFundingTime),
          daily: stats && {
            high: marketNumber(stats.highPrice),
            low: marketNumber(stats.lowPrice),
            baseVolume: marketNumber(stats.volume),
            volume: marketNumber(stats.quoteVolume),
            change: marketNumber(stats.priceChange),
            changePct: marketNumber(stats.priceChangePercent),
          },
        },
      });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), QUOTE_REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [symbol]);
  return result?.symbol === symbol ? result : undefined;
}

export function usePositionMarketPreview(preview: PositionChartPreview | null, initialInterval: string) {
  const [selection, setSelection] = useState<{ preview: PositionChartPreview; interval: ResearchInterval }>();
  const interval = selection && selection.preview === preview
    ? selection.interval
    : RESEARCH_INTERVALS.find(value => value === initialInterval) ?? '5m';
  const step = intervalToMs(interval);
  const through = preview ? Math.floor(preview.at / step) * step : 0;
  const from = through - Math.ceil(HISTORY_MS / step) * step;
  const source = preview?.source;
  const nativeBinance = (!source?.exchange || source.exchange === 'binance') && source?.market !== 'us_stock';
  const marketSymbol = nativeBinance ? source?.binanceSymbol ?? preview?.symbol : preview?.symbol;
  // Binance's endTime is inclusive. The external-market adapter takes a closing boundary.
  const end = nativeBinance ? through - 1 : through;
  const { klines, loading, error, reload } = useReplayKlines(marketSymbol ?? '', from, end, interval, source);
  const ticker = useBinancePositionTicker(preview?.live && nativeBinance && marketSymbol &&
    !isTuringCupSymbol(marketSymbol) ? marketSymbol : undefined);
  const data = !preview || loading || error ? [] : klines;
  const currentPrice = ticker?.lastPrice ?? data.at(-1)?.close ?? 0;
  return {
    data, loading, error, reload, interval, step, through, currentPrice,
    pricePrecision: getPriceDecimals(currentPrice || ticker?.ticker.markPrice || 0),
    ticker: ticker?.ticker ?? {},
    setInterval: (next: ResearchInterval) => { if (preview) setSelection({ preview, interval: next }); },
  };
}

export function PositionMarketPreview({ preview, market, onClose }: {
  preview: PositionChartPreview;
  market: ReturnType<typeof usePositionMarketPreview>;
  onClose: () => void;
}) {
  const { data, loading, error, reload, interval, step, through, setInterval } = market;
  const venue = isTuringCupSymbol(preview.symbol) ? '离线行情' : EXCHANGE_NAMES[preview.source?.exchange ?? 'binance'];
  // Keep the full history for panning while giving the recent candles enough space to read.
  const visibleStart = data[Math.max(0, data.length - INITIAL_BARS)]?.time;
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-xs font-medium">{preview.symbol} · {venue} · {preview.live ? '行情预览' : '历史行情预览'}</span>
        <select aria-label="行情周期" value={interval} onChange={event => setInterval(event.target.value as ResearchInterval)}
          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs">
          {RESEARCH_INTERVALS.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <button type="button" aria-label="关闭行情预览" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted" onClick={onClose}>
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
    <div className="min-h-0 flex-1">
      {loading || error || data.length === 0 ? <div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        {loading ? '正在加载行情…' : error ? '行情加载失败' : '暂无行情'}
        {error && <button type="button" className="text-primary hover:underline" onClick={reload}>重试</button>}
      </div> : <ReplayKlineChart klines={data} currentTime={through} intervalMs={step} symbol={preview.symbol}
        marketSource={preview.source} fitAll initialVisibleStartTime={visibleStart} initialVisibleEndTime={through} retainFullHistory />}
    </div>
  </div>;
}
