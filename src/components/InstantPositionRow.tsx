import { useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { useInstantPositionQuote } from '@/hooks/useInstantPositionQuote';
import type { QualityResult } from '@/lib/fish/quality';
import type { QualityMirrorFill } from '@/lib/fish/qualityMirror';
import { instantPositionValuation, type InstantPositionFill } from '@/lib/fish/instantCampaign';
import { formatBeijingTime } from '@/lib/timeFormat';
import { formatAmount, formatPrice, formatSignedUSDT, formatUSDT } from '@/lib/formatters';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { positionBreakevenPrice } from '@/lib/positionBreakeven';
import { ActionBtn, DetailCell, EntryPriceCell, PositionCardHeader, PositionCardPnl, positionActionsClass, positionCardClass, positionDetailsClass } from './PositionCard';

const linkClass = 'flex flex-1 items-center justify-center border-r border-border/50 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground';

export function InstantPositionRow({ position, mirror, monitor, close, entryMode, onToggleEntry }: {
  position: InstantPositionFill;
  monitor?: QualityResult;
  mirror?: QualityMirrorFill;
  close?: (position: InstantPositionFill) => Promise<void>;
  entryMode: 'entry' | 'breakeven';
  onToggleEntry: () => void;
}) {
  const inRouter = useInRouterContext();
  const { source, buyAt, leverage } = position;
  const { symbol } = source;
  const quoteState = useInstantPositionQuote(position);
  const quote = quoteState?.value;
  const held = instantPositionValuation(position, monitor, mirror, quote?.price);
  const breakeven = positionBreakevenPrice({ side: 'LONG', inverse: false, coinsAtEntry: held.remainingQuantity,
    avgEntry: held.averageEntryPrice, mirrorUsd: held.mirrorPnl, mirrorCoin: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sell = async () => {
    if (!close || busy || !window.confirm('手动卖出 ' + symbol + ' 的全部即时交易模拟仓位？')) return;
    setBusy(true);
    setError('');
    try { await close(position); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '平仓失败，请重试'); }
    finally { setBusy(false); }
  };
  const campaignPath = '/journal/campaigns/' + encodeURIComponent(position.id) + '?section=instant';
  const quoteLabel = quote?.kind === 'close' ? '最近收盘价' : quoteState?.delayed ? '最近标记价格' : '标记价格';
  return <div className={positionCardClass} data-testid="instant-position">
    <PositionCardHeader asset={symbol.replace(/USDT$/, '')} contract="USDT 永续" long leverage={leverage} mode="逐仓">
      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">即时交易 · 模拟</span>
      <span className="ml-auto text-[10px] text-muted-foreground">{EXCHANGE_NAMES[source.exchange ?? 'binance']} · 开仓 {formatBeijingTime(buyAt)}</span>
    </PositionCardHeader>
    <PositionCardPnl pnl={held.pnl} roe={held.roe}/>
    <div className={positionDetailsClass}>
      <DetailCell label="持仓数量" value={formatAmount(held.remainingQuantity)} />
      <DetailCell label="保证金" value={formatUSDT(held.margin) + ' USDT'} />
      <DetailCell label="保证金比率" value="—" title="即时交易的模拟方案按持仓监测条件退出。" />
      <EntryPriceCell mode={entryMode} onToggle={onToggleEntry}
        entryText={formatPrice(held.averageEntryPrice, symbol)} breakevenText={breakeven == null ? '—' : formatPrice(breakeven, symbol)}
        breakevenTitle="保本线按余仓成本扣除已落袋的镜像盈利计算。" />
      <DetailCell label={quoteLabel} value={quote ? formatPrice(quote.price, symbol) : '—'} />
      <DetailCell label="强平价格" value="—" title="即时交易的模拟方案按持仓监测条件退出。" />
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-2 text-[10px] text-muted-foreground">
      <span>报价时间 {quote ? formatBeijingTime(quote.at) : '—'}</span>
      <span>已实现盈亏 {formatSignedUSDT(held.realizedPnl)} USDT</span>
      {position.monitor && <span>持仓模板 {position.monitor.name}</span>}
      {held.mirror && <span>镜像平衡减仓已成交 {(held.mirror.fraction * 100).toFixed(1)}%</span>}
      {held.additions.length > 0 && <span>加仓 {held.additions.length} 次</span>}
      {held.reductions.some(fill => fill.fraction > 0) && <span>减仓 {held.reductions.filter(fill => fill.fraction > 0).length} 次</span>}
    </div>
    {error && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{error}</p>}
    <div className={positionActionsClass}>
      {inRouter ? <Link to={campaignPath} state={{ fromInstantPosition: true }} className={linkClass}>交易战役</Link> : <a href={campaignPath} className={linkClass}>交易战役</a>}
      <ActionBtn danger disabled={busy || !close} onClick={() => void sell()} label={busy ? '平仓中…' : '平仓'}/>
    </div>
  </div>;
}
