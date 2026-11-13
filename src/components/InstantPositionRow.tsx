import { useEffect, useState } from 'react';
import { markPageInstantPosition } from '@/hooks/useFish';
import type { QualityMirrorFill } from '@/lib/fish/qualityMirror';
import type { InstantPositionFill } from '@/lib/fish/instantCampaign';
import { formatBeijingTime } from '@/lib/timeFormat';
import { formatAmount, formatPrice, formatSignedUSDT } from '@/lib/formatters';

export function InstantPositionRow({ position, mirror, close }: {
  position: InstantPositionFill; mirror?: QualityMirrorFill; close: (position: InstantPositionFill) => Promise<void>;
}) {
  const [mark, setMark] = useState<{ at: number; price: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const update = () => {
      if (running || controller.signal.aborted || document.hidden || !navigator.onLine) return;
      running = true;
      void markPageInstantPosition(position, controller.signal).then(value => {
        if (!controller.signal.aborted) setMark(value);
      }, () => undefined).finally(() => { running = false; });
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [position.id, position.buyAt, position.source.symbol, position.source.exchange, position.source.market]);
  const notional = position.marginUsdt * position.leverage;
  const fraction = mirror?.fraction ?? 0;
  const quantity = notional / position.entryPrice * (1 - fraction);
  const pnl = mark ? (mark.price - position.entryPrice) * quantity : null;
  const sell = async () => {
    if (busy || !window.confirm('手动卖出 ' + position.source.symbol + ' 的全部即时交易模拟仓位？')) return;
    setBusy(true); setError('');
    try { await close(position); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '卖出失败，请重试'); }
    finally { setBusy(false); }
  };
  return <div className="rounded-md border border-border bg-card px-3 py-2 text-xs" data-testid="instant-position">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="font-semibold">{position.source.symbol}</span>
      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">即时交易 · 模拟多单</span>
      <span>开仓 {formatBeijingTime(position.buyAt)}</span>
      <span>剩余数量 {formatAmount(quantity)}</span>
      <span>开仓价 {formatPrice(position.entryPrice, position.source.symbol)}</span>
      <span>保证金 {position.marginUsdt} USDT · {position.leverage} 倍 · 名义 {notional} USDT</span>
      {mirror && <span className="text-primary">镜像平衡减仓已成交 {(fraction * 100).toFixed(1)}% · {formatPrice(mirror.price, position.source.symbol)} · 已实现 {formatSignedUSDT(notional * fraction * (mirror.price / position.entryPrice - 1))} USDT</span>}
      <span>最近收盘 {mark ? formatPrice(mark.price, position.source.symbol) : '—'}</span>
      <span>浮动盈亏 {pnl == null ? '—' : formatSignedUSDT(pnl) + ' USDT'}</span>
      <button type="button" disabled={busy} onClick={() => void sell()}
        className="ml-auto rounded border border-border px-2 py-1 text-destructive hover:bg-destructive/10 disabled:opacity-60">{busy ? '卖出中…' : '手动卖出'}</button>
    </div>
    {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
  </div>;
}
