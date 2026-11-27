import { useRef, useState } from 'react';
import {useQualityTemplateNames} from '@/contexts/QualityTemplateNamesContext';
import { Link, useInRouterContext } from 'react-router-dom';
import { toast } from 'sonner';
import { useInstantPositionQuote } from '@/hooks/useInstantPositionQuote';
import type { UsdtFollowStatus } from '@/lib/fish/usdtFollow';
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
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  PositionContract,PositionEditButton,PositionMarketClose,PositionNumber,PositionOpenedAt,PositionPnl,
  PositionProtectionButton,PositionProtectionPrices,PositionTableRow,
} from './PositionTable';

const linkClass = 'text-muted-foreground hover:text-foreground hover:underline';

const takeoverNotice = '确认后，这笔模拟仓位由手动操作接管。已成交的加减仓保留，原持仓监测停止下单。';

export function InstantPositionRow({ position, mirror, monitor, manual, live, manage, limitMode = 'unlimited', onOpenChart, sidebar = false }: {
  position: InstantPositionFill;
  monitor?: QualityResult;
  mirror?: QualityMirrorFill;
  manual?: InstantManualExecution;
  live?: UsdtFollowStatus;
  manage?: (position: InstantPositionFill, action: InstantManualAction) => Promise<void>;
  limitMode?: PositionLimitMode;
  onOpenChart?: () => void;
  sidebar?: boolean;
}) {
  const names=useQualityTemplateNames();
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
  const tp = orders?.tp ?? (manual ? undefined : automaticTp);
  const modify = () => setModal('protect');
  const openClose = () => setModal('close');
  const closeDisabled = busy || !manage || !(held.remainingQuantity > 0);
  const closeDialog = modal === 'close' && <ClosePositionModal open onClose={dismiss} symbol={symbol} position={display}
    currentPrice={mark || held.averageEntryPrice} pricePrecision={getPriceDecimals(mark || held.averageEntryPrice)}
    lotSizeCheck={isUnlimitedLimitMode(limitMode) ? undefined : fraction => cardCloseLotSize(symbol, [display], fraction, mark || held.averageEntryPrice)}
    busy={busy} notice={manual ? undefined : takeoverNotice} onConfirm={fraction => act({ kind: 'close', fraction })}/>;

  if (sidebar) return <div className="space-y-3 rounded border border-border p-3">
    <h2 className="text-sm font-semibold">{symbol} <span className="text-xs font-normal text-muted-foreground">多仓 · 逐仓 · {leverage}x</span></h2>
    <dl className="grid grid-cols-2 gap-y-2 text-xs">
      <dt className="text-muted-foreground">余仓数量</dt><dd className="text-right font-mono">{formatAmount(held.remainingQuantity)} {symbol.replace(/USDT$/,'')}</dd>
      <dt className="text-muted-foreground">开仓均价</dt><dd className="text-right font-mono">{formatPrice(held.averageEntryPrice,symbol)}</dd>
      <dt className="text-muted-foreground">{quoteLabel}</dt><dd className="text-right font-mono">{quote?formatPrice(mark,symbol):'—'}</dd>
      <dt className="text-muted-foreground">盈亏（回报率）</dt><dd className="text-right"><PositionPnl pnl={held.pnl} roe={held.roe}/></dd>
    </dl>
    <Button type="button" size="sm" variant="destructive" className="w-full" disabled={closeDisabled} onClick={openClose}>
      市价平仓
    </Button>
    {!manage && <p role="status" className="text-xs text-muted-foreground">仓位管理暂未就绪。</p>}
    {closeDialog}
  </div>;

  return <PositionTableRow long testId="instant-position" cells={{
    symbol: <PositionContract symbol={symbol} leverage={leverage} long onOpen={onOpenChart}
      badge={<span className="text-muted-foreground" title={EXCHANGE_NAMES[source.exchange??'binance']}>即时·模拟{monitor?.status === 'open' && monitor.pendingExit && !manual ? ' · 待平仓成交' : ''}</span>}/>,
    quantity: <PositionNumber value={formatAmount(held.remainingQuantity)+' '+symbol.replace(/USDT$/,'')} tone="text-trading-green"/>,
    entry: <PositionNumber value={formatPrice(held.averageEntryPrice,symbol)}/>,
    breakeven: <PositionNumber value={breakeven==null||breakeven<=0?'—':formatPrice(breakeven,symbol)} title="余仓成本扣除已落袋的净盈亏"/>,
    mark: <PositionNumber value={quote?formatPrice(quote.price,symbol):'—'} title={quoteLabel}/>,
    liquidation: <PositionNumber value={Number.isFinite(liq)&&liq>0?formatPrice(liq,symbol):'—'} title={riskTitle} tone="text-trading-red"/>,
    ratio: <PositionNumber value={ratio==null?'—':ratio.toFixed(2)+'%'} title={riskTitle}/>,
    margin: <div><PositionNumber value={formatUSDT(held.margin)+' USDT'}/><div className="text-muted-foreground">（逐仓）</div></div>,
    pnl: <PositionPnl pnl={held.pnl} roe={held.roe}/>,
    close: <PositionMarketClose marketOnly disabled={closeDisabled} mark={quote?formatPrice(mark,symbol):undefined}
      quantity={formatAmount(held.remainingQuantity)} onClick={openClose}/>,
    protection: <PositionProtectionPrices tp={tp==null?undefined:formatPrice(tp,symbol)} sl={orders?.sl==null?undefined:formatPrice(orders.sl,symbol)}>
      <PositionEditButton label="编辑仓位止盈止损" disabled={busy||!manage} onClick={modify}/>
    </PositionProtectionPrices>,
    addProtection: <PositionProtectionButton disabled={busy||!manage} onClick={modify}/>,
    details: <>
      <PositionOpenedAt openedAt={buyAt}/>
      <div className="flex items-center gap-3">
        {onOpenChart && <button type="button" className="text-primary hover:underline" onClick={onOpenChart}>右侧管理</button>}
        {inRouter?<Link to={campaignPath} state={{fromInstantPosition:true}} className={linkClass}>交易战役</Link>:<a href={campaignPath} className={linkClass}>交易战役</a>}
        <Popover>
          <PopoverTrigger asChild><button type="button" className={linkClass}>明细</button></PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-1 text-xs">
            <p>{EXCHANGE_NAMES[source.exchange??'binance']} · 即时交易模拟</p>
            {live&&<div data-testid="instant-usdt-follow" className="space-y-1 text-muted-foreground">
              <p>币安 U 本位 · {live.state==='tracking'?'实盘持仓':live.state==='closed'?'实盘已平':
                live.state==='ignored'?'未跟单':live.state==='waiting'?'等待成交回报':'待核对'}</p>
              {live.quantity!=null&&<p>币安余仓 {live.quantity} {live.asset}</p>}
              {live.orderId&&<p className="font-mono">订单 {live.orderId}</p>}
              {live.issue&&<p role="status">{live.issue}</p>}
            </div>}
            <p>报价时间 {quote?formatBeijingTime(quote.at):'—'}</p>
            <p>已实现盈亏 {formatSignedUSDT(held.realizedPnl)} USDT</p>
            {position.monitor&&<p>持仓模板 {names?.forMonitor(position.monitor.plan,position.monitor.templateId)?.name??position.monitor.name}</p>}
            {manual&&<p>手动接管</p>}
            {held.mirror&&<p>镜像平衡减仓已成交 {(held.mirror.fraction*100).toFixed(1)}%</p>}
            {held.additions.length>0&&<p>加仓 {held.additions.length} 次</p>}
            {held.reductions.some(fill=>fill.fraction>0)&&<p>减仓 {held.reductions.filter(fill=>fill.fraction>0).length} 次</p>}
            {orders&&<button type="button" disabled={busy||!manage} onClick={()=>void act({kind:'cancel'})}
              className="text-primary hover:underline">撤销止盈止损 · {orders.percentage}% 仓位</button>}
            {!manual&&automaticTp!=null&&<p className="text-trading-green">镜像止盈 {formatPrice(automaticTp,symbol)} · {target?.sellPct}%</p>}
          </PopoverContent>
        </Popover>
      </div>
    {closeDialog}
    {modal === 'protect' && <TpSlModal pos={display} symbol={symbol} markPrice={mark} liqPrice={liq} onClose={dismiss}
      lotSizeCheck={isUnlimitedLimitMode(limitMode) ? undefined : (fraction, price) => cardCloseLotSize(symbol, [display], fraction, price, 'tpsl')}
      busy={busy} notice={manual ? undefined : takeoverNotice}
      onConfirm={(tp, sl, percentage) => void act({ kind: 'protect', levels: { tp, sl, percentage } })}/>}
    </>,
  }}/>;
}
