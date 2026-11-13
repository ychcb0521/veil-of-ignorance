import { useEffect, useState } from 'react';
import { markPageInstantPosition } from './useFish';
import type { InstantPositionInput } from '@/lib/fish/instantCampaign';
import { instantQuoteKey, readInstantPositionQuote, type InstantPositionQuote } from '@/lib/fish/instantPositionQuote';

const REFRESH_MS = 5000;
const STALE_MS = 20_000;
const FALLBACK_MS = 60_000;

export function useInstantPositionQuote(position: Pick<InstantPositionInput, 'source' | 'buyAt'>) {
  const { source, buyAt } = position;
  const { id, symbol, timeMs, exchange, market, underlying, binanceSymbol } = source;
  const key = instantQuoteKey(source) + ':' + buyAt;
  const [state, setState] = useState<{ key: string; value?: InstantPositionQuote; delayed: boolean }>();
  useEffect(() => {
    const lifetime = new AbortController();
    const source = { id, symbol, timeMs, exchange, market, underlying, binanceSymbol };
    let latest: InstantPositionQuote | undefined;
    let running = false;
    let nextFallback = 0;
    const refresh = async () => {
      if (running || document.hidden || lifetime.signal.aborted) return;
      if (navigator.onLine === false) { setState({ key, value: latest, delayed: true }); return; }
      running = true;
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(4000)]);
      try {
        const quote = await readInstantPositionQuote(source, signal);
        if (quote.at < buyAt || Date.now() - quote.at > STALE_MS) throw Error('标记价格已延迟');
        if (!latest || quote.at >= latest.at) latest = quote;
        if (!lifetime.signal.aborted) setState({ key, value: latest, delayed: false });
      } catch {
        if (lifetime.signal.aborted) return;
        setState({ key, value: latest, delayed: true });
        if (Date.now() < nextFallback || latest && Date.now() - latest.at <= STALE_MS) return;
        nextFallback = Date.now() + FALLBACK_MS;
        try {
          const quote = await markPageInstantPosition({ source, buyAt }, AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]));
          if (!latest || quote.at > latest.at) latest = { ...quote, kind: 'close' };
          if (!lifetime.signal.aborted) setState({ key, value: latest, delayed: true });
        } catch { /* Keep the last usable price and its original timestamp. */ }
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const resume = () => void refresh();
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      lifetime.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [key, id, symbol, timeMs, exchange, market, underlying, binanceSymbol, buyAt]);
  return state?.key === key ? state : undefined;
}
