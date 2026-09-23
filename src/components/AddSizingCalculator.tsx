import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTradingContext } from '@/contexts/TradingContext';
import type { AddSizingSnapshot, Position, SettlementMode, TradeRecord } from '@/types/trading';
import { getFreshAddSizingPlan, publishAddSizingPlan, requestAddSizingPrefill, touchAddSizingPlan } from '@/lib/addSizingPlan';
import { getPriceDecimals } from '@/lib/formatters';
import { getCoinMarginedContractSizeUsd, getSettlementAsset } from '@/lib/coinMargined';
import { addTierHeadroom } from '@/lib/addTierHeadroom';
import { formatTierAmount } from '@/lib/leverageTiers';
import { lotSizeCapLabel, checkLotSize } from '@/lib/marketLotSize';
import { LIVE_PRICE_TIER_HEADROOM } from '@/lib/positionLimit';
import {
  PRE_MAIN_LOOKBACK_MS,
  evaluateS1Deviation,
  pickBookLine,
  readHedgeLines,
  sameLine,
} from '@/lib/hedgeLines';
import {
  coinsToContracts,
  coinsToContractsFloor,
  computeBankedAdd,
  computeCushionAdd,
  computePlanBCoverageAtS1,
  detectBankedMirrorProfit,
  expectedFillPrice,
  isTakerOrderKind,
  pickHeldSide,
  readHeldPosition,
  roundLimitPriceFavorable,
  sizeAddAtExpectedFill,
  type AddOrderKind,
  type AddSide,
  type BankedKnob,
  type CushionAddResult,
  type HeldPositionSummary,
  crossCheckPostAddR0,
} from '@/lib/addSizing';

/**
 * 加仓计算器 —— 使用说明 3.4 的公式做成可以按的东西。
 *
 * 界面只放数字：X₂ 与对冲量是主角，中间量降成一行芯片，价格阶梯把 S̄ / S₁ / S₂ 的几何画出来。
 * 阶梯**不看有没有解**：三个价格齐了就画，方向反了的那一段标红——「S₁ 还在成本线亏损侧」
 * 因此一眼可见，不必读文字。解释性文字一律留在使用说明 3.4，右上角近乎隐形的「?」给公式速览。
 *
 * 口径与 Legs「加仓校验」严格同一条：加仓上限 = max(0, Y₁ + G) ÷ 每币风险，G 是带符号的本轮落袋净额。
 * G = 0 时 Plan B 与 Plan A 同值，界面照旧以 Plan A 为主角；G ≠ 0（正负都算）时 Plan A 降为来源拆解。
 *
 * **所有派生量按预计成交价 S₂′ 算，不按 S₂。** COMMONUSDT 那一场用户严格按上限下单仍被 Legs 判超限 1.57% / 3.70%：
 * 计算器读的 S₂ 是下单前的盘面价，市价单在引擎里按 0.01% + 名义/50亿 滑点成交（0.14% / 0.29%），
 * Legs 校验读的是成交价，而上限对 S₂ 的弹性是 S₁/(S₂ − S₁) ≈ 十几倍。
 * 所以：S₂ 从引擎成交的基准价种下并跟着它走；市价档按基准价解出 S₂′（sizeAddAtExpectedFill，二分，永远收敛），
 * X₂ 上限、张数、对冲量、R0 复核全部吃同一个上限、同一个 S₂′；限价档 S₂′ = 挂单价。
 *
 * **市价单只能在引擎基准价上成交。** 市价档的 S₂ 因此永远跟着基准价、不上锁；手填一个离基准价超过一格的 S₂，
 * 那只能是一张限价单或条件单——自动切到「限价 @S₂」并写一行说明（一键改成条件单），复位图标回到市价。
 * 否则计算器会按手填的价给出一张市价计划，「按上限下单」预填的市价单却在基准价上成交，上限差出几倍。
 *
 * **条件单 @S₂** 是第三档：S₂ 是触发价，触发后引擎在触发价上按同一个 Taker 滑点成交——突破加仓就是它。
 * 按限价档定的量挂成条件单，COMMONUSDT 的超限原样重演（0.14% 滑点 → 1.57% 超限），所以它必须单列、按触发价上的滑点定量，
 * 「按上限下单」预填的也是一张以 S₂ 为触发价的条件委托。
 *
 * 重新打开时从仍在保鲜期的计划种回 S₁ / 下单方式（限价 / 条件单计划连同锁住的价）：
 * 下单面板里已经预填好的那张单还指望着这份计划，打开看一眼不能把它清掉。
 * 但计划只记得它算出来那一刻：X₁ / S̄ 按计划那一侧的持仓重读，G 按本场落袋重读（变了就换成新的并说明），
 * 计划早于当前持仓的开仓（上一场回放、平掉又重开）就整个不认。
 *
 * **可下单量还要过币安分层**（addTierHeadroom）：按这个合约当前的杠杆，这一侧还能再开多少（持仓多空相加 + 当前委托），
 * 而且计划自己的对冲（S₁ 上的合计对冲 X₁ + X₂）也要放得下——它与加仓共用同一个上限。
 * 大字、张数、合计对冲、「按上限下单」都取 min(Plan B 上限, 分层余量)，一行字说清卡住的是哪一个、给对冲留了多少；
 * 计划快照记的仍是 Plan B 上限——成交后复判与 Legs 校验只判 Plan B。
 *
 * **算出来的计划会发布出去（addSizingPlan）**：之后同标的同方向的开仓单会把它钉在单子上，
 * 成交、平仓一路带到成交记录，Legs「加仓校验」据此说清计算时与成交时各是多少。
 * 「按上限下单」把整张的上限直接预填进下单面板，省掉手抄——那一场就是手抄币数、面板再按另一个价折张。
 */

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  /**
   * 实时现价（Index 的 displayCurrentPrice）。不能读 ctx.priceMap ——
   * 那是 usePersistedState('price_map') 的持久化行情缓存，会留着上一段回放的陈旧价，
   * 于是 S₂ 被预填成完全不相干的数（实测 0.6273 vs 真实 0.012804）。
   * 没有 fillBasePrice 时用它种 S₂。
   */
  currentPrice?: number;
  /**
   * 引擎市价成交的**基准价**：Index 的 latestChartPriceRef.current || priceMap[symbol] || currentPrice——
   * 与下单按钮传给 placeOrder 的 latestPrice 同一个式子。displayCurrentPrice 是经过平滑 / 节流的显示值，
   * 与引擎拿去撮合的原始收盘价不是同一个变量。S₂ 从这里种下，弹窗打开期间跟着它走，
   * 直到用户手动改过 S₂（复位图标重新种下并恢复跟随）。
   */
  fillBasePrice?: number;
  /**
   * 下单面板的价格精度（Index 的 chartPricePrecision，与传给 OrderPanel 的同一个数）。
   * 限价档的挂单价按它向有利侧取整后再定量——面板只能挂这个精度的价，按没取整的 S₂ 定量，
   * 挂出去的价一旦被四舍五入抬高，上限就立刻超了。没给就按 S₂ 的量级推（getPriceDecimals，与 context 同一规则）。
   */
  pricePrecision?: number;
  /**
   * 下单面板的数量精度（Index 的 quantityPrecision）：U 本位「按上限下单」的按钮上写的币数按它向下取整——
   * 面板预填时就是这么取的，按钮上的数与落进面板的数必须是同一个，而且不能比上限多。
   */
  quantityPrecision?: number;
}

const fmtCoins = (v: number, dp = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: dp }) : '—');
const fmtUsd = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const fmtPx = (v: number) => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(6));
const fmtPct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
const toNum = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : Number.NaN; };
const tidyPx = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(8))) : '');
const tidyCoins = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(4))) : '');
/** 带符号：正数前面加「+」，负数用「−」，零不带符号。 */
const signed = (v: number, fmt: (abs: number) => string) =>
  (!Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`);
/** 滑点百分比：两位小数、恒带符号（+0.14% / −0.14%），零写 +0.00%。 */
const fmtSlipPct = (v: number) => (!Number.isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}%`);
/** 币数向下取整到 dp 位再显示：授权额度不能被显示时的四舍五入抬高。 */
const fmtCoinsFloor = (v: number, dp: number) => {
  if (!Number.isFinite(v)) return '—';
  const p = Math.max(0, Math.min(12, Math.floor(dp)));
  const scale = 10 ** p;
  const floored = Math.floor(v * scale + 1e-7) / scale;
  return floored.toLocaleString('en-US', { maximumFractionDigits: p });
};
/** G 的建议值整理成输入框里的字符串：币本位四位小数、U 本位两位——与一键填入同一个口径。 */
const tidyGFor = (v: number, coin: boolean) => (coin ? tidyCoins(v) : String(Number(v.toFixed(2))));

const ORDER_KIND_LABEL: Record<AddOrderKind, string> = {
  market: '市价（含滑点）',
  limit: '限价 @S₂',
  conditional: '条件单 @S₂',
};
const ORDER_KIND_TITLE: Record<AddOrderKind, string> = {
  market: '市价单：在引擎基准价上按 Taker 滑点成交，S₂ 跟着基准价走',
  limit: '限价 / 只做 Maker：按挂单价原价成交，不计滑点',
  conditional: '条件委托：S₂ 是触发价，触发后按市价成交，定量计入触发价上的滑点（突破加仓用这一档）',
};

interface PlanSeed {
  plan: AddSizingSnapshot;
  side: AddSide;
  sBar: string;
  x1: string;
  g: string;
  /** G 与计划里的不同（本场落袋在计划之后变了）：计划里的那个数；没变为 null。 */
  gChangedFrom: number | null;
}

/**
 * 重新打开计算器时，仓库里仍在保鲜期的计划还算不算「当前持仓周期、当前 G」下的计划，算的话怎么种回输入框。
 *
 * 保鲜期只管真实时间，管不了状态：
 *   · 计划早于当前持仓最早一笔成交的真实开仓时刻（停止回放后同一段历史又重放了一遍、或平掉又重开）——不是这一场的计划，整个不认；
 *   · 计划那一侧没有持仓、别的方向却有比计划更新的持仓——同理不认；
 *   · X₁ / S̄ 按**计划那一侧**的持仓重读（主空战役带着多头对冲腿，pickHeldSide 先看多头，拿它种会把空头计划算成多头腿的数）；
 *     这一侧没有持仓（空仓预演）才用计划里的数；
 *   · G：打开时本来就会自动带入本场 G 的情形（这一侧有持仓、每笔成交都有真实开仓时刻、有落袋信号），
 *     本场 G 与计划里的不同就换成本场的——计划之后又实现了一笔亏损，旧 G 会把上限抬高一倍多；
 *     其余情形（老仓位、没有落袋信号、看的是另一侧）照计划里的 G。
 */
function planSeedOnOpen(args: {
  plan: AddSizingSnapshot | null;
  symbol: string;
  positions: Position[] | undefined;
  face: number;
  held: HeldPositionSummary | null;
  tradeHistory: TradeRecord[] | undefined;
}): PlanSeed | null {
  const { plan, symbol, positions, face, held, tradeHistory } = args;
  if (!plan) return null;
  const sideHeld = readHeldPosition(symbol, positions, plan.side, face);
  const newerThanPlan = (h: HeldPositionSummary | null) => h?.earliestOpenedRealAt != null && h.earliestOpenedRealAt > plan.at;
  if (sideHeld ? newerThanPlan(sideHeld) : newerThanPlan(held)) return null;

  const coin = plan.settlement === 'coin';
  let g = plan.g !== 0 ? String(plan.g) : '';
  let gChangedFrom: number | null = null;
  // 与打开时自动带入本场 G 同一组条件（见下方 effect）：只有它会自动带入，这里才拿本场 G 替换计划里的
  if (held && held.side === plan.side && held.earliestOpenedRealAt != null) {
    const banked = detectBankedMirrorProfit(symbol, plan.side, tradeHistory, held.earliestOpenTime ?? null, positions,
      { earliestOpenedRealAt: held.earliestOpenedRealAt });
    const suggest = coin ? banked.coin : banked.usd;
    const signal = banked.count > 0 || (Number.isFinite(suggest) && suggest !== 0);
    if (signal && Number.isFinite(suggest)) {
      const tidy = tidyGFor(suggest, coin);
      if (Number(tidy) !== plan.g) {
        g = tidy;
        gChangedFrom = plan.g;
      }
    }
  }
  return {
    plan,
    side: plan.side,
    sBar: sideHeld ? tidyPx(sideHeld.avgEntry) : String(plan.sBar),
    x1: sideHeld ? tidyCoins(sideHeld.coins) : String(plan.x1),
    g,
    gChangedFrom,
  };
}

/**
 * 无解分两档，不能混为一谈：
 *   还没填全 → 中性，这不是错误；
 *   条件违反 → 告警，并给出「差多少」这个能行动的数。
 */
function cushionNote(r: CushionAddResult, side: AddSide): { text: string; violation: boolean } {
  if (r.problem === 'invalid_input') return { text: '填入 S̄ · S₁ · S₂ · X₁ 后计算', violation: false };
  if (!r.needed) return { text: '无法计算', violation: true };
  const dir = r.needed.mustBe === 'above' ? '高于' : '低于';
  const what = r.problem === 's1_not_past_cost' ? '没有浮盈垫' : '新腿没有风险距离';
  return {
    text: `${what} · ${side === 'LONG' ? '主多' : '主空'}需 ${r.needed.field} ${dir} ${fmtPx(r.needed.threshold)}，还差 ${fmtPx(r.needed.gap)}`,
    violation: true,
  };
}

const BANKED_PROBLEM: Record<string, string> = {
  no_s1: '填入 S₁ 后计算',
  no_s2: '填入 S₂ 后计算',
  kB_not_below_s2: 'K_B 需低于 S₂',
  kB_not_above_s2: 'K_B 需高于 S₂',
  x2_not_positive: 'X₂ᴮ 需大于 0',
  x2_not_above_g: 'X₂ᴮ 需大于 G',
};

/** Plan B 算不出来时缺的是哪一项——先报价格，不报可选的旋钮。 */
function planBMissingNote(side: AddSide, sBar: number, s1: number, s2: number, x1: number): string {
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  if (!ok(s1)) return '填入 S₁ 后计算';
  if (!ok(s2)) return '填入 S₂ 后计算';
  if (!ok(sBar) || !ok(x1)) return '填入 S̄ · X₁ 后计算';
  return `新腿没有风险距离 · ${side === 'LONG' ? '主多' : '主空'}需 S₂ ${side === 'LONG' ? '高于' : '低于'} S₁`;
}

export function AddSizingCalculator({ open, onClose, symbol, currentPrice = 0, fillBasePrice = 0, pricePrecision, quantityPrecision }: Props) {
  const ctx = useTradingContext();
  const positions = ctx.positionsMap[symbol];
  const face = getCoinMarginedContractSizeUsd(symbol);
  const coinName = getSettlementAsset(symbol);

  const held = useMemo(() => pickHeldSide(symbol, positions, face), [symbol, positions, face]);

  const [side, setSide] = useState<AddSide>('LONG');
  const [sBar, setSBar] = useState('');
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  /**
   * 限价档手动改过 S₂ 就锁住，不再跟盘面走；条件单档一切过去就锁住（触发价跟着现价走就永远是一张立即成交的单）；
   * 复位图标解锁。市价档不留锁——市价单只能在基准价上成交；
   * 唯一的例外是还没有基准价可比时手填的值，基准价一到就按「一格」规则收拾（见下方 effect）。
   */
  const [s2Locked, setS2Locked] = useState(false);
  /** 下单方式：默认市价——引擎按滑点成交，定量必须按预计成交价。 */
  const [orderKind, setOrderKind] = useState<AddOrderKind>('market');
  /** 市价档里手填了离基准价超过一格的 S₂，被自动切到了限价：显示那一行说明。 */
  const [autoLimit, setAutoLimit] = useState(false);
  /**
   * 重新打开时本场 G 与计划里的不同，已换成本场的：计划里的那个数（说明用）。
   * 不同的原因可能是计划之后又落袋 / 止损了，也可能是上次手改过 G——说明只陈述「重填了、原来是多少」，不断言原因。
   */
  const [gChangedFrom, setGChangedFrom] = useState<number | null>(null);
  /**
   * 打开后的种子已经落进输入框。第一帧的输入还是空的（种子在 effect 里才写进去），
   * 那一帧算出的「没有计划」不能发布——那会把下单面板正指望着的计划清掉。
   */
  const [seeded, setSeeded] = useState(false);
  const [x1, setX1] = useState('');
  const [g, setG] = useState('');
  const [knobKind, setKnobKind] = useState<BankedKnob['kind']>('line');
  const [kB, setKB] = useState('');
  const [x2B, setX2B] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const bankedAutoSeededRef = useRef(false);
  /** S₂ 的种子：引擎成交基准价优先；没给（老调用方 / 测试）才退到显示价。 */
  const seedPrice = fillBasePrice > 0 ? fillBasePrice : currentPrice;

  /**
   * 结算口径跟**被加仓的那条仓位**走，不跟下单面板。
   * 面板每次打开都回到币本位，而 U 本位仓位重开后仍是 U 本位（RUNEUSDT 与 RUNEUSD 是两张合约）——
   * 读面板会把这条仓位的垫子、G 与每币风险都按币本位除以 S₁，X₂ 算的是另一张合约。
   * 先看当前选中方向的腿；缺该字段的老仓位按 U 本位解读（与引擎折币 legOpeningCoins、历史记录同一口径）；
   * 这一侧没有腿（空仓预演）才退回面板当前的结算方式。
   * 同一侧混着两张合约时取第一条腿——X₁ 本来就把各腿币量加在一起，这里不另起炉灶。
   */
  const { getSymbolSettlementMode } = ctx;
  const settlement = useMemo<SettlementMode>(() => {
    const leg = (positions ?? []).find(p => p && p.side === side);
    return leg ? (leg.settlementMode ?? 'usdt') : getSymbolSettlementMode(symbol);
  }, [positions, side, getSymbolSettlementMode, symbol]);
  const isCoin = settlement === 'coin';
  const gUnit = isCoin ? coinName : 'USD';

  const seedRef = useRef({ held, seedPrice, symbol, positions, face, tradeHistory: ctx.tradeHistory });
  seedRef.current = { held, seedPrice, symbol, positions, face, tradeHistory: ctx.tradeHistory };
  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    const { held: h, seedPrice: px, symbol: sym, positions: pos, face: f, tradeHistory: th } = seedRef.current;
    /**
     * 这个标的还有仍在保鲜期、且仍属于当前持仓周期的计划（多半刚「按上限下单」过，面板里正预填着）：
     * S₁ / 下单方式从它种回，限价 / 条件单计划的价原样锁回去；X₁ / S̄ 按计划那一侧的持仓读，G 按本场落袋读（planSeedOnOpen）。
     * 持仓、G 与价都没动时算出来的就是同一份计划，不会重新发布；动了就发布新计划（替换，不清空）。
     * 数字用 String() 原样写回——tidyPx 只留 8 位有效数字，会让计划差出一丝、被当成新计划。
     * 计划不认（过期、上一场的）就照空白打开：S₁ 为空、没有计划可发布，仓库里那份随之清掉。
     */
    const seed = planSeedOnOpen({ plan: getFreshAddSizingPlan(sym), symbol: sym, positions: pos, face: f, held: h, tradeHistory: th });
    const live = seed?.plan ?? null;
    setSide(seed?.side ?? h?.side ?? 'LONG');
    setSBar(seed ? seed.sBar : (h ? tidyPx(h.avgEntry) : ''));
    setX1(seed ? seed.x1 : (h ? tidyCoins(h.coins) : ''));
    if (live && live.orderKind !== 'market') {
      setS2(String(live.s2Ref)); setS2Locked(true); setOrderKind(live.orderKind);
    } else {
      setS2(px > 0 ? tidyPx(px) : ''); setS2Locked(false); setOrderKind('market');
    }
    setAutoLimit(false);
    setS1(live ? String(live.s1) : '');
    setG(seed ? seed.g : '');
    setGChangedFrom(seed?.gChangedFrom ?? null);
    // G 已经按计划 / 本场落袋定好了，不再让下面的自动带入再覆盖一次（它这一帧读到的方向还是上一帧的）
    bankedAutoSeededRef.current = live != null;
    setKnobKind('line'); setKB(''); setX2B(''); setHelpOpen(false); setSideOpen(false);
    setSeeded(true);
  }, [open]);
  /**
   * 弹窗开着时 S₂ 跟着引擎成交基准价走。它是模态的，要关掉才能下单——
   * 种下一次就冻结的 S₂ 在回放继续走的那几秒里会陈旧，而上限对 S₂ 的弹性有十几倍。
   * 种子落定之前不跟：打开那一帧里这里读到的锁还是旧值，会把刚种回的限价挂单价覆盖成现价。
   */
  useEffect(() => {
    if (!open || !seeded || s2Locked || !(seedPrice > 0)) return;
    setS2(tidyPx(seedPrice));
  }, [open, seeded, s2Locked, seedPrice]);

  /**
   * 一格价：面板的价格精度（没给就按基准价的量级推，与 context 同一规则）。
   * 市价档里手填的 S₂ 与基准价差不到一格，视为同一个价；超过一格，那就只能是限价单。
   */
  const tickDecimals = pricePrecision != null && Number.isFinite(pricePrecision) && pricePrecision >= 0
    ? Math.min(15, Math.floor(pricePrecision))
    : getPriceDecimals(seedPrice);
  const priceTick = 10 ** -tickDecimals;
  const s2OffBase = (v: number) => seedPrice > 0 && !(Number.isFinite(v) && Math.abs(v - seedPrice) <= priceTick * (1 + 1e-9));
  /** 回到市价：S₂ 重新种在基准价上并恢复跟随（市价单没有别的价可成交）。 */
  const backToMarket = () => {
    setOrderKind('market');
    setAutoLimit(false);
    if (seedPrice > 0) { setS2(tidyPx(seedPrice)); setS2Locked(false); }
  };
  const editS2 = (v: string) => {
    setS2(v);
    if (orderKind !== 'market') { setS2Locked(true); return; }
    // 没有基准价（老调用方）就无从比较：照旧锁住、留在市价
    if (!(seedPrice > 0)) { setS2Locked(true); return; }
    // 差不到一格：仍是这张市价单，不上锁，继续跟着基准价
    if (!s2OffBase(toNum(v))) return;
    setS2Locked(true);
    setOrderKind('limit');
    setAutoLimit(true);
  };
  const pickOrderKind = (k: AddOrderKind) => {
    if (k === 'market') { backToMarket(); return; }
    setOrderKind(k);
    setAutoLimit(false);
    // 条件单的触发价不能跟着现价走（跟着走就永远是一张立即成交的单，引擎会拒）：切过去就锁住，等人填触发价
    if (k === 'conditional') setS2Locked(true);
  };
  const editG = (v: string) => { setG(v); setGChangedFrom(null); };
  /**
   * 市价档不留锁：没有基准价时手填的 S₂ 会锁在市价档里，基准价一到就按同一条规则收拾——
   * 离基准价一格以上切到限价（同一行说明），否则解锁跟随。
   */
  useEffect(() => {
    if (!open || !seeded || orderKind !== 'market' || !s2Locked || !(seedPrice > 0)) return;
    if (s2OffBase(toNum(s2))) {
      setOrderKind('limit');
      setAutoLimit(true);
    } else {
      setS2Locked(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seeded, orderKind, s2Locked, seedPrice, s2, priceTick]);

  /** G 带符号；留空按 0。负数照扣——截成 0 会退回 Plan A，与 Legs 校验给出相反的对错号。 */
  const gVal = Number.isFinite(toNum(g)) ? toNum(g) : 0;
  const bankedOn = gVal !== 0;
  const gPositive = gVal > 0;
  const fmtG = (v: number) => (isCoin ? `${fmtCoins(v, 4)} ${coinName}` : `${fmtUsd(v)} USD`);

  /**
   * 预计成交价 S₂′。可用垫 Y₁ + G 与 S₂ 无关，先在定量基准价上按同一条式子取出 available，
   * 再解上限：上限的名义决定滑点、滑点决定成交价、成交价决定上限——sizeAddAtExpectedFill 用二分解，取在自己成交价上不超的那一端。
   * 定量基准价：市价 = 引擎成交的基准价本身（市价单只能在它上面成交，引擎在它上面加滑点；
   * 输入框只留 8 位有效数字，不拿它定量）；限价 = 挂单价，即 S₂ 按面板价格精度向有利侧取整。
   */
  const s2Ref = orderKind === 'market' && seedPrice > 0 ? seedPrice : toNum(s2);
  const priceDecimals = pricePrecision != null && Number.isFinite(pricePrecision) && pricePrecision >= 0
    ? pricePrecision
    : getPriceDecimals(s2Ref);
  /** 挂单价 / 触发价：面板只能挂这个精度的价，向有利侧取整后再定量（条件单的触发价同理，定量就在取整后的触发价上）。 */
  const limitPx = orderKind !== 'market' ? roundLimitPriceFavorable(s2Ref, priceDecimals, side) : s2Ref;
  const limitRounded = orderKind !== 'market' && Number.isFinite(limitPx) && limitPx !== s2Ref;
  const taker = isTakerOrderKind(orderKind);
  /** 条件单的触发价离基准价不到一格：引擎会当成立即成交的单拒掉，这时不给计划。 */
  const conditionalAtBase = orderKind === 'conditional' && seedPrice > 0 && !s2OffBase(limitPx);
  const coverageProbe = useMemo(
    () => computePlanBCoverageAtS1({ side, settlement, sBar: toNum(sBar), s1: toNum(s1), s2: limitPx, x1: toNum(x1), g: gVal }),
    [side, settlement, sBar, s1, limitPx, x1, gVal],
  );
  const fillPlan = useMemo(
    () => (coverageProbe
      ? sizeAddAtExpectedFill({
        side, settlement, coverage: coverageProbe.available, s1: toNum(s1), s2Ref: limitPx, orderKind,
        contractFaceUsd: isCoin ? face : null,
      })
      : null),
    [coverageProbe, side, settlement, s1, limitPx, orderKind, isCoin, face],
  );
  /**
   * 所有派生量用的加仓价：市价 = 与上限一起解出的 S₂′，限价 = 挂单价。
   * 解不出（S₁ 没填、S₂ 没越过 S₁……）时**不**拿零名义的 S₂ × 1.0001 充数：
   * 那一丝 0.01% 会被当成风险距离，S₁ = S₂ 时算出几十倍于持仓的「上限」。退回定量基准价，
   * Plan A / B 与 R0 照旧报「新腿没有风险距离」，与限价档一致。
   */
  const s2Eff = fillPlan ? fillPlan.s2Fill : limitPx;
  /** 价格线上显示的 S₂′：没有上限时市价档只含固定的 0.01%——只作显示，不进任何计算。 */
  const s2Shown = fillPlan ? fillPlan.s2Fill : expectedFillPrice(limitPx, 0, side, orderKind);
  const slippagePct = !taker
    ? 0
    : fillPlan ? fillPlan.slippagePct : (Number.isFinite(s2Shown) ? (s2Shown / limitPx - 1) * 100 : Number.NaN);

  const cushion = useMemo(
    () => computeCushionAdd({ side, sBar: toNum(sBar), s1: toNum(s1), s2: s2Eff, x1: toNum(x1) }),
    [side, sBar, s1, s2Eff, x1],
  );
  const note = cushionNote(cushion, side);
  /**
   * 真正的 Plan B：当前旧仓在 S₁ 的净浮盈（可为负）+ 本轮落袋净额 G（可为负）。
   * 这一步每次都读当前 X₁ / S̄，所以更早加仓在新 S₁ 上的浮亏会自动扣回来。
   * 按 S₂′ 算——addCoinsMax 与 fillPlan.addCoinsMax 是同一个数。
   */
  const planB = useMemo(
    () => computePlanBCoverageAtS1({
      side,
      settlement,
      sBar: toNum(sBar),
      s1: toNum(s1),
      s2: s2Eff,
      x1: toNum(x1),
      g: gVal,
    }),
    [side, settlement, sBar, s1, s2Eff, x1, gVal],
  );

  /**
   * 「本场」要同时过两只钟：模拟时间之外，止盈的操作时间不得早于当前持仓的真实起点——
   * 同一段历史重放多遍时，别的重放在同一模拟时刻落袋的止盈否则会被当成本场的 G。
   */
  const banked = useMemo(
    () => detectBankedMirrorProfit(symbol, side, ctx.tradeHistory, held?.earliestOpenTime ?? null, positions,
      { earliestOpenedRealAt: held?.earliestOpenedRealAt ?? null }),
    [symbol, side, ctx.tradeHistory, held?.earliestOpenTime, held?.earliestOpenedRealAt, positions],
  );
  /**
   * 这笔 G 是不是已经花过了。
   * 「第几次加仓」的可靠信号是**落袋之后又开了几笔仓**——G 从落袋那一刻才存在,
   * 只有之后开的仓位才可能花掉它。数持仓条数不行:主仓与镜像是同一刻开出的两条腿;
   * 也不能数仓位:同向加仓合并进同一仓位，只多一笔 fill。
   */
  const bankedMaybeSpent = banked.addsSinceBanked > 0;
  const bankedSuggest = isCoin ? banked.coin : banked.usd;
  /** 有止盈、或者净额不为 0（只有亏损也算）——都要让人看见，负净额不能静默丢掉。 */
  const hasBankedSignal = banked.count > 0 || (Number.isFinite(bankedSuggest) && bankedSuggest !== 0);
  const tidyG = (v: number) => tidyGFor(v, isCoin);

  /**
   * 真实操作时间完整时，「这笔 G 属于当前持仓周期」已经是可靠事实，直接默认代入（正负都代入）。
   * 老仓位缺 openedRealAt 时仍保留为手动建议，避免模拟时间撞车时自动把别次回放的钱带进来。
   */
  useEffect(() => {
    if (!open) {
      bankedAutoSeededRef.current = false;
      return;
    }
    if (bankedAutoSeededRef.current || !held || side !== held.side) return;
    if (held.earliestOpenedRealAt == null || !hasBankedSignal || !Number.isFinite(bankedSuggest)) return;
    bankedAutoSeededRef.current = true;
    setG(tidyGFor(bankedSuggest, isCoin));
  }, [open, held, side, bankedSuggest, hasBankedSignal, isCoin]);

  /**
   * 盘口上真实挂着的对冲线。整套「锁死」的前提是 S₁ 就是这条线——
   * 此前计算器读不到 ordersMap，两者可以静默地不是同一个数：
   * 实测填 0.114572 而盘口挂 0.114401，差 0.149%，加仓量因此超 9.1%，
   * 到线那一刻净值 −3,247 而不是设计的 0。
   * 只产出候选、不预填也不锁定：系统分不出「对冲单」和「试单/遗留单」的意图，
   * 用一个可能错的值去占住用户唯一需要判断的输入，是让确定性最低的一方拿走决定权。
   */
  const hedgeRead = useMemo(() => readHedgeLines(
    symbol, ctx.ordersMap, positions, side,
    (held?.earliestOpenTime ?? 0) - PRE_MAIN_LOOKBACK_MS,
    isCoin ? 'coin' : 'usdt', face,
  ), [symbol, ctx.ordersMap, positions, side, held?.earliestOpenTime, isCoin, face]);

  // 偏差比对的「盘口线」与 Legs 加仓校验读 S₁ 同一规则：亏损侧离 S₂ 最近、价格回落先被打到的那张。
  const bookLine = useMemo(() => pickBookLine(hedgeRead.candidates, side, s2Eff), [hedgeRead.candidates, side, s2Eff]);
  const s1Deviation = useMemo(() => {
    if (!bookLine || !planB) return null;
    if (sameLine(bookLine.price, toNum(s1))) return null;
    const deviation = evaluateS1Deviation({
      side, sBar: toNum(sBar), s1: toNum(s1), s2: s2Eff,
      x1: toNum(x1), g: gVal, bookPrice: bookLine.price,
      settlement: isCoin ? 'coin' : 'usdt',
    });
    return deviation && (deviation.typedAdd > 0 || deviation.shouldAdd > 0) ? deviation : null;
  }, [bookLine, planB, side, sBar, s1, s2Eff, x1, gVal, isCoin]);

  const effectiveKB = kB !== '' ? toNum(kB) : toNum(s1);
  const bankedRes = useMemo(() => {
    const knob: BankedKnob = knobKind === 'line' ? { kind: 'line', kB: effectiveKB } : { kind: 'size', x2: toNum(x2B) };
    return computeBankedAdd({ side, settlement, g: gVal, s2: s2Eff, s1: toNum(s1), knob });
  }, [knobKind, effectiveKB, x2B, side, settlement, gVal, s2Eff, s1]);

  /**
   * 规则给出的上限：max(0, Y₁ + G) ÷ 每币风险。**只由规则决定**，旋钮拧到哪都不改它。
   * 有 fillPlan 就用它的上限——那是在它**自己的**成交价 S₂′ 上不超垫子的那个数（二分的下端）；
   * 大字、张数、R0、快照、「按上限下单」全部读这一个数，不再各算各的。
   */
  const limitCoins = fillPlan ? fillPlan.addCoinsMax : (planB?.addCoinsMax ?? 0);

  /**
   * 计划的对冲占同一个分层上限：S₁ 上那张反向条件单要盖住 X₁ + X₂。
   * 已经挂在 S₁ 这条线上的对冲（盘口候选里与 S₁ 是同一条线的）和已成交的反向持仓算已有，只补差额。
   */
  const tierHedge = useMemo(() => {
    const price = toNum(s1);
    const mainCoins = toNum(x1);
    if (!(price > 0) || !Number.isFinite(mainCoins) || mainCoins < 0) return null;
    const resting = hedgeRead.candidates.filter(c => sameLine(c.price, price)).reduce((sum, c) => sum + c.coins, 0);
    return { price, mainCoins, existingCoins: resting + hedgeRead.filledHedgeCoins };
  }, [s1, x1, hedgeRead]);
  /**
   * 币安分层给这一侧留的余量（按当前杠杆；持仓多空相加 + 非只减仓挂单），单看这一单时与下单面板「可开」同一个判定；
   * 再给计划的对冲留出位置（加仓与要补挂的对冲都得放得下，两张单谁先成交 / 触发都放得下，也不让已挂的触发单注定被拒）。
   * 估值价：市价 = 引擎成交基准价，限价 = 挂单价，条件单 = 触发价；币本位的整张按 S₂′ 折回币。
   * 算不出（还没有价）时为 null，只受 Plan B 约束。
   */
  const tierRoom = useMemo(() => addTierHeadroom({
    symbol, settlement, side,
    storedLeverage: ctx.leverageMap?.[symbol],
    positions,
    orders: ctx.ordersMap?.[symbol],
    markPrice: seedPrice,
    orderKind,
    orderPrice: limitPx,
    fillPrice: s2Eff,
    contractFaceUsd: isCoin ? face : null,
    hedge: tierHedge,
  }), [symbol, settlement, side, ctx.leverageMap, positions, ctx.ordersMap, seedPrice, orderKind, limitPx, s2Eff, isCoin, face, tierHedge]);
  const tierCoins = tierRoom ? tierRoom.coins : Infinity;
  /** 分层比 Plan B 更紧：可下单量按分层来。 */
  const tierBinds = tierRoom != null && tierCoins < limitCoins * (1 - 1e-12);
  /** 可下单量 = min(Plan B 上限, 分层余量)：大字、张数、合计对冲、「按上限下单」都读它。 */
  const offeredCoins = Math.min(limitCoins, tierCoins);
  const offeredContracts = isCoin && fillPlan?.contracts != null
    ? (tierRoom?.contracts != null ? Math.min(fillPlan.contracts, tierRoom.contracts) : fillPlan.contracts)
    : null;
  /** 可下单量的整张：币本位取 fillPlan 按引擎名义向下取整的张数（再按分层封顶），与按钮同一个数。 */
  const limitContractsText = offeredContracts != null
    ? ` · ${offeredContracts.toLocaleString('en-US')} 张`
    : null;
  /**
   * 那一行说明：分层还剩多少、卡住的是哪一个；给对冲留了位置就说留了多少，对冲本身挂不下就直说。
   */
  const tierHedgeRoom = tierRoom?.hedge ?? null;
  /** 对冲在分层里的处境：blocked（对冲本身挂不下）/ binds（给对冲留位后可下单量变小）/ fits / none。 */
  const tierHedgeState = !tierHedgeRoom
    ? 'none'
    : tierHedgeRoom.blocked
      ? 'blocked'
      // 分层本身已经没有余量（卡在加仓这一侧）时不谈对冲
      : !(Number(tierRoom?.coins) > 0) || !(tierHedgeRoom.coins > 0)
        ? 'none'
        : tierHedgeRoom.binds ? 'binds' : 'fits';
  const tierHedgeText = (() => {
    if (!tierHedgeRoom || !tierRoom) return '';
    const px = fmtPx(tierHedgeRoom.price);
    if (tierHedgeState === 'blocked') {
      const lots = tierHedgeRoom.contracts != null ? ` / ${tierHedgeRoom.contracts.toLocaleString('en-US')} 张` : '';
      return `——S₁ ${px} 上还要补挂的对冲 ${fmtCoins(tierHedgeRoom.coins, 4)} ${coinName}${lots} 已经放不下`
        + `（对冲这一侧最多还能挂 ${fmtCoins(tierHedgeRoom.roomCoins, 4)} ${coinName}），先减仓或撤单，再谈加仓`;
    }
    if (tierHedgeState === 'binds') {
      return `（已给 S₁ ${px} 上的合计对冲留出位置，加仓与对冲谁先成交都放得下；不算对冲，单看加仓还能开 ${fmtCoins(tierRoom.alone.coins, 4)} ${coinName}）`;
    }
    if (tierHedgeState === 'fits') return `（S₁ ${px} 上的合计对冲也放得下）`;
    return '';
  })();
  const tierRoomText = tierRoom && fillPlan && limitCoins > 0
    ? `分层上限：当前 ${tierRoom.leverage}x 最多再开 ${fmtCoins(tierRoom.coins, 4)} ${coinName}`
      + `${tierRoom.contracts != null ? `（${tierRoom.contracts.toLocaleString('en-US')} 张）` : ''}`
      + tierHedgeText
      + ` · 持仓和当前委托 ${formatTierAmount(tierRoom.limit.exposureBefore, tierRoom.limit.unit)} / 最高 ${formatTierAmount(tierRoom.limit.cap, tierRoom.limit.unit)}`
      + (tierBinds ? `——比 Plan B 上限 ${fmtCoins(limitCoins)} ${coinName} 小，可下单量按分层` : '——Plan B 上限更小，按 Plan B')
    : null;
  /**
   * 旋钮是否在用：只有 G > 0 才有 B 腿可拧；K_B 留空（= S₁）或定仓没填时，计划加仓就是上限本身。
   */
  const knobActive = gPositive && ((knobKind === 'line' && kB !== '') || (knobKind === 'size' && x2B !== ''));
  /**
   * 计划加仓：默认取上限；旋钮在用时 = 旧仓垫折算量 + B 腿 X₂ᴮ，交给 R0 与上限比对。
   * 旋钮给了无效值时为 NaN——不拿一个猜的量去复核。
   */
  const plannedAddCoins = !planB
    ? 0
    : knobActive
      // 旋钮推出的量同样过不了分层之外的部分：超出分层余量的那一截下不出去
      ? (bankedRes.ok ? Math.min(Math.max(0, planB.cushionAddCoins + bankedRes.x2), tierCoins) : Number.NaN)
      : offeredCoins;
  const planBHasRoom = planB != null && planB.available > 0 && limitCoins > 0;
  const hedgeCoinsAtS1 = toNum(x1) + (Number.isFinite(plannedAddCoins) ? plannedAddCoins : offeredCoins);
  /** Plan A 大字（G = 0）：有 fillPlan 就是同一个可下单量；没有才退回 Plan A 自己的代数（同样按分层封顶）。 */
  const planAX2 = fillPlan ? offeredCoins : Math.min(cushion.x2Max, tierCoins);
  const planAHedge = fillPlan || planAX2 < cushion.x2Max ? toNum(x1) + planAX2 : cushion.hedgeCoinsAtS1;

  const bankedProblem = bankedOn && !planB
    ? planBMissingNote(side, toNum(sBar), toNum(s1), s2Eff, toNum(x1))
    : gPositive && planB && !bankedRes.ok
      ? (bankedRes.problem === 'disabled'
        ? (knobKind === 'size' ? '填入 X₂ᴮ 后计算' : '填入 K_B 后计算')
        : BANKED_PROBLEM[bankedRes.problem ?? ''] ?? '无法计算')
      : null;

  /**
   * R0 复核 —— A3-R 的门槛：加仓后重算综合成本线，越过止损线即当场非法。
   *
   * 这函数在 addSizing.ts 里躺了一直没接进界面。AIOTUSDT 2025-05-03 的学费：
   * 合法上限 A+B = 4,264,691 币(1.79M USDT)，实际加了 20,066,005 币(8.41M)——
   * **4.71 倍**。加仓后成本线 0.417749、扣除落袋后 0.415646，越过 S₁(0.406286) 2.30%，
   * 折成钱是 20.6 万 USD 的本金缺口——那一场最终亏 25.4 万，几乎全部来自这里。
   * 而当时界面上没有任何一处会把「这单越界了」喊出来。
   *
   * 判据与 Legs 加仓校验同一个式子：计划加仓跌回 S₁ 的亏损 vs 旧仓净垫 Y₁ + 落袋 G。
   * G > 0 时成本线越过 S₁ 是 Plan B 的定义（越过 G ÷ (X₁ + X₂)），不该报红；
   * 报红的判据是「亏损超出 Y₁ + G」——缺口由本金支付。
   *
   * 同一条判据由两套独立算法各算一遍再对账（crossCheckPostAddR0）：垫子式与成本线式守算术本身
   * （两条路吃同一批手填数，分开只会是公式、单位折算或方向符号改坏了），
   * 外加按当前持仓各腿开仓价逐笔重算 X₁′ / Y₁′ 去核对手填的 X₁ / S̄。
   * S₁ 由上面「盘口对冲线偏差」单独核对；S₂ 与 G 没有第二来源，单位与符号仍靠人核对。
   * 哪一条对不上，这里就只报「自检不一致」，绝不说「通过」。
   */
  /**
   * 逐笔式按**当前选中方向**的持仓腿比，而不是 pickHeldSide 挑的那一侧：
   * 主空战役通常带着多头对冲腿，pickHeldSide 先看多头，held 就是那条对冲；切到主空后
   * 若还拿 held.side 去卡，逐笔式整个关掉，框里留着从多头种下的 X₁ / S̄ 反倒印出「通过」——
   * 正是逐笔式要抓的那类腿集错误。这一侧没有腿时才为 null。
   */
  const heldLegs = useMemo(() => readHeldPosition(symbol, positions, side, face)?.legs ?? null, [symbol, positions, side, face]);
  const r0 = useMemo(() => {
    if (!planB || !(plannedAddCoins > 0)) return null;
    const check = crossCheckPostAddR0({
      side, settlement, sBar: toNum(sBar), s1: toNum(s1), s2: s2Eff,
      x1: toNum(x1), addCoins: plannedAddCoins, g: gVal, fills: heldLegs,
    });
    if (!check) return null;
    return {
      ...check,
      /** 跌到 S₁ 仍剩的垫子（垫子式负缺口取反）；取满上限时两边只差浮点误差，不算剩 */
      residual: check.ledger.gap < -check.tolerance ? -check.ledger.gap : 0,
      excessCoins: plannedAddCoins - limitCoins,
      /** 逐笔式偏差是否大到像取错了腿集（相对 1% 以上）；小于此只说「不符」，不断言原因——手误一位小数也会不符 */
      fillsFarOff: !!check.fills && !check.fills.agrees && (
        Math.abs(check.fills.x1Delta) > 0.01 * Math.max(check.fills.x1, toNum(x1))
        || Math.abs(check.fills.cushionDelta) > 0.01 * Math.max(Math.abs(check.fills.cushion), Math.abs(check.ledger.cushion))
      ),
    };
  }, [planB, plannedAddCoins, limitCoins, side, settlement, sBar, s1, s2Eff, x1, gVal, heldLegs]);

  /** 对冲量的张数：四舍五入贴近仓位。 */
  const contracts = (coins: number, price: number) =>
    isCoin && Number.isFinite(coins) && price > 0 ? ` · ${coinsToContracts(coins, price, face).toLocaleString('en-US')} 张` : '';
  /** 加仓量的张数：向下取整——上限是授权额度，与下单面板同规则，绝不进一。 */
  const addContracts = (coins: number, price: number) =>
    isCoin && Number.isFinite(coins) && price > 0 ? ` · ${coinsToContractsFloor(coins, price, face).toLocaleString('en-US')} 张` : '';

  /**
   * 当前计划：上限算得出、且（币本位）至少有一整张时才有。它就是钉到单子上的那份快照（不含发布时刻）。
   * 上限只由规则决定，旋钮拧出来的「计划加仓」不进这里——快照记的是规则给的上限，实际加了多少看成交。
   */
  const s1Num = toNum(s1);
  const sBarNum = toNum(sBar);
  const x1Num = toNum(x1);
  /** 计划记下的参考价：限价 = 手填的 S₂（挂单价在 s2Fill）；市价 = 基准价；条件单 = 取整后的触发价（引擎在它上面加滑点）。 */
  const planRefPrice = orderKind === 'conditional' ? limitPx : s2Ref;
  const planSnapshot = useMemo<Omit<AddSizingSnapshot, 'at'> | null>(() => {
    if (!fillPlan || !planB || !(limitCoins > 0) || conditionalAtBase) return null;
    if (![s1Num, sBarNum, x1Num, planRefPrice, s2Eff].every(v => Number.isFinite(v) && v > 0)) return null;
    if (isCoin && !(fillPlan.contracts != null && fillPlan.contracts >= 1)) return null;
    return {
      plan: bankedOn ? 'B' : 'A', side, settlement,
      s1: s1Num, s2Ref: planRefPrice, s2Fill: s2Eff, slippagePct: Number.isFinite(slippagePct) ? slippagePct : 0,
      x1: x1Num, sBar: sBarNum, g: gVal, gUnit,
      addCoinsMax: limitCoins, contracts: isCoin ? fillPlan.contracts : null, orderKind,
    };
  }, [fillPlan, planB, limitCoins, conditionalAtBase, s1Num, sBarNum, x1Num, planRefPrice, s2Eff, isCoin, bankedOn, side, settlement, slippagePct, gVal, gUnit, orderKind]);
  // 弹窗开着时把当前计划发布出去；算不出就清掉——关掉弹窗后计划留着，等同标的同方向的开仓单来取。
  // 种子落定之前不发布：第一帧的输入还是空的，那一帧的「没有计划」不是真的没有。
  useEffect(() => {
    if (!open || !seeded) return;
    publishAddSizingPlan(symbol, planSnapshot);
  }, [open, seeded, symbol, planSnapshot]);
  // 关掉（或卸载）时把保鲜期续到此刻：回放暂停时计划不变、不会重新发布，弹窗开过半小时也不能一关就过期。
  useEffect(() => {
    if (!open) return undefined;
    return () => touchAddSizingPlan(symbol);
  }, [open, symbol]);
  /** 下单面板的数量精度（没给按两位）：按钮上的量、落进面板的量、能不能下单都按它取整。 */
  const placeDecimals = quantityPrecision != null && Number.isFinite(quantityPrecision) && quantityPrecision >= 0
    ? Math.max(0, Math.min(12, Math.floor(quantityPrecision)))
    : 2;
  /**
   * 币安单笔数量上限（lib/marketLotSize）：「按上限下单」预填的是**一笔**单子。市价 / 条件单（触发后市价）按
   * MARKET_LOT_SIZE、限价按 LOT_SIZE，在这一单自己的价上判（合成币本位的张数上限随价变化）。
   * 可下单量比单笔上限大时只预填一笔上限，并说清剩下的还要再下几笔——计划（上限、对冲）本身不因此缩小，
   * 仓位可以比单笔上限大，分几笔下就是了。
   */
  const lotAddPrice = orderKind === 'market' ? s2Ref : limitPx;
  const offeredUnits = isCoin ? (offeredContracts ?? 0) : offeredCoins;
  const lotAdd = checkLotSize({
    symbol, settlement, kind: orderKind === 'limit' ? 'limit' : 'market',
    units: offeredUnits,
    price: lotAddPrice,
  });
  /**
   * 一笔最多预填多少（引擎单位）。合成币本位的市价单按现价折张、随价变：与下单面板的 100% 一样在上限前留 0.2%，
   * 否则预填的整张在引擎按下一个 tick 的价折张时会差一张被拒。限价与条件单的价钉在委托价 / 触发价上，不留。
   */
  const lotAddCapUnits = lotAdd.maxUnits == null
    ? null
    : orderKind === 'market' && lotAdd.resolved?.source === 'usdm-proxy'
      ? Math.floor(lotAdd.maxUnits * (1 - LIVE_PRICE_TIER_HEADROOM))
      : lotAdd.maxUnits;
  /** 与判定同一个容差：按金额折出来的浮点尾巴（200,000.00000001）不算超。 */
  const lotBinds = lotAddCapUnits != null && offeredUnits > lotAddCapUnits * (1 + 1e-9) + 1e-9;
  /** 一笔最多能下的币数（币本位按整张 × 面值 ÷ 这一单的价折回币）。 */
  const lotAddMaxCoins = lotAddCapUnits == null
    ? Infinity
    : isCoin ? (lotAddPrice > 0 ? (lotAddCapUnits * face) / lotAddPrice : Infinity) : lotAddCapUnits;
  const prefillContracts = offeredContracts != null && lotAddCapUnits != null && isCoin
    ? Math.min(offeredContracts, lotAddCapUnits)
    : offeredContracts;
  const prefillCoins = Math.min(offeredCoins, lotAddMaxCoins);
  /**
   * U 本位落进下单面板的币数：按面板数量精度**向下取整**（与按钮上的字、与面板预填同一个数）。
   * 分层余量是二分出来的，收敛只到判定用的相对容差（豁免的底 30,000 × 1e-9 = 3e-5 币）：
   * 拿没取整的余量判「能不能下单」，余量实际为 0 时按钮照样出现、写着「按上限下单 · 0 KAITO」，
   * 点下去预填的是 0.00003 币（面板取整后是空数量）。取整之后再判，这一档的按钮直接不出现。
   */
  const offeredCoinsPlaceable = (() => {
    if (!Number.isFinite(prefillCoins) || prefillCoins <= 0) return 0;
    const scale = 10 ** placeDecimals;
    return Math.floor(prefillCoins * scale + 1e-7) / scale;
  })();
  /** 预填一笔之后剩下的量（引擎单位）还要再下几笔：每笔不超过同一个上限。 */
  const lotRestUnits = isCoin ? (offeredContracts ?? 0) - (prefillContracts ?? 0) : offeredCoins - prefillCoins;
  const lotRestPieces = lotBinds && lotAddCapUnits != null && lotAddCapUnits > 0
    ? Math.max(1, Math.ceil(lotRestUnits / lotAddCapUnits - 1e-9))
    : 0;
  const lotAddText = lotBinds && lotAddCapUnits != null
    ? `${lotSizeCapLabel(lotAdd)}：「按上限下单」预填一笔 `
      + `${isCoin ? `${(prefillContracts ?? 0).toLocaleString('en-US')} 张` : `${fmtCoinsFloor(prefillCoins, placeDecimals)} ${coinName}`}`
      + `${lotAddCapUnits !== lotAdd.maxUnits ? '（按现价折张，留 0.2% 余量）' : ''}，`
      + `剩下的 ${isCoin ? `${lotRestUnits.toLocaleString('en-US')} 张` : `${fmtCoins(lotRestUnits, 4)} ${coinName}`}`
      // 「张」后面直接接中文；「KAITO」这种拉丁字母单位后面空一格
      + `${isCoin ? '' : ' '}${lotRestPieces > 1 ? `再分 ${lotRestPieces} 笔下` : '另下一笔'}`
      /**
       * 出路按下单方式写：市价单可以改用限价单；条件单（突破加仓挂在现价上方买入）不行——
       * 同价的买入限价单在现价上方是一张立刻能成交的单，当场就按现价成交了，剩下的几笔同样挂成条件单。
       */
      + (orderKind === 'market' ? '（或改用限价单）' : orderKind === 'conditional' ? '（每笔都挂成条件单）' : '')
    : null;
  /**
   * S₁ 上的对冲是一张条件单，触发后是一笔市价单：合计对冲超过单笔市价上限，一张单就挂不下，要拆成几张。
   * Plan A（G = 0）读 planAHedge，Plan B 读 hedgeCoinsAtS1；张数按 S₁ 四舍五入（与上面的对冲张数同一个折法）。
   */
  const s1Px = toNum(s1);
  const hedgeForLot = bankedOn
    ? (planB && planBHasRoom ? hedgeCoinsAtS1 : Number.NaN)
    : (cushion.ok ? planAHedge : Number.NaN);
  const lotHedge = Number.isFinite(hedgeForLot) && hedgeForLot > 0 && s1Px > 0
    ? checkLotSize({
      symbol, settlement, kind: 'market',
      units: isCoin ? coinsToContracts(hedgeForLot, s1Px, face) : hedgeForLot,
      price: s1Px,
    })
    : null;
  const lotHedgeText = lotHedge && !lotHedge.ok && lotHedge.maxUnits != null && lotHedge.maxUnits > 0
    ? `S₁ ${fmtPx(s1Px)} 上的合计对冲 ${isCoin ? `${lotHedge.units.toLocaleString('en-US')} 张` : `${fmtCoins(lotHedge.units)} ${coinName}`}`
      + ` 超过${lotSizeCapLabel(lotHedge)}：条件单触发后是一笔市价单，要拆成 ${Math.ceil(lotHedge.units / lotHedge.maxUnits)} 张条件单挂在 S₁`
    : null;
  /** 可下单量至少一整张（币本位）/ 取整后大于 0（U 本位）才给按钮：分层把余量卡到 0 时，预填一张空单没有意义。 */
  const placeable = planSnapshot != null && (isCoin ? (prefillContracts ?? 0) >= 1 : offeredCoinsPlaceable > 0);
  /**
   * 「按上限下单」：可下单量（min(Plan B 上限, 分层余量)，币本位整张、U 本位币数）连同下单方式交给下单面板预填，然后关掉弹窗。
   * 钉在单子上的计划仍是 Plan B 的（上限 addCoinsMax、整张 contracts 都不改）。
   */
  const placeAtLimit = () => {
    if (!planSnapshot || !placeable) return;
    requestAddSizingPrefill(symbol, planSnapshot, {
      contracts: isCoin ? prefillContracts : planSnapshot.contracts,
      coins: prefillCoins,
      orderType: orderKind === 'market' ? 'MARKET' : orderKind === 'limit' ? 'LIMIT' : 'CONDITIONAL',
      // 限价挂在定量用的那个价上（已按面板精度向有利侧取整），计划、委托、校验三处是同一个数；条件单的触发价同理
      limitPrice: orderKind === 'limit' ? planSnapshot.s2Fill : null,
      triggerPrice: orderKind === 'conditional' ? planSnapshot.s2Ref : null,
      side,
      settlement,
    });
    onClose();
  };
  /** 按钮上的量就是落进面板的量：币本位整张；U 本位按面板数量精度向下取整（没给精度按两位）。 */
  const placeAtLimitQty = planSnapshot == null
    ? ''
    : isCoin && prefillContracts != null
      ? `${prefillContracts.toLocaleString('en-US')} 张`
      : `${fmtCoinsFloor(prefillCoins, placeDecimals)} ${coinName}`;
  const orderKindTitle = orderKind === 'market' ? '市价单' : orderKind === 'limit' ? `限价单 @ ${fmtPx(s2Eff)}` : `条件委托 · 触发价 ${fmtPx(limitPx)}（触发后市价）`;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[600px]" data-testid="add-sizing-dialog">
        {/* pr-14 给右上角的关闭 × 让位——ml-auto 的「?」会和它叠在一起 */}
        <DialogHeader className="space-y-0 border-b border-border py-2.5 pl-4 pr-14">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-[13px] font-medium">加仓计算器</DialogTitle>
            <span className="font-mono text-[11px] text-muted-foreground">{symbol}</span>
            <button
              type="button"
              data-testid="add-sizing-help"
              aria-label="使用说明"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen(v => !v)}
              className="ml-auto h-4 w-4 shrink-0 rounded-full text-[10px] leading-4 text-muted-foreground/25 transition-colors hover:bg-accent hover:text-foreground"
            >
              ?
            </button>
          </div>
        </DialogHeader>

        {helpOpen && (
          <div data-testid="add-sizing-help-panel" className="border-b border-border bg-muted/30 px-4 py-2.5 font-mono text-[10px] leading-[1.7] text-muted-foreground">
            <div className="text-foreground">Plan B 加仓上限 X_add,max = max(0, Y₁ + G) ÷ 每币风险</div>
            <div>Y₁ = X₁(S₁−S̄)，可为负；G = 本轮止盈1 − 本轮已实现亏损，可为负；险 = |S₂−S₁|</div>
            <div>U 本位：每币风险 = 险。币本位：Y₁、G 以币计（Y₁ ÷ S₁），每币风险 = 险 ÷ S₁</div>
            <div>拆解：X₂ᴬ = Y₁ ÷ 险 = X₁ ÷ b；X_G = G ÷ 险（币本位 G·S₁ ÷ 险），只作拆解、不单独下单</div>
            <div>b = 险 / (S₁−S̄)</div>
            <div className="font-sans">此处的 b 往回看（成本线 → 止损线 → 现价），与盘面 P_gap 的 b（现价 → 目标）无关</div>
            <div>对冲 @ S₁ = X₁ + X_add（实际加仓量）；每次都用当前 X₁ / S̄ 重算</div>
            <Link to="/guide#s3-1c" className="mt-1 inline-block font-sans text-primary hover:underline">完整说明 · 使用说明 3.4 →</Link>
          </div>
        )}

        <div className="space-y-3 px-4 py-3">
          {/* 方向 + 盘面。方向默认由持仓推定，几乎不用改——
              所以收成一个小字，点开才露出另一个选项，不占常驻视觉分量。 */}
          <div className="flex items-center gap-1">
            {sideOpen ? (
              (['LONG', 'SHORT'] as AddSide[]).map(v => (
                <button
                  key={v}
                  type="button"
                  data-testid={`add-sizing-side-${v}`}
                  onClick={() => { setSide(v); setSideOpen(false); }}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    side === v
                      ? (v === 'LONG' ? 'bg-trading-green/15 text-trading-green' : 'bg-trading-red/15 text-trading-red')
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {v === 'LONG' ? '主多' : '主空'}
                </button>
              ))
            ) : (
              <button
                type="button"
                data-testid="add-sizing-side-toggle"
                onClick={() => setSideOpen(true)}
                title="切换方向"
                className={`rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent ${
                  side === 'LONG' ? 'text-trading-green/60 hover:text-trading-green' : 'text-trading-red/60 hover:text-trading-red'
                }`}
              >
                {side === 'LONG' ? '主多' : '主空'}
              </button>
            )}
            {held && (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                盘面 {held.legCount} 笔 · {fmtUsd(held.notionalUsd)} USD
              </span>
            )}
          </div>

          {/* 输入：按价格阶梯顺序 S̄ → S₁ → S₂，X₁ 殿后 */}
          <div className="grid grid-cols-4 gap-x-2">
            <Field label="S̄ 均价" value={sBar} onChange={setSBar} testId="add-sizing-sbar"
              onReset={held ? () => setSBar(tidyPx(held.avgEntry)) : undefined} />
            <Field label="S₁ 止损线" value={s1} onChange={setS1} testId="add-sizing-s1" accent />
            <Field label="S₂ 加仓价" value={s2} onChange={editS2} testId="add-sizing-s2"
              onReset={seedPrice > 0 ? backToMarket : undefined} />
            <Field label={`X₁ ${coinName}`} value={x1} onChange={setX1} testId="add-sizing-x1"
              onReset={held ? () => setX1(tidyCoins(held.coins)) : undefined} />
          </div>

          {/* S₂ 的两条线：参考价与预计成交价。市价单在引擎里按 0.01% + 名义/50亿 滑点成交，
              上限对 S₂ 的弹性是 S₁/(S₂−S₁) ≈ 十几倍——0.14% 的滑点就是 1.6% 的超限。
              定量一律按 S₂′，S₂ 只是它的来源；限价 @S₂ 原价成交，S₂′ = S₂。 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
            <div data-testid="add-sizing-order-kind" className="flex h-6 items-center gap-0.5 rounded bg-secondary p-0.5">
              {(['market', 'limit', 'conditional'] as AddOrderKind[]).map(k => (
                <button
                  key={k}
                  type="button"
                  data-testid={`add-sizing-order-kind-${k}`}
                  aria-pressed={orderKind === k}
                  title={ORDER_KIND_TITLE[k]}
                  onClick={() => pickOrderKind(k)}
                  className={`rounded px-2 py-0.5 transition-colors ${orderKind === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {ORDER_KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <div data-testid="add-sizing-fill-price" className="font-mono tabular-nums text-muted-foreground">
              <span>{orderKind === 'conditional'
                ? `触发价 S₂ ${fmtPx(limitPx)}`
                : s2Locked ? `手填 S₂ ${fmtPx(s2Ref)}（已锁定，不跟盘面）` : `现价 S₂ ${fmtPx(s2Ref)}`}</span>
              <span className="mx-1.5">→</span>
              <span className="text-foreground">预计成交 S₂′ {fmtPx(s2Shown)}</span>
              <span> {orderKind === 'limit'
                ? `（限价 · 不计滑点${limitRounded ? ` · 挂单价按 ${priceDecimals} 位小数向${side === 'LONG' ? '下' : '上'}取整` : ''}）`
                : orderKind === 'conditional'
                  ? `(${fmtSlipPct(slippagePct)} · 触发后市价${limitRounded ? ` · 触发价按 ${priceDecimals} 位小数向${side === 'LONG' ? '下' : '上'}取整` : ''})`
                  : `(${fmtSlipPct(slippagePct)})`}</span>
            </div>
            {/* 把整张的上限直接交给下单面板：不再手抄币数、再让面板按另一个价折一次张。 */}
            {placeable && (
              <button
                type="button"
                data-testid="add-sizing-place-at-limit"
                onClick={placeAtLimit}
                title={`按${tierBinds ? '分层余量（比 Plan B 上限小）' : ' Plan B 上限'}预填下单面板：${orderKindTitle} · ${side === 'LONG' ? '开多' : '开空'}`}
                className="ml-auto h-6 rounded border border-primary/40 bg-primary/10 px-2 font-medium text-primary transition-colors hover:bg-primary/20"
              >
                按上限下单 · {placeAtLimitQty}
              </button>
            )}
          </div>
          {tierRoomText && (
            <div
              data-testid="add-sizing-tier-cap"
              data-binds={tierBinds ? 'tier' : 'plan-b'}
              data-hedge={tierHedgeState}
              className={`text-[10px] ${tierBinds ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
            >
              {tierRoomText}
            </div>
          )}
          {lotAddText && (
            <div data-testid="add-sizing-lot-size" className="text-[10px] text-amber-600 dark:text-amber-400">
              {lotAddText}
            </div>
          )}
          {lotHedgeText && (
            <div data-testid="add-sizing-hedge-lot-size" className="text-[10px] text-amber-600 dark:text-amber-400">
              {lotHedgeText}
            </div>
          )}
          {autoLimit && orderKind === 'limit' && (
            <div data-testid="add-sizing-s2-limit-note" className="text-[10px] text-amber-600 dark:text-amber-400">
              手填 S₂ 只能按限价或条件单成交，已切到限价 @S₂；点复位回到市价
              <button type="button" data-testid="add-sizing-s2-to-conditional" onClick={() => pickOrderKind('conditional')}
                className="ml-1.5 underline hover:no-underline">突破加仓改按条件单</button>
            </div>
          )}
          {conditionalAtBase && (
            <div data-testid="add-sizing-conditional-at-base" className="text-[10px] text-amber-600 dark:text-amber-400">
              条件单的触发价要离现价至少一格（等于现价会被当成立即成交的单拒掉）——在 S₂ 填入触发价
            </div>
          )}
          {/* 敏感度：币数上限的弹性是 S₂′/|S₂′−S₁|，张数 / 名义上限是 S₁/|S₂′−S₁|（多头少 1、空头多 1）。
              币本位按张下单、Legs 校验的超限幅度跟张数走，所以倍数写张数那一个；U 本位按币下单，写币数那一个。 */}
          {fillPlan && fillPlan.addCoinsMax > 0 && (
            <div data-testid="add-sizing-sensitivity" className="text-[10px] text-muted-foreground">
              成交每不利 0.1%，上限少约 {fmtCoins(fillPlan.sensitivityCoinsPer0_1Pct)} {coinName}
              {isCoin && fillPlan.sensitivityContractsPer0_1Pct != null ? `（${fillPlan.sensitivityContractsPer0_1Pct.toLocaleString('en-US')} 张）` : ''}
              {' '}· {isCoin
                ? `张数上限随成交价变化的倍数 ≈ S₁/(S₂′−S₁) = ${fillPlan.contractElasticity.toFixed(1)}×`
                : `上限随成交价变化的倍数 ≈ S₂′/(S₂′−S₁) = ${fillPlan.coinElasticity.toFixed(1)}×`}
            </div>
          )}

          {/* 盘口上真实挂着的对冲线。只摆候选、不预填也不锁定 S₁——
              系统分不出「对冲单」与「试单 / 上一场遗留单」的意图。 */}
          {(hedgeRead.candidates.length > 0 || hedgeRead.unlineable.length > 0) && (
            <div data-testid="add-sizing-book-lines" className="flex flex-wrap items-center gap-1 text-[10px]">
              <span className="text-muted-foreground/70">盘口对冲线</span>
              {hedgeRead.candidates.map(c => (
                <button
                  key={c.id}
                  type="button"
                  data-testid="add-sizing-book-line"
                  onClick={() => setS1(tidyPx(c.price))}
                  title="填入 S₁"
                  className={`rounded border px-1.5 py-0.5 font-mono transition-colors ${
                    sameLine(c.price, toNum(s1))
                      ? 'border-trading-green/50 bg-trading-green/10 text-trading-green'
                      : 'border-border text-foreground/80 hover:bg-accent'
                  }`}
                >
                  {fmtPx(c.price)} · {fmtCoins(c.coins)} {coinName}
                </button>
              ))}
              {hedgeRead.candidates.length > 1 && (
                <span className="text-muted-foreground/60">
                  {hedgeRead.candidates.length} 条线 · 偏差按亏损侧离 S₂ 最近的那条计（与 Legs 校验同规则）
                </span>
              )}
              {hedgeRead.unlineable.length > 0 && (
                <span className="text-muted-foreground/60">
                  {hedgeRead.unlineable.length} 张无固定线（跟踪 / TWAP），未计入
                </span>
              )}
              {hedgeRead.staleCount > 0 && (
                <span className="text-muted-foreground/60">{hedgeRead.staleCount} 张早于本场，已排除</span>
              )}
            </div>
          )}

          {/* S₁ 与盘口线不一致：不报价差（0.15% 看着就该被忽略），报**钱**。 */}
          {s1Deviation && (
            <div data-testid="add-sizing-s1-deviation"
              className="rounded border border-trading-red/40 bg-trading-red/5 px-2 py-1.5 text-[10px] leading-[1.6] text-trading-red">
              S₁ {fmtPx(s1Deviation.typedS1)} 与盘口对冲线 {fmtPx(s1Deviation.bookPrice)} 不是同一条线 ——
              加仓{s1Deviation.excessCoins > 0 ? '多' : '少'}下 {fmtCoins(Math.abs(s1Deviation.excessCoins))} {coinName}
              （应 {fmtCoins(s1Deviation.shouldAdd)}）；价格走到 {fmtPx(s1Deviation.bookPrice)} 时账面
              <span className="font-medium"> {fmtUsd(s1Deviation.netAtBookLine)} USD</span>
              {s1Deviation.bookAvailableUsd > 0
                ? '，锁死本应是 0。'
                : `——按盘口线没有加仓额度，一币不加走到线上也已是 ${fmtUsd(s1Deviation.bookAvailableUsd)} USD。`}
              <button type="button" data-testid="add-sizing-use-book-line"
                onClick={() => setS1(tidyPx(s1Deviation.bookPrice))}
                className="ml-1 underline hover:no-underline">按盘口重算</button>
            </div>
          )}

          <PriceLadder side={side} sBar={toNum(sBar)} s1={toNum(s1)} s2={s2Eff} s2Label={taker ? 'S₂′' : 'S₂'} />

          {/* Plan A：G = 0 时它就是 Plan B 的上限（主角）；G ≠ 0 时只作来源拆解，不给可下单的大字。 */}
          <section data-testid="add-sizing-cushion" className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[11px] font-medium text-foreground">Plan A · 旧仓浮盈垫</h3>
              <span className="text-[10px] text-muted-foreground">{bankedOn ? '来源拆解 · 不单独下单' : 'G = 0 时即 Plan B 上限'}</span>
              {!bankedOn && !cushion.ok && (
                <span
                  data-testid="add-sizing-cushion-problem"
                  className={`ml-auto truncate rounded border px-1.5 py-0.5 text-[10px] ${
                    note.violation
                      ? 'border-trading-red/40 bg-trading-red/10 text-trading-red'
                      : 'border-dashed border-border text-muted-foreground'
                  }`}
                >
                  {note.text}
                </span>
              )}
            </div>
            {!bankedOn && cushion.ok && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {/* G = 0 时 Plan A 就是 Plan B：大字与对冲读同一个可下单量（fillPlan 的上限，再按分层封顶），与按钮一致 */}
                  <Hero testId="add-sizing-x2" label={tierBinds ? '加仓上限 X₂ · 分层封顶' : '加仓上限 X₂'}
                    value={fmtCoins(planAX2)} unit={coinName}
                    sub={`${fmtUsd(planAX2 * s2Eff)} USD${limitContractsText ?? addContracts(planAX2, s2Eff)}`}
                    tone="primary" />
                  <Hero testId="add-sizing-hedge"
                    label={`对冲 @ S₁ · ${side === 'LONG' ? '空' : '多'}`}
                    value={fmtCoins(planAHedge)} unit={coinName}
                    sub={`${fmtUsd(planAHedge * toNum(s1))} USD${contracts(planAHedge, toNum(s1))}`} />
                </div>
                <Chips items={[
                  ['浮盈垫 Y₁', `${fmtUsd(cushion.cushion)} USD ÷ 险 ${fmtPx(cushion.riskDistance)}`],
                  ['b', cushion.b.toFixed(4)],
                  ['新腿占比', fmtPct(cushion.p0)],
                  ['加仓后均价', fmtPx(cushion.blendedCostAfter)],
                ]} />
              </>
            )}
            {/* G ≠ 0：中性芯片，带符号的 Y₁ 以结算单位写出（与 G 同单位才能相加），不标红。
                A 的合计对冲 X₁ + X₂ᴬ 仍要给出（含张数）——用户要拿它与 Plan B 的合计并排比较；
                它只在 A 有解时才成立（Y₁ ≤ 0 时 X₂ᴬ 为负，X₁ + X₂ᴬ 不是一个对冲量）。 */}
            {bankedOn && planB && (
              <Chips items={[
                ['旧仓净垫 Y₁', `${signed(planB.cushion, v => fmtG(v))}${isCoin ? `（${signed(planB.cushion * toNum(s1), fmtUsd)} USD）` : ''}`, false, 'add-sizing-cushion-y1'],
                ['X₂ᴬ = Y₁ ÷ 险 · 仅 A', `${fmtCoins(planB.cushionAddCoins)} ${coinName}`, false, 'add-sizing-x2'],
                ...(cushion.ok
                  ? [
                    ['b', cushion.b.toFixed(4)] as const,
                    [
                      `合计对冲 @ S₁ · ${side === 'LONG' ? '空' : '多'} · 仅 A`,
                      `${fmtCoins(cushion.hedgeCoinsAtS1)} ${coinName} · X₁ + X₂ᴬ · ${fmtUsd(cushion.hedgeNotionalAtS1)} USD${contracts(cushion.hedgeCoinsAtS1, toNum(s1))}`,
                      false,
                      'add-sizing-hedge-a',
                    ] as const,
                  ]
                  : []),
              ] as Array<readonly [string, string, boolean?, string?]>} />
            )}
          </section>

          {/* Plan B：G ≠ 0 时真正用于下单的统一口径。 */}
          <section data-testid="add-sizing-banked" className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <h3 className="text-[11px] font-medium text-foreground">Plan B · 浮盈垫 + 落袋净额</h3>
              <span className="text-[10px] text-muted-foreground">上限 = max(0, Y₁ + G) ÷ 每币风险</span>
              {!bankedOn && (
                <span data-testid="add-sizing-banked-off" className="ml-auto text-[10px] text-muted-foreground">G = 0：Plan B 与 Plan A 同值</span>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5">
              <div className="w-[116px]"><Field label={`G 落袋净额 ${gUnit}`} value={g} onChange={editG} testId="add-sizing-g" /></div>
              {hasBankedSignal && Number.isFinite(bankedSuggest) && (
                <button
                  type="button"
                  data-testid="add-sizing-fill-banked"
                  onClick={() => editG(tidyG(bankedSuggest))}
                  title={bankedMaybeSpent
                    ? `落袋后已有 ${banked.addsSinceBanked} 笔加仓：仍持有的浮亏已通过当前 X₁ / S̄ 重算，已实现亏损也已从建议 G 扣除。`
                    : '止盈1 利润 − 本轮已实现亏损（含强平）'}
                  className={`h-7 rounded border px-2 font-mono text-[10px] transition-colors ${
                    bankedSuggest < 0
                      ? 'border-trading-red/50 bg-trading-red/5 text-trading-red hover:bg-trading-red/10'
                      : bankedMaybeSpent
                        ? 'border-amber-500/50 bg-amber-500/5 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'
                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  本场可用 G {signed(bankedSuggest, v => (isCoin ? fmtCoins(v, 4) : fmtUsd(v)))}（{banked.count} 笔止盈）
                </button>
              )}
              {gPositive && (
                <>
                  <div className="flex h-7 items-center gap-0.5 rounded bg-secondary p-0.5">
                    {(['line', 'size'] as BankedKnob['kind'][]).map(k => (
                      <button
                        key={k}
                        type="button"
                        data-testid={`add-sizing-knob-${k}`}
                        onClick={() => setKnobKind(k)}
                        className={`rounded px-2 py-0.5 text-[10px] transition-colors ${knobKind === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {k === 'line' ? '定线' : '定仓'}
                      </button>
                    ))}
                  </div>
                  <div className="w-[116px]">
                    {knobKind === 'line'
                      ? <Field label="K_B 零风险线" value={kB} onChange={setKB} testId="add-sizing-kb" placeholder={s1 || 'S₁'} onReset={() => setKB('')} accent />
                      : <Field label={`X₂ᴮ ${coinName}`} value={x2B} onChange={setX2B} testId="add-sizing-x2b" accent />}
                  </div>
                </>
              )}
              {bankedProblem && (
                <span data-testid="add-sizing-banked-problem" className="mb-1 text-[10px] text-muted-foreground">
                  {bankedProblem}
                </span>
              )}
            </div>
            {gChangedFrom != null && (
              <div data-testid="add-sizing-g-refreshed" className="text-[10px] text-amber-600 dark:text-amber-400">
                G 已按本场落袋重填为 {g}（上次计划里是 {isCoin ? fmtCoins(gChangedFrom, 4) : fmtUsd(gChangedFrom)}），上限随之重算
              </div>
            )}
            {/* 按操作时间排除的止盈单独占一行：放进上面那排控件里会把定线 / 定仓挤到下一行。
                排除的既有「操作时间早于当前持仓开仓」的，也有根本没有操作时间的（6 月以前的老记录）。 */}
            {banked.excludedByOperationTime > 0 && (
              <div data-testid="add-sizing-banked-excluded" className="text-[10px] text-muted-foreground/60">
                {banked.excludedByOperationTime} 笔止盈的操作时间早于当前持仓开仓（或缺失），未计入
              </div>
            )}
            {bankedMaybeSpent && (
              <div
                data-testid="add-sizing-banked-spent"
                className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-4 text-amber-600 dark:text-amber-400"
              >
                落袋之后已经开过 <strong>{banked.addsSinceBanked}</strong> 笔仓：仍持有部分已经进入当前 X₁ / S̄，
                它们在 S₁ 的浮盈或浮亏会随本次 Plan B <strong>重新计算</strong>；已经实现的亏损也已从上面的建议 G 扣除。
              </div>
            )}
            {bankedOn && planB && !planBHasRoom && (
              <div
                data-testid="add-sizing-banked-no-room"
                className="rounded border border-trading-red/40 bg-trading-red/5 px-2 py-1.5 text-[10px] leading-4 text-trading-red"
              >
                <strong>Plan B 没有加仓额度</strong>：旧仓退回 S₁ 的净浮盈 Y₁ {signed(planB.cushion, fmtG)}
                {' '}+ 落袋净额 G {signed(planB.banked, fmtG)} = {signed(planB.available, fmtG)} ≤ 0。
                不要把 X_G 单独当作可下单量。
              </div>
            )}
            {bankedOn && planB && planBHasRoom && (
              <>
                {/* 上限只由规则决定；旋钮推出的量另起一格叫「计划加仓」，由 R0 与上限比对。 */}
                <div className="grid grid-cols-2 gap-2">
                  <Hero
                    testId="add-sizing-total-add"
                    label={tierBinds ? 'Plan B 加仓上限 · 分层封顶' : 'Plan B 加仓上限'}
                    value={fmtCoins(offeredCoins)}
                    unit={coinName}
                    sub={`${tierBinds ? `Plan B ${fmtCoins(limitCoins)} · ` : ''}旧仓垫 ${fmtCoins(planB.cushionAddCoins)} + 落袋垫 ${fmtCoins(planB.bankedAddCoins)}${limitContractsText ?? addContracts(offeredCoins, s2Eff)}`}
                    tone="primary"
                  />
                  <Hero
                    testId="add-sizing-total-hedge-hero"
                    label={`合计对冲 @ S₁ · ${side === 'LONG' ? '空' : '多'}`}
                    value={fmtCoins(hedgeCoinsAtS1)}
                    unit={coinName}
                    sub={`X₁ + ${knobActive ? '计划加仓' : 'Plan B 加仓'}${hedgeRead.filledHedgeCoins > 0 || bookLine
                      ? ` · 已挂 ${fmtCoins((bookLine?.coins ?? 0) + hedgeRead.filledHedgeCoins)}`
                      : ''}${contracts(hedgeCoinsAtS1, toNum(s1))}`}
                    tone="primary"
                  />
                </div>
                {knobActive && bankedRes.ok && plannedAddCoins > 0 && (
                  <Hero
                    testId="add-sizing-planned-add"
                    label={`计划加仓 · ${knobKind === 'line' ? `K_B ${fmtPx(bankedRes.kB)}` : `X₂ᴮ ${fmtCoins(bankedRes.x2)}`} 推出`}
                    value={fmtCoins(plannedAddCoins)}
                    unit={coinName}
                    sub={plannedAddCoins > limitCoins * (1 + 1e-9)
                      ? `超出上限 ${fmtCoins(plannedAddCoins - limitCoins)} ${coinName}——见 R0`
                      : `上限的 ${fmtPct(plannedAddCoins / limitCoins)}${tierBinds && plannedAddCoins >= tierCoins * (1 - 1e-9) ? ' · 已按分层封顶' : ''}`}
                    tone={plannedAddCoins > limitCoins * (1 + 1e-9) ? 'danger' : undefined}
                  />
                )}
                {knobActive && bankedRes.ok && !(plannedAddCoins > 0) && (
                  <div
                    data-testid="add-sizing-planned-no-room"
                    className="rounded border border-trading-red/40 bg-trading-red/5 px-2 py-1.5 text-[10px] leading-4 text-trading-red"
                  >
                    当前 K_B / 定仓值折出的 B 腿太小，尚未补完旧仓缺口：计划加仓为 0。上限仍是上面那个数。
                  </div>
                )}
                {gPositive && bankedRes.ok && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {/* X_G 只是拆解：它不含旧仓垫（可为负），单独照它下单会漏掉旧仓缺口。所以不给张数、不叫零风险。 */}
                      <Hero testId="add-sizing-x2b-out" label="B 腿 X_G · 仅拆解" value={fmtCoins(bankedRes.x2)} unit={coinName}
                        sub={`${fmtUsd(bankedRes.x2Notional)} USD · 不可单独下单`} />
                      <Hero testId="add-sizing-kb-out" label="K_B 零风险线" value={fmtPx(bankedRes.kB)}
                        sub={Math.abs(bankedRes.exposureAtS1 - 1) <= 1e-9
                          ? '= S₁ · 在 S₁ 恰好花完 G'
                          : bankedRes.exposureAtS1 > 1
                            ? '未到 S₁ · 在 S₁ 超支落袋'
                            : '已越过 S₁ · 在 S₁ 只花一部分 G'} />
                    </div>
                    <Chips items={[
                      ['S₁ 处吃掉', `${isCoin ? fmtCoins(bankedRes.consumedAtS1, 4) : fmtUsd(bankedRes.consumedAtS1)} · 敞口 ${fmtPct(bankedRes.exposureAtS1)}`, bankedRes.exposureAtS1 > 1 + 1e-9],
                      ['剩余', isCoin ? fmtCoins(bankedRes.residualAtS1, 4) : fmtUsd(bankedRes.residualAtS1)],
                      ['合计对冲 @ S₁', `${fmtCoins(hedgeCoinsAtS1)} ${coinName} · X₁ + ${knobActive ? '计划加仓' : 'Plan B 加仓'}`, false, 'add-sizing-total-hedge'],
                    ] as Array<readonly [string, string, boolean?, string?]>} />
                  </>
                )}
              </>
            )}
          </section>

          {/* R0 复核 —— 不做硬拦截（B 的定义允许成本线越过 S₁），但缺口必须扎眼；两套算法对不上时连结论都不给 */}
          {r0 && (
            <section
              data-testid="add-sizing-r0"
              className={`space-y-1 rounded border px-3 py-2 ${
                r0.verdict !== 'pass'
                  ? 'border-trading-red/50 bg-trading-red/10'
                  : 'border-border bg-muted/30'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <h3 className={`text-[11px] font-medium ${r0.verdict !== 'pass' ? 'text-trading-red' : 'text-foreground'}`}>
                  R0 复核 · 加仓后成本线
                </h3>
                <span className="font-mono text-[11px] text-foreground">{fmtPx(r0.costLine.blendedCost)}</span>
                <span className="text-[10px] text-muted-foreground">
                  {r0.costLine.pastStop && r0.overshootPct >= 0.01
                    ? `越过 S₁ ${r0.overshootPct.toFixed(2)}%${gPositive && r0.verdict === 'pass' ? '（由已落袋 G 覆盖）' : ''}`
                    : '落在 S₁ 安全侧'}
                </span>
              </div>
              {/* 三条路线的读数并排摆出：垫子式与成本线式各自的缺口，逐笔重算的 X₁′ / Y₁′——对得上才有资格说通过 */}
              <div data-testid="add-sizing-r0-routes" className="font-mono text-[10px] text-muted-foreground">
                垫子式 缺口 {fmtG(r0.ledger.shortfall)} · 成本线式 缺口 {fmtG(r0.costLine.shortfall)} · 逐笔{' '}
                {r0.fills
                  ? `X₁′ ${fmtCoins(r0.fills.x1, 4)} / Y₁′ ${signed(r0.fills.cushion, fmtG)}${r0.fills.agrees ? ' 一致' : ' 不符'}`
                  : '—'}
              </div>
              {r0.verdict === 'mismatch' ? (
                <div data-testid="add-sizing-r0-mismatch" className="text-[10px] leading-[1.7] text-trading-red">
                  <strong>自检不一致：</strong>
                  {r0.disagrees.includes('cost_line') && (
                    <>垫子式缺口 {fmtG(r0.ledger.shortfall)} 与成本线式缺口 {fmtG(r0.costLine.shortfall)} 对不上（差 {fmtG(Math.abs(r0.ledger.gap - r0.costLine.gap))}）；</>
                  )}
                  {r0.disagrees.includes('fills') && r0.fills && (
                    <>手填 X₁ {fmtCoins(toNum(x1), 4)} / S̄ {fmtPx(toNum(sBar))} 算得 Y₁ {signed(r0.ledger.cushion, fmtG)}，
                    与当前持仓逐笔重算不符（X₁′ {fmtCoins(r0.fills.x1, 4)} / Y₁′ {signed(r0.fills.cushion, fmtG)}）
                    {r0.fillsFarOff ? '——X₁ / S̄ 可能取自别的腿集' : ''}；</>
                  )}
                  本次复核不给结论。复位 X₁ / S̄、核对单位与方向后再看。
                </div>
              ) : r0.verdict === 'violation' ? (
                <div data-testid="add-sizing-r0-violation" className="text-[10px] leading-[1.7] text-trading-red">
                  <strong>R0 非法：跌到 S₁ 的亏损 {fmtG(r0.ledger.loss)} 超出旧仓净垫 Y₁ + 落袋 G（{signed(r0.ledger.available, fmtG)}）{fmtG(r0.shortfall)}，
                  这个缺口由本金支付</strong>——计划加仓比 Plan B 上限多 {fmtCoins(r0.excessCoins)} {coinName}，
                  亏损是可用垫的 {r0.ledger.available > 0 ? `${((r0.ledger.loss / r0.ledger.available) * 100).toFixed(0)}%` : '∞（可用垫 ≤ 0）'}。
                  同一笔已实现利润只能买一次期权；要么把量压回上限，要么接受这不再是「锁死」而是加风险。
                </div>
              ) : (
                <div data-testid="add-sizing-r0-pass" className="text-[10px] leading-[1.7] text-muted-foreground">
                  {bankedOn
                    ? `跌到 S₁：旧仓净垫 Y₁ + 落袋 G 覆盖本次加仓${r0.residual > 0 ? `，仍剩 ${fmtG(r0.residual)}` : '，恰好用完'}——通过。`
                    : '跌到 S₁：旧仓浮盈垫覆盖本次加仓——通过。'}
                  {r0.fills ? '两种算法一致，逐笔重算相符。' : '两种算法一致；这一侧没有持仓腿，未做逐笔核对。'}
                </div>
              )}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 价格阶梯：三个价格齐了就画，**不看有没有解**。
 * 方向反了的那一段标红——「S₁ 还在成本线亏损侧」于是一眼可见，而不是只剩一句灰字。
 */
function PriceLadder({ side, sBar, s1, s2, s2Label = 'S₂' }: { side: AddSide; sBar: number; s1: number; s2: number; s2Label?: string }) {
  const ok = [sBar, s1, s2].every(v => Number.isFinite(v) && v > 0);
  const lo = ok ? Math.min(sBar, s1, s2) : 0;
  const hi = ok ? Math.max(sBar, s1, s2) : 0;
  const span = hi - lo;
  // 三个价格没齐、或三点重合时不占位——留一块空白比什么都不放更糟
  if (!ok || !(span > 0)) return null;

  const d = side === 'SHORT' ? -1 : 1;
  const pos = (p: number) => ((d > 0 ? p - lo : hi - p) / span) * 100;
  const pB = pos(sBar);
  const p1 = pos(s1);
  const p2 = pos(s2);
  const mid = (a: number, b: number) => (a + b) / 2;
  const seg = (a: number, b: number) => ({ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` });
  const cushionOk = (s1 - sBar) * d > 0;
  const riskOk = (s2 - s1) * d > 0;

  return (
    // 左右留 14px：两端刻度用 -translate-x-1/2 居中，贴边会被裁掉一半
    <div className="px-3.5" data-testid="add-sizing-ladder">
      <div className="relative h-[40px]">
        <div className="absolute inset-x-0 top-[10px] h-[3px] rounded-full bg-muted" />
        <div className={`absolute top-[10px] h-[3px] rounded-full ${cushionOk ? 'bg-trading-green/55' : 'bg-trading-red/55'}`} style={seg(pB, p1)} />
        <div className={`absolute top-[10px] h-[3px] rounded-full ${riskOk ? 'bg-primary/55' : 'bg-trading-red/55'}`} style={seg(p1, p2)} />
        {([['S̄', pB, false], ['S₁', p1, true], [s2Label, p2, false]] as const).map(([label, p, accent]) => (
          <div key={label} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${p}%` }}>
            <div className={`mx-auto h-[7px] w-[2px] rounded-full ${accent ? 'bg-foreground' : 'bg-muted-foreground/50'}`} />
            <div className={`mt-[7px] text-[9px] leading-none ${accent ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</div>
          </div>
        ))}
        {/* 距离标注落在各自线段的中点下方，而不是挤在两端 */}
        {([
          ['垫', Math.abs(s1 - sBar), mid(pB, p1), cushionOk],
          ['险', Math.abs(s2 - s1), mid(p1, p2), riskOk],
        ] as const).map(([tag, dist, at, good]) => (
          <div
            key={tag}
            className={`absolute top-[27px] -translate-x-1/2 whitespace-nowrap font-mono text-[9px] ${good ? 'text-muted-foreground' : 'text-trading-red'}`}
            style={{ left: `${at}%` }}
          >
            {good ? '' : '反向 '}{tag} {fmtPx(dist)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Hero({ label, value, unit, sub, tone, testId }: {
  label: string; value: string; unit?: string; sub?: string; tone?: 'primary' | 'danger'; testId: string;
}) {
  return (
    <div data-testid={testId} className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[18px] font-semibold leading-tight tabular-nums ${
        tone === 'primary' ? 'text-primary' : tone === 'danger' ? 'text-trading-red' : 'text-foreground'
      }`}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Chips({ items }: { items: Array<readonly [string, string, boolean?, string?]> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([label, value, warn, testId]) => (
        <div key={label} data-testid={testId} className="text-[10px] leading-tight">
          <span className="text-muted-foreground">{label} </span>
          <span className={`font-mono tabular-nums ${warn ? 'text-trading-red' : 'text-foreground'}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, testId, onReset, accent, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; testId: string;
  onReset?: () => void; accent?: boolean; placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
        <span className="truncate">{label}</span>
        {onReset && (
          <button type="button" aria-label={`${label} 复位`} onClick={onReset}
            className="ml-auto shrink-0 rounded opacity-40 transition-opacity hover:opacity-100">
            <RotateCcw className="h-2.5 w-2.5" />
          </button>
        )}
      </span>
      <input
        data-testid={testId}
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`mt-0.5 h-7 w-full rounded border bg-secondary px-1.5 font-mono text-[11px] tabular-nums text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40 ${
          accent ? 'border-primary/40' : 'border-border'
        }`}
      />
    </label>
  );
}
