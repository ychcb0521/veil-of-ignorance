import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTradingContext } from '@/contexts/TradingContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { getCoinMarginedContractSizeUsd, getSettlementAsset } from '@/lib/coinMargined';
import { addSizingProfitRecords, verifiedAddSizingProfit } from '@/lib/addSizingVerifiedProfit';
import { getPriceDecimals } from '@/lib/formatters';
import { checkLotSize } from '@/lib/marketLotSize';
import { LIVE_PRICE_TIER_HEADROOM } from '@/lib/positionLimit';
import { addTierHeadroom } from '@/lib/addTierHeadroom';
import { ADD_SIZING_PLAN_TTL_MS, getFreshAddSizingPlan, publishAddSizingPlan, requestAddSizingPrefill, touchAddSizingPlan } from '@/lib/addSizingPlan';
import { pickHeldSide, readHeldPosition, roundLimitPriceFavorable, sizeAddAtExpectedFill, type AddOrderKind, type AddSide } from '@/lib/addSizing';
import { calculateAddPosition, initialAddPositionState, type AddPositionResult, type AddPositionState } from '@/lib/addPositionCoverage';
import { exactPriceDecimals, latestHedgeOrder } from '@/lib/latestHedgeOrder';
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
  /** 镜像止盈输入框里的原值与空单盈亏 H（带号）；P 是二者净额折进安全垫后剩下的可用利润 */
  mirrorInput?: number;
  H?: number;
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

/** 镜像止盈 + 空单盈亏的带号净额；老页面没报 H 时就是 P。 */
const netProfit = (raw: CalculatorReading) => Number.isFinite(raw.H) && Number.isFinite(raw.mirrorInput)
  ? raw.mirrorInput! + raw.H! : raw.P;

const closeEnough = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-10, Math.abs(a), Math.abs(b)) * 1e-8;

/**
 * 「新支撑线 / 止损线」K 的缺省值从哪来的留痕（按「标的:方向」记，只活在本次页面里，与计算计划同样 30 分钟保鲜）。
 *
 * 【用户要求】K 缺省取最新委托空单的价格，并且可以手动输入。两件事要分清：
 *   · manual：用户**手改**过的 K。关掉再打开、或弹窗开着时宿主重新取数，都不能把它盖回委托价；
 *     之后又挂了更新的对冲委托，才以新委托为准。
 *   · auto：上一次**自动带入**的委托价。那张委托后来撤了 / 成交了，它的价就不该再借着计算计划留在 K 里。
 * 只看计算计划分不出这两种：K 一带入就算出结果、计划随即发布，关弹窗还会给计划续期。
 */
const supportMemory = new Map<string, { manual?: { k: number; at: number }; auto?: number }>();

export function __resetAddCalculatorSupportMemoryForTests(): void {
  supportMemory.clear();
}

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
  const [selectedSide, setSelectedSide] = useState<AddSide | null>(null);
  const [verifiedProfit, setVerifiedProfit] = useState<{ key: string; usd: number; mainUsd: number; complete: boolean } | null>(null);
  /** 最近一次种进 K 输入框的值：计算器报回来的 K 与它不同，就是用户手改过。 */
  const seededSupportRef = useRef<{ side: AddSide; value: number } | null>(null);
  const profitGeneration = useRef(0);
  const profitSide = selectedSide ?? pickHeldSide(symbol, positions, face)?.side ?? 'LONG';
  const heldSide = readHeldPosition(symbol, positions, profitSide, face);
  const profitRecords = useMemo(() => addSizingProfitRecords(symbol, heldSide?.side ?? 'LONG', ctx.tradeHistory,
    heldSide?.earliestOpenTime ?? null, heldSide?.earliestOpenedRealAt ?? null),
  [symbol, heldSide?.side, heldSide?.earliestOpenTime, heldSide?.earliestOpenedRealAt, ctx.tradeHistory]);
  const profitKey = `${symbol}:${profitSide}:${heldSide?.earliestOpenedRealAt}:${heldSide?.earliestOpenTime}:`
    + profitRecords.map(record => `${record.id}:${record.fillId}:${record.settlementMode}:${record.pnl}:${record.entryPrice}:${record.exitPrice}:${record.closeTime}:${record.quantity}:${record.contracts}:${record.contractSizeUsd}`).join('|');

  const fingerprintFor = useCallback((side: AddSide) => {
    const held = readHeldPosition(symbol, positions, side, face);
    return held ? `${held.earliestOpenedRealAt ?? 'unknown'}:${held.earliestOpenTime ?? 'unknown'}` : 'manual';
  }, [symbol, positions, face]);

  const calculateReading = useCallback((raw: CalculatorReading | null) => {
    if (!raw || ![raw.T, raw.K, raw.S, raw.Q, raw.P, raw.realAverage, raw.addQty].every(Number.isFinite)) return null;
    const current = latestRef.current;
    const prior = current.saved[`${current.symbol}:${raw.side}`];
    const allocated = prior?.fingerprint === fingerprintFor(raw.side) ? prior.state.mirrorProfitAllocated : 0;
    // 空单亏损超过镜像利润的那一截从原仓安全垫里扣：等价于把策略成本线往不利方向挪 −净额 ÷ Q₁
    const net = netProfit(raw);
    const strategyCost = raw.S - (raw.side === 'SHORT' ? -1 : 1) * Math.min(0, net) / raw.Q;
    const state = {
      ...initialAddPositionState(strategyCost, raw.Q, allocated + Math.max(0, net), raw.realAverage),
      mirrorProfitAllocated: allocated,
      mirrorProfitAvailable: Math.max(0, net),
    };
    const result = calculateAddPosition({ currentPrice: raw.T, support: raw.K, state, side: raw.side });
    if (result.error || !closeEnough(result.addCoins, raw.addQty)) return null;
    return { raw, result };
  }, [fingerprintFor]);

  const onFrameLoad = useCallback(async () => {
    const child = frameRef.current?.contentWindow as CalculatorFrame | null;
    if (!child?.AddPositionMath) {
      setFrameError(true);
      return;
    }
    const current = latestRef.current;
    // latestRef 里的 positions 已经是这个标的自己的那一组（ctx.positionsMap[symbol]），不能再按标的取一次：
    // 那样读到的永远是 undefined——持仓的均价与币数填不进去，真实均价还被种成 0，之后怎么填都报「须为有效数字」。
    const side = profitSide;
    const held = readHeldPosition(current.symbol, current.positions, side, current.face);
    const fingerprint = fingerprintFor(side);
    const prior = current.saved[`${current.symbol}:${side}`];
    const generation = ++profitGeneration.current;
    setReady(false);
    setVerifiedProfit(null);
    const verified = profitRecords.length ? await verifiedAddSizingProfit(current.symbol, side, profitRecords)
      .catch(() => ({ complete: false, usd: 0, mainUsd: 0, hedgeUsd: 0 })) : { complete: true, usd: 0, mainUsd: 0, hedgeUsd: 0 };
    if (generation !== profitGeneration.current) return;
    setVerifiedProfit({ key: profitKey, ...verified });
    if (!verified.complete) return;
    // 镜像止盈一栏只放主方向的落袋净额；空单盈亏单列一栏（带号），计算器里再合并
    const initialProfit = Math.max(0, verified.mainUsd);
    const carried = prior?.fingerprint === fingerprint ? prior.state : null;
    // Rebase carried simulations on the actual position and verified net profit.
    // A realized loss also consumes the old cushion; clipping G to zero would enlarge it.
    const allocated = Math.min(carried?.mirrorProfitAllocated ?? 0, initialProfit);
    const lineCredit = Math.min(allocated, verified.mainUsd);
    const actualAverage = held?.avgEntry ?? 0;
    const actualCoins = held?.coins ?? 0;
    const strategyCost = actualCoins > 0 ? actualAverage - lineCredit * (side === 'SHORT' ? -1 : 1) / actualCoins : actualAverage;
    const state = { ...initialAddPositionState(strategyCost, actualCoins, initialProfit, actualAverage),
      mirrorProfitAllocated: allocated, mirrorProfitAvailable: Math.max(0, verified.mainUsd - lineCredit) };
    const candidate = getFreshAddSizingPlan(current.symbol);
    const existing = candidate?.side === side ? candidate : null;
    child.VeilAddSizingBridge = raw => {
      if (raw) setSelectedSide(raw.side);
      // 输入框里的 K 与种进去的不一样 = 用户手改过：记下来；改回缺省值就取消
      const seeded = seededSupportRef.current;
      if (raw && seeded?.side === raw.side && Number.isFinite(raw.K) && raw.K > 0) {
        const key = `${current.symbol}:${raw.side}`;
        const entry = supportMemory.get(key) ?? {};
        if (!closeEnough(raw.K, seeded.value)) supportMemory.set(key, { ...entry, manual: { k: raw.K, at: Date.now() } });
        else if (entry.manual && !closeEnough(entry.manual.k, raw.K)) supportMemory.set(key, { ...entry, manual: undefined });
      }
      setReading(calculateReading(raw));
    };
    child.VeilAddSizingCarry = raw => {
      const outcome = calculateReading(raw);
      if (!outcome?.result.next) return;
      const key = `${current.symbol}:${raw.side}`;
      setSaved(previous => ({ ...previous, [key]: { fingerprint: fingerprintFor(raw.side), state: outcome.result.next! } }));
      setReading(null);
    };
    const seedPrice = existing?.s2Ref ?? (fillBasePrice > 0 ? fillBasePrice : currentPrice);
    // 【用户要求】价格缺省的小数位数与主界面「仓位」里开仓价的位数一致（PositionPanel 用 formatPrice → getPriceDecimals）；
    // 没有持仓时按现价的位数。只是缺省值的写法，输入框本身不限制小数位。
    const priceDecimals = getPriceDecimals(held?.avgEntry && held.avgEntry > 0 ? held.avgEntry : seedPrice);
    // 【用户要求】「新支撑线 / 止损线」缺省取最新委托空单的价格（主空则是最新委托多单），并且可以手动输入：
    // 只是填进输入框的缺省值，之后怎么改都由用户定。先后次序（见 supportMemory）：
    //   手改过的 K（30 分钟内、且之后没有再挂更新的对冲委托）→ 最新挂着的对冲委托价 → 上一次计算计划里的 K → 留空。
    const hedge = latestHedgeOrder(current.ctx.ordersMap?.[current.symbol], side, {
      referencePrice: seedPrice, heldSinceMs: held?.earliestOpenTime ?? null,
    });
    const memoryKey = `${current.symbol}:${side}`;
    const memory = supportMemory.get(memoryKey) ?? {};
    const typed = memory.manual && Date.now() - memory.manual.at <= ADD_SIZING_PLAN_TTL_MS
      // 手改之后又挂了更新的对冲委托：新委托才是这一轮的止损线
      && (hedge?.placedRealAt == null || memory.manual.at >= hedge.placedRealAt) ? memory.manual.k : null;
    const hedgeOrderPrice = typed == null && hedge ? hedge.price : null;
    // 没有挂着的对冲委托时沿用上一次计算计划里的 K——除非它正是上次自动带入的委托价（那张委托已经不在了）
    const planSupport = existing && existing.s1 > 0 && !(memory.auto != null && closeEnough(existing.s1, memory.auto)) ? existing.s1 : null;
    const support = typed ?? hedgeOrderPrice ?? planSupport ?? 0;
    supportMemory.set(memoryKey, { manual: typed != null ? memory.manual : undefined, auto: hedgeOrderPrice ?? memory.auto });
    seededSupportRef.current = { side, value: support };
    child.AddPositionMath.setSeed({
      currentPrice: seedPrice,
      priceDecimals,
      support,
      // 委托价（或上次手填的 K）原样写：位数不够时按它自己的位数，不四舍五入掉
      supportDecimals: support > 0 ? Math.max(priceDecimals, exactPriceDecimals(support)) : priceDecimals,
      supportSource: hedgeOrderPrice != null
        ? `缺省取最新挂着的${side === 'SHORT' ? '多单' : '空单'}价格，可直接改写`
        : typed != null ? '沿用你上次手填的价格' : '',
      strategyCost: state.strategyCost,
      realAverage: state.realAverage,
      coins: state.coins,
      mirrorProfitRealized: state.mirrorProfitRealized,
      mirrorProfitAllocated: state.mirrorProfitAllocated,
      mirrorProfitAvailable: state.mirrorProfitAvailable,
      hedgeProfit: verified.hedgeUsd,
      side,
      leverage: 10,
    });
    if (existing) setOrderKind(existing.orderKind);
    setReady(true);
  }, [calculateReading, currentPrice, fillBasePrice, fingerprintFor, setSaved, profitKey, profitRecords, profitSide]);

  const reloadProfit = useRef(onFrameLoad);
  reloadProfit.current = onFrameLoad;
  useEffect(() => {
    profitGeneration.current += 1;
    if (open && (frameRef.current?.contentWindow as CalculatorFrame | null)?.AddPositionMath) void reloadProfit.current();
  }, [open, profitKey]);

  const execution = useMemo(() => {
    if (!reading || !open || reading.raw.side !== profitSide) return null;
    const { raw, result } = reading;
    const held = readHeldPosition(symbol, positions, raw.side, face);
    // Simulated subsequent rounds remain viewable; an order plan needs the actual held coins and cost.
    if (!held || !closeEnough(held.coins, raw.Q) || !closeEnough(held.avgEntry, raw.realAverage)) return null;
    if (!verifiedProfit?.complete || verifiedProfit.key !== profitKey) return null;
    // A typed strategy line must not manufacture a new risk cushion for a live order.
    const allocated = saved[`${symbol}:${raw.side}`];
    const savedAllocated = allocated?.fingerprint === fingerprintFor(raw.side) ? allocated.state.mirrorProfitAllocated : 0;
    const knownAllocated = Math.min(savedAllocated, verifiedProfit.mainUsd);
    const lineBudget = (raw.realAverage - raw.S) * (raw.side === 'SHORT' ? -1 : 1) * raw.Q;
    // 策略成本线在输入框里按开仓价的显示位数写（2.8489），真实均价是完整精度（2.84893…）：
    // 差出半个显示刻度以内的，是同一条线的两种写法，不是手填出来的新风险垫。
    const lineTolerance = raw.Q * 0.5 * 10 ** -getPriceDecimals(raw.realAverage);
    const budgetFromLine = Math.abs(lineBudget - knownAllocated) <= lineTolerance ? knownAllocated : lineBudget;
    if (!closeEnough(budgetFromLine, knownAllocated)) return null;
    const net = netProfit(raw);
    const requestedBanked = budgetFromLine + net;
    if (requestedBanked > verifiedProfit.usd + Math.max(1e-8, Math.abs(verifiedProfit.usd) * 1e-8)) return null;
    const settlement: SettlementMode = (positions ?? []).find(p => p?.side === raw.side)?.settlementMode ?? ctx.getSymbolSettlementMode(symbol);
    const isCoin = settlement === 'coin';
    const decimals = pricePrecision != null && Number.isFinite(pricePrecision) ? pricePrecision : getPriceDecimals(raw.T);
    const refPrice = orderKind === 'market' ? seedPx : roundLimitPriceFavorable(raw.T, decimals, raw.side);
    if (!(refPrice > 0)) return null;
    const availableU = Math.min(result.oldCushion + raw.P,
      raw.Q * (raw.K - held.avgEntry) * (raw.side === 'SHORT' ? -1 : 1) + verifiedProfit.usd);
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
    const virtualBankedU = budgetFromLine + net;
    const snapshot: Omit<AddSizingSnapshot, 'at'> = {
      profitBasis: 'verified_net',
      plan: Math.abs(virtualBankedU) > 1e-12 ? 'B' : 'A', side: raw.side, settlement,
      s1: raw.K, s2Ref: refPrice, s2Fill: guarded.s2Fill, slippagePct: guarded.slippagePct,
      x1: raw.Q, sBar: raw.realAverage,
      g: isCoin ? virtualBankedU / raw.K : virtualBankedU,
      gUnit: isCoin ? getSettlementAsset(symbol) : 'USD',
      addCoinsMax: placeableCoins, contracts, orderKind,
    };
    return { snapshot, coins: placeableCoins, contracts, refPrice, settlement };
  }, [reading, open, symbol, positions, face, ctx, pricePrecision, quantityPrecision, orderKind, seedPx, saved, fingerprintFor, verifiedProfit, profitKey, profitSide]);

  useEffect(() => {
    if (!open) {
      profitGeneration.current += 1;
      setReady(false);
      setReading(null);
      setFrameError(false);
      setSelectedSide(null);
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
            ? '可继续模拟；带入下单的利润不能超过本轮已核验的落袋净收益。'
            : verifiedProfit?.complete ? '理论结果按输入价格计算；下单量按实际委托价和交易规则向下收敛。'
              : verifiedProfit ? '落袋收益核验暂未完成，请重试。' : '正在核对本轮落袋收益…'}</span>
          {verifiedProfit && !verifiedProfit.complete && <button type="button" onClick={() => void onFrameLoad()}>重新核验</button>}
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
