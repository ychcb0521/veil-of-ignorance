import { BinanceRateLimitError, readBinanceCooldown } from '../binanceRateLimit';
import { FishError, fishDelay } from './shared';

/** A quality task keeps its frozen inputs while a public-data cooldown expires.
 * Wrap adapter calls before reconstruction can cache a ban or an engine can
 * turn a temporary HTTP response into a permanent row result. */
export function createQualityMarketRetry(signal: AbortSignal, onWaiting?: (until?: number) => void) {
  const waiting = new Map<symbol, number>();
  const publish = () => onWaiting?.(waiting.size ? Math.max(...waiting.values()) : undefined);
  return async function retry<T>(read: () => Promise<T>): Promise<T> {
    const token = Symbol();
    try {
      for (;;) {
        if (signal.aborted) throw new DOMException('已暂停', 'AbortError');
        try { return await read(); }
        catch (error) {
          if (signal.aborted) throw new DOMException('已暂停', 'AbortError');
          const limited = error instanceof BinanceRateLimitError || error instanceof FishError && [418,429].includes(error.detail?.status ?? 0);
          if (!limited) throw error;
          const until = Math.max(readBinanceCooldown()?.until ?? 0,
            error instanceof BinanceRateLimitError ? error.cooldown.until : 0, Date.now() + 1000);
          waiting.set(token, until); publish();
          // This wait owns no network slot and remains immediately cancellable.
          await fishDelay(until - Date.now(), signal);
          waiting.delete(token); publish();
        }
      }
    } finally { if (waiting.delete(token)) publish(); }
  };
}
