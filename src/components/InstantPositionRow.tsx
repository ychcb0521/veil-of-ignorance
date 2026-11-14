import { useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { toast } from 'sonner';
import { useInstantPositionQuote } from '@/hooks/useInstantPositionQuote';
import type { QualityResult } from '@/lib/fish/quality';
import type { QualityMirrorFill } from '@/lib/fish/qualityMirror';
import { instantPositionDisplay, instantPositionValuation, type InstantPositionFill } from '@/lib/fish/instantCampaign';
import { formatBeijingTime } from '@/lib/timeFormat';
import { formatAmount, formatPrice, formatSignedUSDT, formatUSDT, getPriceDecimals } from '@/lib/formatters';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { settlementMarginRatioPct } from '@/lib/tradingSettlement';
import { positionMaintenanceMarginUsd } from '@/lib/positionRiskModel';
import { calcLiquidationPrice } from '@/types/trading';
import type { InstantManualAction, InstantManualExecution } from '@/lib/fish/instantManualExecution';
import { routedQualityPlan } from '@/lib/fish/qualityPlanRouter';
import { effectiveQualitySellPlan } from '@/lib/fish/qualitySellStages';
import { SCREENED_MIRROR } from '@/lib/fish/screenedCda';
import { cardCloseLotSize } from '@/lib/marketLotSize';
import { isUnlimitedLimitMode, type PositionLimitMode } from '@/lib/positionLimitMode';
import { ClosePositionModal } from './ClosePositionModal';
import { TpSlModal } from './TpSlModal';
import { ActionBtn, DetailCell, EntryPriceCell, PositionCardHeader, PositionCardPnl, positionActionsClass, positionCardClass, positionDetailsClass } from './PositionCard';

const linkClass = 'flex flex-1 items-center justify-center border-r border-border/50 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground';

const takeoverNotice = '确认后，这笔模拟仓位由手动操作接管。已成交的加减仓保留，原持仓监测停止下单。';

export function InstantPositionRow({ position, mirror, monitor, manual, manage, limitMode = 'unlimited', entryMode, onToggleEntry }: {
  position: InstantPositionFill;
  monitor?: QualityResult;
  mirror?: QualityMirrorFill;
  manual?: InstantManualExecution;
  manage?: (position: InstantPositionFill, action: InstantManualAction) => Promise<void>;
  limitMode?: PositionLimitMode;
  entryMode: 'entry' | 'breakeven';
  onToggleEntry: () => void;
}) {
  const inRouter = useInRouterContext();
  const { source, buyAt, leverage } = position;
  const { symbol } = source;
  const quoteState = useInstantPositionQuote(position);
  const quote = quoteState?.value;
  const held = instantPositionValuation(position, monitor, mirror, quote?.price, manual);
  const breakeven = held.remainingQuantity > 0 ? (held.remainingCost - held.realizedPnl) / held.remainingQuantity : null;
  const display = instantPositionDisplay(position, held);
  const liq = calcLiquidationPrice(display, symbol);
  const mark = quote?.price ?? 0;
  const ratio = held.pnl == null ? undefined : settlementMarginRatioPct(
    held.remainingQuantity * mark, held.margin, held.pnl, positionMaintenanceMarginUsd(symbol, display, mark),
  );
  const [modal, setModal] = useState<'close' | 'protect'>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const act = async (action: InstantManualAction) => {
    if (!manage || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await manage(position, action);
      setModal(undefined);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const dismiss = () => { if (!submitting.current) setModal(undefined); };
  const plan = position.monitor?.plan;
  const effective = plan && monitor ? effectiveQualitySellPlan(routedQualityPlan(plan, monitor), monitor) : plan;
  const target = effective ? effective.mirrorTakeProfit : SCREENED_MIRROR;
  const automaticTp = held.mirror || !target?.enabled ? undefined : held.entryPrice * (1 + target.gainPct / 100);
  const orders = manual?.orders;
  const riskTitle = '模拟风险参考。持仓按止盈止损或持仓监测条件退出。';
  const campaignPath = '/journal/campaigns/' + encodeURIComponent(position.id) + '?section=instant';
  const quoteLabel = quote?.kind === 'close' ? '最近收盘价' : quoteState?.delayed ? '最近标记价格' : '标记价格';
  return <div className={positionCardClass} data-testid="instant-position">
    <PositionCardHeader asset={symbol.replace(/USDT$/, '')} contract="USDT 永续" long leverage={leverage} mode="逐仓" openedAt={buyAt}>
      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">即时交易 · 模拟</span>
      <span className="text-[10px] text-muted-foreground">{EXCHANGE_NAMES[source.exchange ?? 'binance']}</span>
    </PositionCardHeader>
    <PositionCardPnl pnl={held.pnl} roe={held.roe}/>
    <div className={positionDetailsClass}>
      <DetailCell label="持仓数量" value={formatAmount(held.remainingQuantity) + ' ' + symbol.replace(/USDT$/, '')} />
      <DetailCell label="保证金" value={formatUSDT(held.margin) + ' USDT'} />
      <DetailCell label="保证金比率（估算）" value={ratio == null ? '—' : ratio.toFixed(2) + '%'} title={riskTitle} />
      <EntryPriceCell mode={entryMode} onToggle={onToggleEntry}
        entryText={formatPrice(held.averageEntryPrice, symbol)} breakevenText={breakeven == null || breakeven <= 0 ? '—' : formatPrice(breakeven, symbol)}
        breakevenTitle="保本线按余仓成本扣除已落袋的净盈亏计算。" />
      <DetailCell label={quoteLabel} value={quote ? formatPrice(quote.price, symbol) : '—'} />
      <DetailCell label="强平价格（估算）" value={Number.isFinite(liq) && liq > 0 ? formatPrice(liq, symbol) : '—'} title={riskTitle} valueClassName="text-trading-red" />
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-2 text-[10px] text-muted-foreground">
      <span>报价时间 {quote ? formatBeijingTime(quote.at) : '—'}</span>
      <span>已实现盈亏 {formatSignedUSDT(held.realizedPnl)} USDT</span>
      {position.monitor && <span>持仓模板 {position.monitor.name}</span>}
      {manual && <span>手动接管</span>}
      {held.mirror && <span>镜像平衡减仓已成交 {(held.mirror.fraction * 100).toFixed(1)}%</span>}
      {held.additions.length > 0 && <span>加仓 {held.additions.length} 次</span>}
      {held.reductions.some(fill => fill.fraction > 0) && <span>减仓 {held.reductions.filter(fill => fill.fraction > 0).length} 次</span>}
    </div>
    {(manual || automaticTp != null) && <div className="flex flex-wrap items-center gap-3 px-3 pb-2 text-[10px] font-mono tabular-nums">
      {manual ? <>
        {orders?.tp != null && <span className="text-trading-green">止盈 {formatPrice(orders.tp, symbol)}</span>}
        {orders?.sl != null && <span className="text-trading-red">止损 {formatPrice(orders.sl, symbol)}</span>}
        {orders ? <>
          <span className="text-muted-foreground">{orders.percentage}% 仓位</span>
          <button type="button" disabled={busy || !manage} onClick={() => void act({ kind: 'cancel' })} className="text-muted-foreground hover:text-foreground">撤销止盈止损</button>
        </> : <span className="text-muted-foreground">暂无止盈止损委托</span>}
      </> : <span className="text-trading-green">镜像止盈 {formatPrice(automaticTp!, symbol)} · {target?.sellPct}%</span>}
    </div>}
    <div className={positionActionsClass}>
      {inRouter ? <Link to={campaignPath} state={{ fromInstantPosition: true }} className={linkClass}>交易战役</Link> : <a href={campaignPath} className={linkClass}>交易战役</a>}
      <ActionBtn disabled={busy || !manage} onClick={() => setModal('protect')} label="止盈/止损"/>
      <ActionBtn danger disabled={busy || !manage} onClick={() => setModal('close')} label="平仓"/>
    </div>
    {modal === 'close' && <ClosePositionModal open onClose={dismiss} symbol={symbol} position={display}
      currentPrice={mark || held.averageEntryPrice} pricePrecision={getPriceDecimals(mark || held.averageEntryPrice)}
      lotSizeCheck={isUnlimitedLimitMode(limitMode) ? undefined : fraction => cardCloseLotSize(symbol, [display], fraction, mark || held.averageEntryPrice)}
      busy={busy} notice={manual ? undefined : takeoverNotice} onConfirm={fraction => act({ kind: 'close', fraction })}/>}
    {modal === 'protect' && <TpSlModal pos={display} symbol={symbol} markPrice={mark} liqPrice={liq} onClose={dismiss}
      lotSizeCheck={isUnlimitedLimitMode(limitMode) ? undefined : (fraction, price) => cardCloseLotSize(symbol, [display], fraction, price, 'tpsl')}
      busy={busy} notice={manual ? undefined : takeoverNotice}
      onConfirm={(tp, sl, percentage) => void act({ kind: 'protect', levels: { tp, sl, percentage } })}/>}
  </div>;
}
