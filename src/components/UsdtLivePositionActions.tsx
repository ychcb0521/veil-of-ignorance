import {useRef,useState,type ReactNode} from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { useUsdtFollow } from '@/hooks/useUsdtFollow';
import { formatPrice, getPriceDecimals } from '@/lib/formatters';
import type { UsdtPositionAction, UsdtPositionControlRequest, UsdtPositionTarget, UsdtProtectionOrder } from '@/lib/fish/usdtPositionControls';
import { usdtPositionDecimal, usdtPositionQuantityUnit, type UsdtMirrorPosition } from '@/lib/fish/usdtPositionMirror';
import type { Position } from '@/types/trading';
import { ClosePositionModal } from './ClosePositionModal';
import { AdjustMarginModal } from './AdjustMarginModal';
import { LeverageModal } from './LeverageModal';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {PositionEditButton,PositionMarketClose,PositionProtectionButton} from './PositionTable';
import { TpSlModal } from './TpSlModal';

export interface LivePositionControls {
  market: ReactNode;
  margin: ReactNode;
  addProtection: ReactNode;
  editProtection: ReactNode;
  details: ReactNode;
  onLeverage?: () => void;
}

export function UsdtLivePositionActions({position,target,control,refresh,children}: {
  position: UsdtMirrorPosition;
  target?: UsdtPositionTarget;
  control: ReturnType<typeof useUsdtFollow>['controlPosition'];
  refresh: () => void;
  children: (controls:LivePositionControls)=>ReactNode;
}) {
  const [modal, setModal] = useState<'close' | 'protect' | 'leverage' | 'margin' | UsdtProtectionOrder>();
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [pending, setPending] = useState<UsdtPositionControlRequest>();
  const [selectedTarget, setSelectedTarget] = useState<UsdtPositionTarget>();
  const inFlight = useRef(false);
  const mark = Number(position.markPrice);
  const symbol = position.symbol;
  const shown: Position = {
    id: target?.campaignId ?? symbol, entryPrice: Number(position.entryPrice), quantity: Number(position.quantity),
    side: position.direction === 'long' ? 'LONG' : 'SHORT', leverage: position.leverage ?? 1,
    margin: Number(position.isolatedWallet || position.positionInitialMargin) || 0,
    settlementMode: 'usdt', marginMode: position.marginMode === 'cross' ? 'cross' : 'isolated',
  };
  const open = (next: typeof modal) => { setIssue(''); setSelectedTarget(target); setModal(next); };
  const dismiss = () => { if (!inFlight.current) setModal(undefined); };
  async function submit(action: UsdtPositionAction) {
    if (inFlight.current || (!selectedTarget && !pending)) return;
    const request = pending ?? { id: crypto.randomUUID(), target: selectedTarget!, action };
    inFlight.current = true;
    setBusy(true);
    setIssue('');
    try {
      const result = await control(request, new AbortController().signal);
      if (result.pending) {
        setPending(request);
        setIssue('等待币安回报，可按原编号核对');
        setModal(undefined);
      } else {
        setPending(undefined);
        setIssue(result.issue ?? (result.filledQuantity ? '币安已成交 ' + result.filledQuantity + ' ' + usdtPositionQuantityUnit(symbol) : '币安已确认'));
        setModal(undefined);
      }
    } catch (error) {
      if (error instanceof TypeError || error instanceof DOMException) {
        setPending(request);
        setModal(undefined);
      }
      setIssue(error instanceof Error && !(error instanceof TypeError || error instanceof DOMException) ?
        error.message : '请求回报未收到，可按原编号核对');
    } finally {
      inFlight.current = false;
      setBusy(false);
      refresh();
    }
  }
  const changedTarget = !!selectedTarget && (selectedTarget.revision !== target?.revision || selectedTarget.campaignId !== target?.campaignId);
  const actionBusy = busy || !!pending;
  const modalBusy = actionBusy || changedTarget;
  const modalIssue = changedTarget ? '这笔实盘仓位已变化，关闭后重新确认。' : issue;
  const disabled = !target || actionBusy;
  const protectionReady = !!position.protectionOrders;
  const details = <>
    {(position.protectionOrders?.length || position.protectionIssue) ? <Popover>
      <PopoverTrigger asChild><button type="button" className="text-muted-foreground hover:underline">保护委托</button></PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-wrap gap-2 text-xs">
      {position.protectionOrders?.map(order => <span key={order.id} className="inline-flex flex-wrap items-center gap-1.5 rounded border border-border px-2 py-1 text-muted-foreground">
        <span className={order.kind === 'tp' ? 'text-trading-green' : 'text-trading-red'}>{order.kind === 'tp' ? '止盈' : '止损'}</span>
        <span className="font-mono">{usdtPositionDecimal(order.triggerPrice)}</span>
        <span>{order.workingType === 'MARK_PRICE' ? '标记价' : '合约价'}触发 · {order.quantity ? usdtPositionDecimal(order.quantity) + ' ' + usdtPositionQuantityUnit(symbol) : '全部'}</span>
        <button type="button" disabled={disabled} onClick={() => open(order)} className="text-primary disabled:opacity-50"
          aria-label={'撤销' + (order.kind === 'tp' ? '止盈 ' : '止损 ') + order.triggerPrice}>撤单</button>
      </span>)}
      {position.protectionIssue && <span role="status" className="text-muted-foreground">{position.protectionIssue}</span>}
      </PopoverContent>
    </Popover> : null}
    {!target && <p role="status" className="block text-[10px] text-muted-foreground">正在核对实盘首仓成交</p>}
    {(issue || pending) && <div className="flex flex-wrap items-center gap-1 text-[10px]">
      <span role="status" className="text-muted-foreground">{issue}</span>
      {pending && <button type="button" disabled={busy} onClick={() => void submit(pending.action)} className="text-primary">核对实盘回报</button>}
    </div>}
    {modal === 'close' && <ClosePositionModal open onClose={dismiss} symbol={symbol} position={shown}
      currentPrice={mark} pricePrecision={getPriceDecimals(mark)} quantityPrecision={Math.min(12, Math.max(4, position.quantity.split('.')[1]?.length ?? 0))}
      confirmLabel="确认实盘平仓" busy={modalBusy} notice={modalIssue || '将按选定数量提交币安实盘市价平仓。余仓以币安成交回报为准。'}
      onConfirm={fraction => submit({ kind: 'close', fraction })} />}
    {modal === 'protect' && <TpSlModal pos={shown} symbol={symbol} markPrice={mark}
      liqPrice={Number(position.liquidationPrice) || Number.NaN} onClose={dismiss} busy={modalBusy}
      confirmLabel="确认提交实盘止盈止损"
      notice={modalIssue || '按币安标记价触发。填写的一侧会替换该仓位同类委托，留空的一侧保留。'}
      onConfirm={(tp, sl, pct) => void submit({ kind: 'protect', tp, sl, fraction: pct / 100 })} />}
    {modal === 'leverage' && <LeverageModal live busy={modalBusy} notice={modalIssue} symbol={symbol} currentLeverage={shown.leverage}
      onClose={dismiss} onConfirm={leverage => void submit({ kind: 'leverage', leverage })} />}
    {modal === 'margin' && <AdjustMarginModal open onClose={dismiss} symbol={symbol} position={shown}
      availableBalance={0} markPrice={mark} initialMarginUsd={0} legs={[shown]}
      live={{ busy:modalBusy, notice:modalIssue, liquidationPrice:Number(position.liquidationPrice) }}
      onConfirm={delta => void submit({ kind:'margin', delta })} />}
    {modal && typeof modal === 'object' && <Dialog open onOpenChange={value => { if (!value) dismiss(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>撤销币安实盘委托</DialogTitle>
          <DialogDescription>{symbol} {modal.kind === 'tp' ? '止盈' : '止损'} {formatPrice(Number(modal.triggerPrice), symbol)}</DialogDescription>
        </DialogHeader>
        {modalIssue && <p className="text-xs text-muted-foreground">{modalIssue}</p>}
        <DialogFooter><Button disabled={modalBusy} onClick={() => void submit({ kind: 'cancel', orderId: modal.id })}>确认撤单</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
  </>;
  return children({
    market:<PositionMarketClose disabled={disabled} mark={usdtPositionDecimal(position.markPrice)}
      quantity={usdtPositionDecimal(position.quantity)} onClick={()=>open('close')}/>,
    margin:position.marginMode==='isolated'&&<PositionEditButton label="调整保证金" disabled={disabled} onClick={()=>open('margin')}/>,
    addProtection:<PositionProtectionButton disabled={disabled||!protectionReady} onClick={()=>open('protect')}/>,
    editProtection:<PositionEditButton label="编辑仓位止盈止损" disabled={disabled||!protectionReady} onClick={()=>open('protect')}/>,
    details,
    onLeverage:disabled||!position.leverage?undefined:()=>open('leverage'),
  });
}
