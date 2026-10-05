import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTradingContext } from '@/contexts/TradingContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { getCoinMarginedContractSizeUsd, getSettlementAsset } from '@/lib/coinMargined';
import {
  detectBankedMirrorProfit,
} from '@/lib/addSizing';
import { getPriceDecimals } from '@/lib/formatters';
import { checkLotSize } from '@/lib/marketLotSize';
import { LIVE_PRICE_TIER_HEADROOM } from '@/lib/positionLimit';
import { addTierHeadroom } from '@/lib/addTierHeadroom';
import { getFreshAddSizingPlan, publishAddSizingPlan, requestAddSizingPrefill, touchAddSizingPlan } from '@/lib/addSizingPlan';
import { pickHeldSide, readHeldPosition, roundLimitPriceFavorable, sizeAddAtExpectedFill, type AddOrderKind, type AddSide } from '@/lib/addSizing';
import { addRealizedMirrorProfit, calculateAddPosition, initialAddPositionState, type AddPositionResult, type AddPositionState } from '@/lib/addPositionCoverage';
import type { AddSizingSnapshot, SettlementMode } from '@/types/trading';
import calculatorHtml from '@/assets/addSizingCalculator.html?raw';

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  currentPrice?: number;
  fillBasePrice?: number;
  pricePrecision?: number;
  quantityPrecision?: number;
}

interface CalculatorReading {
  T: number;
  K: number;
  S: number;
  Q: number;
  P: number;
  realAverage: number;
  side: AddSide;
  addQty: number;
}

interface SavedCalculatorState {
  fingerprint: string;
  state: AddPositionState;
}

type CalculatorFrame = Window & {
  AddPositionMath?: { setSeed: (seed: Record<string, number | string>) => void };
  VeilAddSizingBridge?: (reading: CalculatorReading | null) => void;
  VeilAddSizingCarry?: (reading: CalculatorReading) => void;
};

const closeEnough = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-10, Math.abs(a), Math.abs(b)) * 1e-8;

/** The standalone calculator's exact markup, styles and interactions are embedded unchanged in the dialog. */
export function AddPositionCalculator({ open, onClose, symbol, currentPrice = 0, fillBasePrice = 0, pricePrecision, quantityPrecision }: Props) {
  const ctx = useTradingContext();
  const positions = ctx.positionsMap[symbol];
  const face = getCoinMarginedContractSizeUsd(symbol);
  const seedPx = fillBasePrice > 0 ? fillBasePrice : currentPrice;
  const [saved, setSaved] = usePersistedState<Record<string, SavedCalculatorState>>('add_position_ledger_v1', {});
  const frameRef = useRef<HTMLIFrameElement>(null);
  const latestRef = useRef({ saved, positions, face, ctx, symbol });
  latestRef.current = { saved, positions, face, ctx, symbol };
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState<{ raw: CalculatorReading; result: AddPositionResult } | null>(null);
  const [orderKind, setOrderKind] = useState<AddOrderKind>('limit');
  const [frameError, setFrameError] = useState(false);

  const fingerprintFor = useCallback((side: AddSide) => {
    const held = readHeldPosition(symbol, positions, side, face);
    return held ? `${held.earliestOpenedRealAt ?? 'unknown'}:${held.earliestOpenTime ?? 'unknown'}` : 'manual';
  }, [symbol, positions, face]);

  const calculateReading = useCallback((raw: CalculatorReading | null) => {
    if (!raw || ![raw.T, raw.K, raw.S, raw.Q, raw.P, raw.realAverage, raw.addQty].every(Number.isFinite)) return null;
    const current = latestRef.current;
    const prior = current.saved[`${current.symbol}:${raw.side}`];
    const allocated = prior?.fingerprint === fingerprintFor(raw.side) ? prior.state.mirrorProfitAllocated : 0;
    const state = {
      ...initialAddPositionState(raw.S, raw.Q, allocated + raw.P, raw.realAverage),
      mirrorProfitAllocated: allocated,
      mirrorProfitAvailable: raw.P,
    };
    const result = calculateAddPosition({ currentPrice: raw.T, support: raw.K, state, side: raw.side });
    if (result.error || !closeEnough(result.addCoins, raw.addQty)) return null;
    return { raw, result };
  }, [fingerprintFor]);

  const onFrameLoad = useCallback(() => {
    const child = frameRef.current?.contentWindow as CalculatorFrame | null;
    if (!child?.AddPositionMath) {
      setFrameError(true);
      return;
    }
    const current = latestRef.current;
    const held = pickHeldSide(current.symbol, current.positions[current.symbol], current.face);
    const side = held?.side ?? 'LONG';
    const fingerprint = fingerprintFor(side);
    const prior = current.saved[`${current.symbol}:${side}`];
    const banked = held ? detectBankedMirrorProfit(current.symbol, side, current.ctx.tradeHistory,
      held.earliestOpenTime ?? null, current.positions[current.symbol], { earliestOpenedRealAt: held.earliestOpenedRealAt ?? null }) : null;
    const initialProfit = Math.max(0, banked?.usd ?? 0);
    const carried = prior?.fingerprint === fingerprint ? prior.state : null;
    const state = carried
      ? initialProfit > carried.mirrorProfitRealized
        ? addRealizedMirrorProfit(carried, initialProfit - carried.mirrorProfitRealized)
        : { ...carried, mirrorProfitRealized: Math.max(carried.mirrorProfitAllocated, initialProfit),
          mirrorProfitAvailable: Math.max(0, initialProfit - carried.mirrorProfitAllocated) }
      : initialAddPositionState(held?.avgEntry ?? 0, held?.coins ?? 0, initialProfit);
    const candidate = getFreshAddSizingPlan(current.symbol);
    const existing = candidate?.side === side ? candidate : null;
    child.VeilAddSizingBridge = raw => setReading(calculateReading(raw));
    child.VeilAddSizingCarry = raw => {
      const outcome = calculateReading(raw);
      if (!outcome?.result.next) return;
      const key = `${current.symbol}:${raw.side}`;
      setSaved(previous => ({ ...previous, [key]: { fingerprint: fingerprintFor(raw.side), state: outcome.result.next! } }));
      setReading(null);
    };
    child.AddPositionMath.setSeed({
      currentPrice: existing?.s2Ref ?? (fillBasePrice > 0 ? fillBasePrice : currentPrice),
      support: existing?.s1 ?? 0,
      strategyCost: state.strategyCost,
      realAverage: state.realAverage,
      coins: state.coins,
      mirrorProfitRealized: state.mirrorProfitRealized,
      mirrorProfitAllocated: state.mirrorProfitAllocated,
      mirrorProfitAvailable: state.mirrorProfitAvailable,
      side,
      leverage: 10,
    });
    if (existing) setOrderKind(existing.orderKind);
    setReady(true);
  }, [calculateReading, currentPrice, fillBasePrice, fingerprintFor, setSaved]);

  const execution = useMemo(() => {
    if (!reading || !open) return null;
    const { raw, result } = reading;
    const held = readHeldPosition(symbol, positions, raw.side, face);
    // Simulated subsequent rounds remain viewable; an order plan needs the actual held coins and cost.
    if (!held || !closeEnough(held.coins, raw.Q) || !closeEnough(held.avgEntry, raw.realAverage)) return null;
    // A typed strategy line must not manufacture a new risk cushion for a live order.
    const allocated = saved[`${symbol}:${raw.side}`];
    const budgetFromLine = (raw.realAverage - raw.S) * (raw.side === 'SHORT' ? -1 : 1) * raw.Q;
    const knownAllocated = allocated?.fingerprint === fingerprintFor(raw.side) ? allocated.state.mirrorProfitAllocated : 0;
    if (budgetFromLine < -1e-8 || !closeEnough(budgetFromLine, knownAllocated)) return null;
    const settlement: SettlementMode = (positions ?? []).find(p => p?.side === raw.side)?.settlementMode ?? ctx.getSymbolSettlementMode(symbol);
    const isCoin = settlement === 'coin';
    const decimals = pricePrecision != null && Number.isFinite(pricePrecision) ? pricePrecision : getPriceDecimals(raw.T);
    const refPrice = orderKind === 'market' ? seedPx : roundLimitPriceFavorable(raw.T, decimals, raw.side);
    if (!(refPrice > 0)) return null;
    const availableU = result.oldCushion + raw.P;
    const guarded = sizeAddAtExpectedFill({
      side: raw.side, settlement, coverage: isCoin ? availableU / raw.K : availableU,
      s1: raw.K, s2Ref: refPrice, orderKind, contractFaceUsd: isCoin ? face : null,
    });
    if (!guarded || !(guarded.addCoinsMax > 0)) return null;
    const tier = addTierHeadroom({
      symbol, settlement, side: raw.side,
      storedLeverage: ctx.leverageMap?.[symbol], positions, orders: ctx.ordersMap?.[symbol],
      markPrice: seedPx, orderKind, orderPrice: refPrice, fillPrice: guarded.s2Fill,
      contractFaceUsd: isCoin ? face : null,
      mode: ctx.positionLimitMode,
    });
    const addCoins = Math.min(result.addCoins, guarded.addCoinsMax, tier?.coins ?? Infinity);
    const uncappedContracts = isCoin ? Math.floor(addCoins * guarded.s2Fill / face + 1e-9) : null;
    const lot = checkLotSize({
      symbol, settlement, kind: orderKind === 'limit' ? 'limit' : 'market',
      units: uncappedContracts ?? addCoins, price: refPrice, mode: ctx.positionLimitMode,
    });
    const lotCap = lot.maxUnits == null ? Infinity
      : orderKind === 'market' && lot.resolved?.source === 'usdm-proxy'
        ? Math.floor(lot.maxUnits * (1 - LIVE_PRICE_TIER_HEADROOM)) : lot.maxUnits;
    const contracts = uncappedContracts == null ? null : Math.min(uncappedContracts, Math.floor(lotCap));
    const scale = 10 ** Math.max(0, Math.min(12, Math.floor(quantityPrecision ?? 2)));
    const placeableCoins = isCoin ? (contracts! * face / guarded.s2Fill)
      : Math.floor(Math.min(addCoins, lotCap) * scale + 1e-7) / scale;
    if (!(placeableCoins > 0) || (isCoin && !(contracts! > 0))) return null;
    // Existing journal and fill checks use actual average plus banked U; the strategy cost
    // is the same budget expressed against the real average, without repledging old P.
    const virtualBankedU = budgetFromLine + raw.P;
    const snapshot: Omit<AddSizingSnapshot, 'at'> = {
      plan: Math.abs(virtualBankedU) > 1e-12 ? 'B' : 'A', side: raw.side, settlement,
      s1: raw.K, s2Ref: refPrice, s2Fill: guarded.s2Fill, slippagePct: guarded.slippagePct,
      x1: raw.Q, sBar: raw.realAverage,
      g: isCoin ? virtualBankedU / raw.K : virtualBankedU,
      gUnit: isCoin ? getSettlementAsset(symbol) : 'USD',
      addCoinsMax: placeableCoins, contracts, orderKind,
    };
    return { snapshot, coins: placeableCoins, contracts, refPrice, settlement };
  }, [reading, open, symbol, positions, face, ctx, pricePrecision, quantityPrecision, orderKind, seedPx, saved, fingerprintFor]);

  useEffect(() => {
    if (!open) {
      setReady(false);
      setReading(null);
      setFrameError(false);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !ready) return;
    publishAddSizingPlan(symbol, execution?.snapshot ?? null);
  }, [open, ready, symbol, execution]);
  useEffect(() => {
    if (!open) return;
    return () => touchAddSizingPlan(symbol);
  }, [open, symbol]);

  const placeAtLimit = () => {
    if (!execution) return;
    const { snapshot, coins, contracts, refPrice, settlement } = execution;
    requestAddSizingPrefill(symbol, snapshot, {
      contracts, coins, orderType: orderKind === 'market' ? 'MARKET' : orderKind === 'limit' ? 'LIMIT' : 'CONDITIONAL',
      limitPrice: orderKind === 'limit' ? refPrice : null,
      triggerPrice: orderKind === 'conditional' ? refPrice : null,
      side: snapshot.side, settlement,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1240px] [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">加仓计算器</DialogTitle>
        {open && <iframe key={symbol} ref={frameRef} title={`${symbol} 加仓计算器`} srcDoc={calculatorHtml}
          onLoad={onFrameLoad} className="min-h-0 w-full flex-1 border-0" data-testid="add-position-calculator-frame" />}
        {frameError && <div className="px-4 py-2 text-sm text-destructive">加仓计算器未能加载，请关闭后重试。</div>}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-[#f4f6fa] px-4 py-2 text-xs text-[#182536]">
          <span className="mr-auto text-[#6c7889]">{reading && !execution
            ? '可继续模拟；仅实际持仓、已承接利润与交易规则一致时才能带入下单。'
            : '理论结果按输入价格计算；下单量按实际委托价和交易规则向下收敛。'}</span>
          <select aria-label="下单方式" value={orderKind} onChange={event => setOrderKind(event.target.value as AddOrderKind)}
            className="rounded-lg border border-[#dce3eb] bg-white px-2 py-1.5">
            <option value="market">市价（含滑点）</option>
            <option value="limit">限价 @T</option>
            <option value="conditional">条件单 @T</option>
          </select>
          <button type="button" disabled={!execution} onClick={placeAtLimit}
            className="rounded-lg bg-[#087c6b] px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
            按上限下单{execution ? ` · ${execution.contracts != null ? `${execution.contracts} 张` : `${execution.coins.toLocaleString('en-US', { maximumFractionDigits: 8 })} 币`}` : ''}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#dce3eb] bg-white px-3 py-1.5">关闭</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
