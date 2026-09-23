import { useState, useRef, useEffect, useMemo } from 'react';
import type { OrderSide, OrderType, Position } from '@/types/trading';
import { ORDER_TYPE_INFO, calcLiquidationPrice, calcSlippage, calcUnrealizedPnl } from '@/types/trading';
import { positionMaintenanceMarginUsd } from '@/lib/positionRiskModel';
import { consumeAddSizingPrefill, peekAddSizingSnapshotForOrder, useAddSizingPrefill } from '@/lib/addSizingPlan';
import { roundLimitPriceFavorable } from '@/lib/addSizing';
import { ChevronDown, Check, AlertTriangle, Crosshair, ArrowLeftRight, Calculator, Gauge, Info, MoreHorizontal } from 'lucide-react';
import { TradingPreferencesDrawer } from '@/components/TradingPreferencesDrawer';
import { useNotificationCenter } from '@/lib/notificationCenter';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  DEFAULT_TRADING_PREFERENCES,
  clampPrefLeverage,
  type TradingPreferences,
  type PanelKey,
} from '@/lib/tradingPreferences';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { PlaceOrderParams } from '@/contexts/TradingContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { formatAmount, formatPrice, formatUSDT } from '@/lib/formatters';
import { LeverageModal } from '@/components/LeverageModal';
import { toast } from '@/lib/notificationCenter';
import { PreTradeSnapshotDialog } from '@/components/journal/PreTradeSnapshotDialog';
import {
  coinContractsExact,
  coinContractsExactFromUsdNotional,
  coinMarginAmount,
  coinNotionalUsd,
  formatCoinAmount,
  getCoinMarginedContractSizeUsd,
  getSettlementAsset,
} from '@/lib/coinMargined';
import { orderPriceKindLabel, panelReferencePrice } from '@/lib/orderReferencePrice';
import {
  LIVE_PRICE_TIER_HEADROOM,
  checkPlacementPositionLimit,
  clampLeverageAcrossSettlements,
  isTriggerRecheckedOrder,
  limitSettlementOf,
  newlyDoomedTriggerOrders,
  orderWaypointPrice,
  placementAftermath,
  placementCheckPrice,
  placementFloatsWithMark,
  placementOrderValuation,
  placementSizingRemainingUsd,
  placementUnitPriceUsd,
  placementUsesLegacyHedge,
  triggerRiskMessage,
} from '@/lib/positionLimit';
import { isPositionOpen, mergeFilledPosition } from '@/lib/tradingSettlement';
import { isLegacyHedgeRisk, isTieredRiskPosition, legacyHedgeRiskStamp, positionRiskStamp } from '@/lib/positionRiskModel';
import { formatTierAmount } from '@/lib/leverageTiers';
import { noticeLeverageClamp } from '@/lib/leverageClampNotice';
import { LeverageTierTable } from '@/components/LeverageTierTable';
import { lotSizeCapLabel, placementLotSize } from '@/lib/marketLotSize';

// Re-export for convenience
export type { PlaceOrderParams };

// === Selector types (kept for compatibility) ===
export type PriceSelection = 'MARKET' | 'LIMIT' | 'BEST';
export type TriggerType = 'MARK' | 'LAST';
export type CurrencyUnit = 'BASE' | 'USDT';
export type UsdtInputMode = 'ORDER_VALUE' | 'INITIAL_MARGIN';
type CoinInputUnit = 'CONTRACTS' | 'COIN_NOTIONAL' | 'COIN_MARGIN';
export type ActionMode = 'OPEN' | 'CLOSE';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

interface Props {
  currentPrice: number;
  disabled: boolean;
  symbol: string;
  onPlaceOrder: (order: PlaceOrderParams) => void | { id: string } | null | Promise<{ id: string } | null | void>;
  coolingOff?: boolean;
  coolingOffLabel?: string;
  onOpenCoolingOff?: () => void;
  priceProtection?: boolean;
  onTogglePriceProtection?: () => void;
  pricePrecision?: number;
  quantityPrecision?: number;
  crosshairPrice?: number | null;
  pickMode?: boolean;
  onPickModeChange?: (active: boolean) => void;
  pickedPrice?: number | null;
  /** Optional: pause the time machine when the snapshot dialog opens */
  onAutoPauseTimeMachine?: () => void;
  /** 面板显隐：真值在交易页，抽屉只是它的一个入口 */
  panels?: Record<PanelKey, boolean>;
  onPanelChange?: (key: PanelKey, visible: boolean) => void;
}

// Order types shown in the horizontal tab strip (top 3 + dropdown for the rest)
const PRIMARY_ORDER_TABS: { value: OrderType; label: string }[] = [
  { value: 'LIMIT', label: '限价' },
  { value: 'MARKET', label: '市价' },
];

/**
 * 高级类型槽（第三常驻位）的候选——与币安的下拉一致：
 * 条件委托 / 跟踪委托 / 只做Maker (Post Only) / TWAP / 分段订单。
 * 止盈止损不占标签位：币安把 TP/SL 做成限价/市价表单里的勾选项（本面板已有）。
 * 勾选**不改变订单类型**——保护价随单带着、成交时才兑现成减仓单；
 * LIMIT_TP_SL / MARKET_TP_SL 只剩历史遗留单还是这两个类型，面板不再产生它们。
 */
const ADVANCED_ORDER_TYPES: { value: OrderType; label: string; hint: string }[] = [
  { value: 'CONDITIONAL', label: '条件委托', hint: '价格触及触发价后，按市价成交。' },
  { value: 'TRAILING_STOP', label: '跟踪委托', hint: '价格从极值回调指定比例后，按市价成交；可设激活价。' },
  { value: 'POST_ONLY', label: '只做Maker (Post Only)', hint: '只挂单不吃单：若会立即成交则撤单。' },
  { value: 'TWAP', label: 'TWAP', hint: '在总时长内按时间均匀分批市价买入 / 卖出，摊薄冲击成本。' },
  { value: 'SCALED', label: '分段订单', hint: '在价格区间内均匀铺多张限价单。' },
];

export function OrderPanel({
  currentPrice, onPlaceOrder, disabled, symbol,
  coolingOff, coolingOffLabel, onOpenCoolingOff,
  priceProtection, onTogglePriceProtection,
  pricePrecision = 2, quantityPrecision = 3,
  crosshairPrice, pickMode, onPickModeChange, pickedPrice,
  onAutoPauseTimeMachine,
  panels, onPanelChange,
}: Props) {
  // ===== Live account info pulled from context (for available balance + risk panel) =====
  const ctx = useTradingContext();
  const settlementMode = ctx.getSymbolSettlementMode(symbol);
  const isCoinMargined = settlementMode === 'coin';
  const baseCoin = getSettlementAsset(symbol);
  const contractSizeUsd = getCoinMarginedContractSizeUsd(symbol);
  const quoteUnitLabel = isCoinMargined ? 'USD' : 'USDT';
  const positions = ctx.positionsMap[symbol] || [];

  let totalMargin = 0;
  let totalMaintenance = 0;
  let totalPnl = 0;
  for (const [posSymbol, ps] of Object.entries(ctx.positionsMap) as [string, typeof positions][]) {
    for (const p of ps) {
      const mark = ctx.priceMap[posSymbol] ?? p.entryPrice;
      totalMargin += p.margin;
      totalMaintenance += positionMaintenanceMarginUsd(posSymbol, p, mark);
      totalPnl += calcUnrealizedPnl(p, mark);
    }
  }
  const equity = ctx.balance + totalPnl;
  const available = ctx.balance - totalMargin;
  const marginRatio = equity > 0 ? (totalMaintenance / equity) * 100 : 0;
  const ratioColor = marginRatio > 80 ? 'text-trading-red' : marginRatio > 50 ? 'text-yellow-400' : 'text-trading-green';
  const ratioBg = marginRatio > 80 ? 'bg-red-400' : marginRatio > 50 ? 'bg-yellow-400' : 'bg-emerald-400';

  // ===== Top-level state =====
  const [actionMode, setActionMode] = useState<ActionMode>('OPEN');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const marginMode = ctx.getSymbolMarginMode(symbol);
  const leverage = ctx.getSymbolLeverage(symbol);
  const setLeverage = (v: number | ((prev: number) => number)) => ctx.setSymbolLeverage(symbol, v);

  // ===== Existing selectors / payload state =====
  const [priceSelection, setPriceSelection] = useState<PriceSelection>('LIMIT');
  const [triggerType, setTriggerType] = useState<TriggerType>('LAST');
  // 数量单位默认落在「保证金资产 · 订单金额」这张卡：
  //   币本位 → 该币的订单金额（如 BANANAS31）
  //   U 本位 → USDT 订单金额
  // 两种结算方式都以「订单金额」起手，量纲与该模式的保证金资产一致；
  // 「张」与「初始保证金」留给需要时手动切换。
  const [currencyUnit, setCurrencyUnit] = useState<CurrencyUnit>('USDT');
  const [usdtInputMode, setUsdtInputMode] = useState<UsdtInputMode>('ORDER_VALUE');
  const [tif, setTif] = useState<TimeInForce>('GTC');

  const [showCurrencySelector, setShowCurrencySelector] = useState(false);
  const [showOrderTypeMenu, setShowOrderTypeMenu] = useState(false);
  const [showTifMenu, setShowTifMenu] = useState(false);
  const orderTypeMenuRef = useRef<HTMLDivElement>(null);
  const tifMenuRef = useRef<HTMLDivElement>(null);

  // Inputs
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  /**
   * 币本位的**张数锁**。张数只在「输入变动的时刻」由当时的价格折算一次，
   * 此后价格跳动不得重算——两张相隔 7 秒的截图钉死过反例：
   * 吸附把框停在恰好 4 张的边界（95.417571 @0.419209），价格跌到 0.419155,
   * 点击时重算 floor(95.417571×0.419155/10)=3——用户看着「4 张」下单，
   * 挂出去的是 3 张。用整数张当唯一真源，显示值都从它折出来。
   */
  const [lockedContracts, setLockedContracts] = useState(0);
  /**
   * 锁的**折算源**：输入时刻的未取整数值 + 当时用的折算价。
   * 任何需要重折的场合(杠杆/限价真的变了)都从这里出发,**绝不从显示串反推**——
   * 显示走 toFixed(6),六位小数在 BTC(面值 100、价 ~1e5)下装不下整张边界:
   * '0.003173' × 94537 ÷ 100 = 2.9997,一次反推就把 3 张掉成 2。
   */
  const lockFoldRef = useRef({ raw: 0, price: 0 });
  /** 输入框是否正被编辑。编辑期间绝不回写，否则用户打一半的数会被改掉。 */
  const [qtyFocused, setQtyFocused] = useState(false);
  const [leverageModalOpen, setLeverageModalOpen] = useState(false);
  const [percent, setPercent] = useState(0);

  // TP/SL inline checkbox state
  const [enableTpSl, setEnableTpSl] = useState(false);
  const [tpTrigger, setTpTrigger] = useState('');
  const [slTrigger, setSlTrigger] = useState('');

  // 交易偏好（币安右上角 ⋯ 抽屉）。走 usePersistedState，自动纳入账号云端存档。
  const [tradingPrefs, setTradingPrefs] = usePersistedState<TradingPreferences>(
    'trading_preferences_v1', DEFAULT_TRADING_PREFERENCES,
  );
  const [prefsOpen, setPrefsOpen] = useState(false);
  const notifications = useNotificationCenter();

  // 高级类型槽：第三常驻位显示当前选中的高级类型（币安式），默认条件委托
  const [advancedType, setAdvancedType] = useState<OrderType>('CONDITIONAL');
  // 各高级类型的参数（可编辑）
  const [callbackRate, setCallbackRate] = useState('1');
  const [trailingExecType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [trailingLimitPrice] = useState('');
  const [twapDuration, setTwapDuration] = useState('60');
  const [condExecType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [condLimitPrice] = useState('');
  const [scaledCount, setScaledCount] = useState('5');
  const [scaledStartPrice, setScaledStartPrice] = useState('');
  const [scaledEndPrice, setScaledEndPrice] = useState('');
  // TWAP 切片间隔自动推导：总时长均分约 20 片、每片不短于 1 分钟（不再暴露给用户）
  const twapInterval = String(Math.max(1, Math.round((parseFloat(twapDuration) || 60) / 20)));

  // 默认触发类型：偏好一改即同步到下单用的触发类型（币安「默认触发类型」页）
  useEffect(() => {
    setTriggerType(tradingPrefs.defaultTriggerType);
  }, [tradingPrefs.defaultTriggerType]);

  // 应用默认杠杆：仅当开关开启、该标的从未显式设置过杠杆、且当前既无持仓也无挂单时。
  // 与币安一致——已有仓位/挂单的币对不得在背后改动风险参数。
  useEffect(() => {
    if (!tradingPrefs.useDefaultLeverage) return;
    if (ctx.leverageMap[symbol] != null) return;
    if ((ctx.positionsMap[symbol]?.length ?? 0) > 0) return;
    if ((ctx.ordersMap[symbol]?.length ?? 0) > 0) return;
    /**
     * 偏好的 1–50x 再夹到这个币的最高杠杆：KAITO 以外还有不少只到 10x、20x 的合约。
     * 杠杆按标的只存一份，而同一个币的 U 本位与币本位上限可能不同（BNB 75x / 20x）：
     * 存「两张合约里较高的上限」与偏好的较小者，读的时候再按各自的结算方式夹——
     * 面板每次刷新都在币本位，按它夹会把 U 本位那张合约也永久压到币本位的上限。
     */
    ctx.setSymbolLeverage(symbol, clampLeverageAcrossSettlements(symbol, clampPrefLeverage(tradingPrefs.defaultLeverage)), 'any');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tradingPrefs.useDefaultLeverage, tradingPrefs.defaultLeverage]);

  /**
   * 保存的杠杆超过这个合约的最高杠杆（例如旧版本允许的 125x 放在只到 75x 的 KAITO 上）时，
   * 读出来的已经是夹过的值（TradingContext.getSymbolLeverage）。这里只负责说一声，每个值只说一次。
   */
  const storedLeverage = ctx.leverageMap?.[symbol];
  useEffect(() => {
    noticeLeverageClamp({ symbol, settlement: settlementMode, stored: storedLeverage, applied: leverage });
  }, [symbol, settlementMode, storedLeverage, leverage]);

  // 换标的或切结算方式时，数量单位回到该模式的原生单位并清空输入——
  // 否则「5,000,000」这种数字会带着上一个模式的语义留在框里，极易误读。
  useEffect(() => {
    setCurrencyUnit('USDT');
    setUsdtInputMode('ORDER_VALUE');
    setQuantity('');
    setLockedContracts(0);
    setPercent(0);
  }, [isCoinMargined, symbol]);

  /**
   * Sync priceSelection ↔ orderType
   *
   * 高级类型此前**一个都没映射**，于是 priceSelection 留在上一个标签的值上：
   * 在「限价」里填过 0.0113 再切到「条件委托」，限价框已经不渲染了
   * （showLimitPriceField 不含 CONDITIONAL），可 price 这个 state 还在，
   * 于是 buildOrderParams 会给一张条件单带上 price: 0.0113 —— 一个**没有任何
   * 引擎会认**的价（条件单成交在触发价上），却会被折算价与委托列表当成委托价优先读到。
   * 幽灵委托价必须在源头掐掉。
   */
  useEffect(() => {
    if (orderType === 'LIMIT' || orderType === 'POST_ONLY' || orderType === 'LIMIT_TP_SL') setPriceSelection('LIMIT');
    else setPriceSelection('MARKET');
  }, [orderType]);

  // Picked-from-chart price → fill stopPrice
  useEffect(() => {
    if (pickedPrice != null && pickMode) {
      setStopPrice(pickedPrice.toFixed(pricePrecision));
      onPickModeChange?.(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedPrice]);

  // Close popovers on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (orderTypeMenuRef.current && !orderTypeMenuRef.current.contains(e.target as Node)) setShowOrderTypeMenu(false);
      if (tifMenuRef.current && !tifMenuRef.current.contains(e.target as Node)) setShowTifMenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ===== Derived values =====
  const inputAmount = parseFloat(quantity) || 0;
  /**
   * 折算价：这一单**真正会成交**的价，币数 ↔ 张数全部按它换算。
   * 条件委托成交在触发价上，此前却一路按实时市价折——触发价 0.010344、市价 0.011199 时，
   * 填 3600 个币会下出 4 张，而这 4 张到触发价上是 3866.98 个币，比填的多 267 个。
   * 用户从没批准过那 267 个。
   */
  const priceRef = panelReferencePrice({
    orderType,
    priceSelection,
    limitPrice: parseFloat(price) || 0,
    triggerPrice: parseFloat(stopPrice) || 0,
    marketPrice: currentPrice,
  });
  const effectivePrice = priceRef.price;
  /**
   * 用户**亲手写下**的那个折算价（字符串原样）。重折只认它的变化。
   * 不能拿 effectivePrice 当依赖：兜底到市价时它每根 K 线都在跳，
   * 那等于每一跳都用新价重掷一次张数——正是「看着 4 张、挂出 3 张」的原始事故。
   */
  const authoredPrice = priceSelection === 'LIMIT' ? price : orderType === 'CONDITIONAL' ? stopPrice : '';

  let effectiveQty = 0;
  let margin = 0;
  let marginCoin = 0;
  let notionalValue = 0;
  if (isCoinMargined) {
    // 张数是唯一真源：BASE 档直接取整输入；USD 两档读**输入时刻锁定**的张数,
    // 绝不在渲染里用实时价重算——那正是「看着 4 张下单、挂出 3 张」的来源。
    // 保证金 / 名义随实时价浮动是币本位的物理事实,照实显示。
    effectiveQty = currencyUnit === 'BASE' ? coinContractsExact(inputAmount) : lockedContracts;
    notionalValue = coinNotionalUsd(effectiveQty, contractSizeUsd);
    // USD 保证金与价无关（名义 ÷ 杠杆),折成币才需要一个价——而这一格是拿来跟
    // 正上方那行「可用 … 币」比的,两者必须同分母。按折算价折会让「保证金 1.979 亿 NOM」
    // 压在「可用 1.828 亿 NOM」上面(差 8.27%),看着像超额,实则 USD 口径分毫不差。
    margin = leverage > 0 ? notionalValue / leverage : 0;
    marginCoin = currentPrice > 0 ? margin / currentPrice : 0;
  } else if (currencyUnit === 'BASE') {
    effectiveQty = inputAmount;
    margin = (effectiveQty * effectivePrice) / leverage;
    notionalValue = effectiveQty * effectivePrice;
  } else if (usdtInputMode === 'ORDER_VALUE') {
    effectiveQty = effectivePrice > 0 ? inputAmount / effectivePrice : 0;
    margin = inputAmount / leverage;
    notionalValue = inputAmount;
  } else {
    margin = inputAmount;
    effectiveQty = effectivePrice > 0 ? (inputAmount * leverage) / effectivePrice : 0;
    notionalValue = effectiveQty * effectivePrice;
  }

  /**
   * 币本位一张的面值固定在 USD（10；BTC 100），所以「最小下单量」换成币是随价浮动的。
   * 之前不足一张会被静默放大成一张下出去，用户看到的是自己填的数、成交的是别的数。
   * 现在把这一张究竟是多少币算出来，直接说给用户听。
   */
  const minCoinPerContract = effectivePrice > 0 ? contractSizeUsd / effectivePrice : 0;
  /**
   * 开仓/平仓两档一视同仁。
   * 我一度以为平仓档需要豁免（怕拦住尾仓平不掉），那是**基于一个错误前提**：
   * 面板的「平仓」档根本不平仓——PlaceOrderParams 里没有 reduceOnly，
   * actionMode 只改按钮文案，handlePlaceOrder 一律 [...existing, position] 追加**新仓位**。
   * 真正的平仓走 PositionPanel → handleClosePosition，不经过这里。
   * 豁免的实际后果是造出一个死按钮：effectiveQty=0 时守卫不响、按钮可点，
   * buildOrderParams 撞上 finalQty <= 0 返回 null，点下去什么都不发生、也没有任何提示。
   */
  const belowMinContract = isCoinMargined && quantity.trim() !== '' && effectiveQty < 1;
  /** 取整后真正会下出去的币量——与输入不一致时必须显式告诉用户。 */
  const effectiveCoinAmount = effectivePrice > 0
    ? coinNotionalUsd(effectiveQty, contractSizeUsd) / effectivePrice
    : 0;

  /**
   * 币安分层上限（-2027）：判的是**下单之后**这个合约的总敞口——持仓（多空绝对值相加）
   * + 当前委托 + 这一单，不是这一单自己。杠杆对话框与引擎下单读的是同一个判定。
   * 面板的「平仓」档并不平仓（见 belowMinContract 的注释），所以这里没有只减仓豁免。
   */
  const symbolOrders = ctx.ordersMap?.[symbol] ?? [];
  /**
   * 这一单按引擎的口径估值（placementOrderValuation，与 handlePlaceOrder 同一个函数）：USD 名义与估值价。
   * 分段订单按各子单的委托价、跟踪委托按激活价，其余按折算价；真币本位按估值价把名义折成币——
   * 一张低于现价的买入限价单按委托价折，成交后的仓位才不会超出上限。
   * 已经穿价的限价单（买价 ≥ 现价、卖价 ≤ 现价）下一根就成交，按现价估值——所以估值按方向各算一份。
   */
  const limitDraft = {
    type: orderType,
    quantity: effectiveQty,
    price: priceSelection === 'LIMIT' ? (parseFloat(price) || 0) : 0,
    stopPrice: parseFloat(stopPrice) || 0,
    settlementMode,
    contracts: isCoinMargined ? effectiveQty : undefined,
    contractSizeUsd: isCoinMargined ? contractSizeUsd : undefined,
    scaledCount: parseInt(scaledCount) || 5,
    scaledStartPrice: parseFloat(scaledStartPrice) || 0,
    scaledEndPrice: parseFloat(scaledEndPrice) || 0,
  };
  const draftFor = (side: OrderSide) => ({ ...limitDraft, side });
  /** 立即成交（市价 / 最优价）的单按现价估值，也不再判第二道。 */
  const executesNow = orderType === 'MARKET' || priceSelection === 'BEST';
  const valuationFor = (side: OrderSide) => placementOrderValuation(symbol, draftFor(side), effectivePrice, currentPrice);
  /** 数量还没填时也要知道估值价（「可开」按它折回 USD）：按一个单位的量估。 */
  const valuationPriceFor = (side: OrderSide) => (effectiveQty > 0
    ? valuationFor(side).price
    : placementOrderValuation(
      symbol,
      { ...draftFor(side), quantity: 1, contracts: isCoinMargined ? 1 : undefined },
      effectivePrice,
      currentPrice,
    ).price);
  /**
   * 两个方向各判一道：对冲更新前仓位的反向单不受上限约束（见 positionLimit 文件头），
   * 所以开多 / 开空可能一个能下、一个不能；同一个限价对一个方向已经穿价、对另一个方向还挂着，估值与第二道也不同。
   * 第二道与引擎下单同一个判定（checkPlacementPositionLimit）：条件委托 / 跟踪委托按触发价（激活价），
   * 不会立即成交的限价单按成交那一刻的委托价（分段订单取离现价最远的子单）。
   */
  /** 第二道的价：限价类只对还挂得住的方向有（穿价的方向下一根就按现价成交，没有第二道）。 */
  const secondGates = {
    LONG: placementCheckPrice(draftFor('LONG'), currentPrice, executesNow),
    SHORT: placementCheckPrice(draftFor('SHORT'), currentPrice, executesNow),
  };
  const limitCheckFor = (side: OrderSide) => {
    const gate = secondGates[side];
    return checkPlacementPositionLimit({
      symbol,
      settlement: settlementMode,
      leverage,
      positions,
      orders: symbolOrders,
      markPrice: currentPrice,
      orderNotionalUsd: effectiveQty > 0 ? valuationFor(side).usd : 0,
      orderPrice: valuationPriceFor(side),
      side,
      triggerPrice: gate.price,
      triggerKind: gate.kind,
    });
  };
  const limitChecks = { LONG: limitCheckFor('LONG'), SHORT: limitCheckFor('SHORT') };
  /** 分层单位、当前杠杆的上限、浮层：两个方向相同，取开多那一道。 */
  const limitCheck = limitChecks.LONG;
  /** U 本位每个币在引擎眼里的单价（分段 = 阶梯均价，跟踪 = 激活价，已经穿价的限价 = 现价），仓位比例按钮按它换数量。 */
  const placementUnits = {
    LONG: placementUnitPriceUsd(symbol, draftFor('LONG'), effectivePrice, priceRef.kind === 'market', currentPrice),
    SHORT: placementUnitPriceUsd(symbol, draftFor('SHORT'), effectivePrice, priceRef.kind === 'market', currentPrice),
  };
  const sideBlocked = {
    LONG: notionalValue > 0 && !limitChecks.LONG.ok,
    SHORT: notionalValue > 0 && !limitChecks.SHORT.ok,
  };
  const leverageExceeded = sideBlocked.LONG || sideBlocked.SHORT;
  /** 按钮上的字（「平仓」档的开多按钮写的是「平空」）。 */
  const sideButtonLabel = (side: OrderSide) => (actionMode === 'OPEN'
    ? (side === 'LONG' ? '开多' : '开空')
    : (side === 'LONG' ? '平空' : '平多'));
  /**
   * 限价单只对这个方向穿价（买价高于现价、卖价低于现价；另一个方向挂得住）：下一根就成交，等于市价单，按现价估值——
   * 拒绝理由前说一句，免得挂单方向照常、另一个方向却标红时看不懂。委托价就是现价时两个方向一样，不说。
   */
  const limitPriced = !executesNow && (orderType === 'LIMIT' || orderType === 'POST_ONLY');
  const crossedLead = (side: OrderSide) => (
    limitPriced && placementUnits[side].atMarket && !placementUnits[side === 'LONG' ? 'SHORT' : 'LONG'].atMarket
      ? `${side === 'LONG' ? '买' : '卖'}价已穿过现价、下一根就成交，按现价估值：`
      : ''
  );
  /** 两个方向的话一样就只说一遍；不一样（有旧仓位、或限价对一个方向已经穿价时）分别说是哪个按钮。 */
  const limitWarningText = (() => {
    const longText = sideBlocked.LONG ? `${crossedLead('LONG')}${limitChecks.LONG.message ?? ''}` : null;
    const shortText = sideBlocked.SHORT ? `${crossedLead('SHORT')}${limitChecks.SHORT.message ?? ''}` : null;
    if (longText && shortText && longText === shortText) return longText;
    return [
      longText && `${sideButtonLabel('LONG')}：${longText}`,
      shortText && `${sideButtonLabel('SHORT')}：${shortText}`,
    ].filter(Boolean).join(' ');
  })();
  const tierUnit = limitCheck.unit;
  /** 分层是借来的（合成币本位）或兜底的，要在数字旁边说清楚。 */
  const tierNote = limitCheck.note;
  /**
   * 挂着的、触发 / 成交时会被再判的开仓单（本次更新之后下的触发类单、靠对冲豁免挂出的限价单）到时按那一刻的敞口再判：
   * 这张单下出去之后，哪张会注定被撤——价格直接走到那张单的价，或先到另一侧某张挂单的价再折回来
   * （restingTriggerScenarios；这一单若是路上会成交的限价单 / 会触发的条件单，到时已是持仓）。
   * 这一单自己是触发类单时，「另一侧的挂单先成交、再折回来触发它」的走法也一并说。
   * 币安不拦这一单，面板也不拦，只在点按钮之前摆出来；引擎下单成功后再往消息中心记一条。
   */
  const hasRecheckedOrders = symbolOrders.some(o => isTriggerRecheckedOrder(o) || orderWaypointPrice(o) > 0);
  const triggerRiskFor = (side: OrderSide) => (hasRecheckedOrders && effectiveQty > 0 && !sideBlocked[side]
    ? triggerRiskMessage(newlyDoomedTriggerOrders({
      symbol,
      positions,
      orders: symbolOrders,
      added: placementAftermath(
        { ...limitDraft, side, leverage },
        { markPrice: currentPrice, immediate: executesNow, legacy: placementUsesLegacyHedge(limitChecks[side]) },
      ),
      markPrice: currentPrice,
    }), '这张单下出去后')
    : null);
  const triggerRiskWarning = (() => {
    const longRisk = triggerRiskFor('LONG');
    const shortRisk = triggerRiskFor('SHORT');
    if (!longRisk && !shortRisk) return null;
    if (longRisk && shortRisk && longRisk.title === shortRisk.title) return [longRisk];
    return [
      longRisk && { ...longRisk, title: `${sideButtonLabel('LONG')}：${longRisk.title}` },
      shortRisk && { ...shortRisk, title: `${sideButtonLabel('SHORT')}：${shortRisk.title}` },
    ].filter((r): r is { title: string; description: string } => r != null);
  })();
  /**
   * 只靠「对冲更新前的仓位」那条豁免放行的方向：引擎给这一单盖豁免标记、按旧模型开，在按钮前说一声，
   * 免得看着一张远超分层的单下得出去，以为分层维持保证金也照常适用；也说清挂着的单到时还要再判一次。
   */
  const legacyHedgeNote = (() => {
    if (!(effectiveQty > 0)) return null;
    const sides = (['LONG', 'SHORT'] as const).filter(side => !sideBlocked[side] && placementUsesLegacyHedge(limitChecks[side]));
    if (sides.length === 0) return null;
    return `${sides.map(sideButtonLabel).join('、')}：这一单是对冲更新前的仓位，不受分层上限约束；`
      + '开出的仓位与它对冲的旧仓位一样按旧模型计维持保证金（0.4%），但它不算更新前的仓位，不能再给别的单当豁免额度。'
      + (executesNow ? '' : '挂着的这张单触发 / 成交那一刻还会再判一次：旧仓位已减少或平掉时按普通分层判，放不下就撤单。');
  })();
  /**
   * 这一单（成交后）与同方向仓位怎么合并，按钮前说清楚（positionRiskModel.mergeRiskBlocked）。
   * 第 7 轮定的规则把这件事变成**有方向**的两种画面，两种都要说：
   *
   *   · **会合并**（这一单按分层、同方向仓位按旧的 0.4%——更新前的仓位或靠对冲豁免开的）：
   *     并进去之后**整个仓位仍按旧的 0.4%**，不换模型、不重新定价，旧仓位的维持保证金口径一个数都不变；
   *     两笔的保证金与均价汇到一起，强平价因此被推远一点（把前后两个数都写出来）。
   *     加进去的这一截也**不会**把对冲豁免的额度做大（豁免的底冻在加仓之前，规则四），旧仓位是豁免的底时一并说。
   *   · **不合并**（这一单按旧的 0.4%——只靠对冲豁免放行——而同方向仓位按币安分层）：合并会让分层仓位把
   *     这一截也按档位定价、跨进更高的档，把它自己当场强平，所以两笔各成一个仓位、各算各的强平价。
   *     这时旧仓位的强平价一个数都不动，卡上会有两笔；追加保证金要说清「+」的真实行为
   *     （AdjustMarginModal 按名义等比摊到卡上每一笔，没有单腿的追加入口）。
   */
  const mergeModelNote = (() => {
    if (!(effectiveQty > 0) || !(currentPrice > 0)) return null;
    const lines: string[] = [];
    const open = positions.filter(isPositionOpen);
    const after = executesNow ? '' : '成交后';
    /** 这一单成交后的样子（带保证金，用来算合并后的强平价）。与引擎的建仓口径同：名义 ÷ 杠杆。 */
    const draftFill = (side: OrderSide, exempt: boolean) => {
      const notionalUsd = isCoinMargined ? coinNotionalUsd(effectiveQty, contractSizeUsd) : effectiveQty * currentPrice;
      const marginUsd = leverage > 0 ? notionalUsd / leverage : 0;
      return {
        id: 'merge-note-fill',
        side,
        entryPrice: currentPrice,
        quantity: effectiveQty,
        contracts: isCoinMargined ? effectiveQty : undefined,
        leverage,
        marginMode,
        margin: marginUsd,
        isolatedMargin: marginMode === 'isolated' ? marginUsd : undefined,
        marginCoin: isCoinMargined && currentPrice > 0 ? marginUsd / currentPrice : undefined,
        settlementMode,
        contractSizeUsd: isCoinMargined ? contractSizeUsd : undefined,
        openTime: 0,
        ...(exempt ? legacyHedgeRiskStamp(symbol) : positionRiskStamp(symbol)),
      } as Position;
    };
    for (const side of ['LONG', 'SHORT'] as const) {
      if (sideBlocked[side]) continue;
      const exempt = placementUsesLegacyHedge(limitChecks[side]);
      const fill = draftFill(side, exempt);
      const merged = mergeFilledPosition(symbol, open, fill);

      if (merged.blockedBy === 'riskModel') {
        // 只有靠对冲豁免放行的单会走到这里（面板下的单一定带戳；分层的一笔现在照并）。
        const held = open.find(p => p.side === side) ?? null;
        const heldLiq = held && held.marginMode === 'isolated' ? calcLiquidationPrice(held, symbol) : Number.NaN;
        const liqGap = Number.isFinite(heldLiq) && heldLiq > 0 ? Math.abs(currentPrice - heldLiq) / currentPrice : Number.NaN;
        /**
         * 旧仓位（逐仓）贴着强平价时把「这一笔推不远它」说在按钮前。
         * 「+」是**卡级**的：卡上多于一笔时按名义等比摊到每一笔，旧仓位只拿到其中一部分——照实说，
         * 别让面板与 AdjustMarginModal 里那句「按名义等比摊到每一笔」互相打架。
         */
        const rescue = Number.isFinite(liqGap) && liqGap <= 0.05
          ? `现有仓位的强平价 ${formatPrice(heldLiq, symbol)} 离现价只剩 ${(liqGap * 100).toFixed(2)}%，`
            + '这一单不会把它推远（并不进去）：要给它续命，用持仓卡上的「+」追加保证金——'
            + '卡上有两笔时这笔钱按名义等比摊到每一笔，旧仓位只拿到其中一部分，要按这个比例多存一些。'
          : '';
        lines.push(`${sideButtonLabel(side)}：这一单靠对冲豁免按旧的 0.4% 开，${after}不会并进按币安分层计的同方向仓位`
          + '（并进去会把这一截也按档位定价、把那个分层仓位推进更高的档），单独成一个仓位、各算各的强平价；'
          + '现有仓位的维持保证金与强平价不变。卡上的「平仓」照常可以按成数部分平仓（成数摊到卡上每一笔）。'
          + rescue);
        continue;
      }

      // 会合并，而且是「分层的一笔并进按旧 0.4% 的仓位」那一格：整仓仍按旧模型，把代价与好处都写出来。
      if (!merged.absorbedFillId || exempt) continue;
      const target = open.find(p => p.id === merged.survivor.id) ?? null;
      if (!target || isTieredRiskPosition(target)) continue;
      const beforeLiq = calcLiquidationPrice(target, symbol);
      const afterLiq = calcLiquidationPrice(merged.survivor, symbol);
      /** 强平价前后对比。多单的强平价变低 = 推远，空单相反；变动不到 0.01% 就别拿百分比唬人。 */
      const moved = (() => {
        if (!(beforeLiq > 0) || !(afterLiq > 0) || !Number.isFinite(beforeLiq) || !Number.isFinite(afterLiq)) return '';
        const pair = `整仓强平价 ${formatPrice(beforeLiq, symbol)} → ${formatPrice(afterLiq, symbol)}`;
        const movePct = (Math.abs(afterLiq - beforeLiq) / currentPrice) * 100;
        if (!(movePct >= 0.01)) return `${pair}（几乎不动）。`;
        const safer = side === 'LONG' ? afterLiq < beforeLiq : afterLiq > beforeLiq;
        return `${pair}（${safer ? '推远' : '拉近'} ${movePct.toFixed(2)}%）。`;
      })();
      lines.push(`${sideButtonLabel(side)}：这一单${after}会并进${isLegacyHedgeRisk(target) ? '靠对冲豁免开的' : '更新前开的'}同方向仓位——`
        + '合并后整个仓位（含这一笔）仍按旧的统一 0.4% 计维持保证金，不换模型、不重新定价，也不会多出一条只靠自己那点保证金硬扛的新腿。'
        + moved
        + (isLegacyHedgeRisk(target) ? '' : '加进去的这一截不会把「对冲更新前仓位」的豁免额度做大：豁免的底冻在这一笔之前。'));
    }
    return lines.length > 0 ? lines.join(' ') : null;
  })();
  // belowMinContract 此前是死代码：roundCoinContracts 只会返回 0 或 ≥1，
  // 永远落不进 (0,1)，所以「不足一张」从来没被拦住过，而是被放大成一张下出去。
  // 换成 coinContractsExact 之后这条守卫才真正活了。
  /**
   * 币安单笔数量上限（-4005 Quantity greater than max quantity，见 lib/marketLotSize）：与引擎下单同一个判定。
   * 按市价成交的类型（市价、条件委托、跟踪委托、TWAP 的每一片）不得超过 MARKET_LOT_SIZE，
   * 限价类（限价、只做 Maker、分段的每张子单）不得超过 LOT_SIZE。与方向无关，开多开空一起置灰。
   */
  const lotSize = placementLotSize(symbol, {
    ...limitDraft,
    priceSelection,
    // 与下单时发给引擎的回调幅度同一个口径（小数；空着按 1%）
    callbackRate: parseFloat(callbackRate) / 100 || 0.01,
    twapDuration: parseFloat(twapDuration) || 60,
    twapInterval: parseFloat(twapInterval) || 5,
  }, currentPrice);
  const lotRefusal = lotSize.refusal;
  /**
   * 市价类的常驻小字：「单笔市价上限 200,000 KAITO」。TWAP 注明按每一片算；合成币本位的上限随价变，
   * TWAP 每一片按执行那一刻的价折张、跟踪委托按回调后的成交价折张，都写明按哪个价。
   */
  const lotCapHint = lotSize.main.kind === 'market'
    ? (() => {
      const label = lotSizeCapLabel(lotSize.main);
      if (!label) return null;
      const floating = lotSize.main.resolved?.source === 'usdm-proxy';
      if (orderType === 'TWAP' && !executesNow) {
        return `${label} · TWAP 按每一片算（共 ${lotSize.pieces} 片）${floating ? '，价格下跌时每片上限随之变小' : ''}`;
      }
      if (orderType === 'TRAILING_STOP' && !executesNow && floating && lotSize.main.price != null) {
        return `${label} · 按${parseFloat(stopPrice) > 0 ? '激活价' : '现价'}下方一个回调幅度（${formatPrice(lotSize.main.price)}）算`;
      }
      return label;
    })()
    : null;
  /**
   * 仓位比例按钮 / 「可开」的单笔上限这一支（引擎单位 × 笔数：TWAP 片数、分段张数）。
   * 上限与这一单的量有一边跟着现价走时，在上限前留 0.2% 余量（LIVE_PRICE_TIER_HEADROOM）——
   * 面板用的是平滑后的显示价，引擎按最新价折算，恰好卡线的数量跌一个 tick 就又超了、按钮随之置灰：
   *   · 合成币本位：张数上限 = 币数上限 × 价 ÷ 面值，随价变化；按现价成交的（市价、TWAP、没有激活价的跟踪委托）留，
   *     整张向下取整。张数是锁定的，量本身不漂。
   *   · U 本位按 USDT 下单（订单金额 / 初始保证金，面板的默认单位）：上限以币计、与价无关，但框里的 USDT
   *     按折算价 ÷ 成币——折算价是现价（市价、TWAP、跟踪委托：它们都按现价折币）时，币数跟着现价漂，同样留；
   *     条件委托按触发价、限价按委托价折，价钉住了，不留。币数不取整（100% 填进框里时再按精度向下取整）。
   *   · 币数档（U 本位）与张数档（币本位）的量是锁定的，真币本位的上限与价无关：都不留。
   */
  const lotCapUnits = (() => {
    const max = lotSize.main.maxUnits;
    if (max == null || !Number.isFinite(max)) return Infinity;
    const proxyFloats = lotSize.main.resolved?.source === 'usdm-proxy'
      && (executesNow || orderType === 'TWAP' || (orderType === 'TRAILING_STOP' && !(parseFloat(stopPrice) > 0)));
    const usdtFoldFloats = !isCoinMargined && currencyUnit === 'USDT' && priceRef.kind === 'market';
    const perPiece = proxyFloats
      ? Math.floor(max * (1 - LIVE_PRICE_TIER_HEADROOM))
      : usdtFoldFloats ? max * (1 - LIVE_PRICE_TIER_HEADROOM) : max;
    return perPiece * lotSize.pieces;
  })();
  const baseOrderDisabled = disabled || !!coolingOff || belowMinContract || lotRefusal != null;
  const orderDisabledFor = (side: OrderSide) => baseOrderDisabled || sideBlocked[side];

  /**
   * 可开（名义，USD / USDT）= min(可用 × 杠杆, 分层上限 − 现有敞口)，两个方向各算一个
   * （对冲更新前仓位的那一侧可以更大，见 remainingOpenUsd；同一个限价对一个方向已经穿价，估值也不同）。
   * 仓位比例按钮的 100% 见 percentMax（限价只对一个方向穿价时取挂得住的那一列，否则取较大的那一列，向下取整），
   * 拖到头也不会拖出一张在它要下的那个方向上过不了分层的单。
   * 估值随标记价浮动时（按现价成交的单、已有按标记价估值的持仓），分层这一支留 0.2% 余量：
   * 面板用的是平滑后的显示价，引擎用最新价（见 sizingRemainingOpenUsd）。
   * 条件委托 / 跟踪委托还要按触发价那一道的余量封顶（placementSizingRemainingUsd）。
   */
  const hasOpenLimitPositions = positions.some(p => isPositionOpen(p) && limitSettlementOf(p) === settlementMode);
  const sizingLiveFor = (side: OrderSide) => ({
    orderAtMarket: placementFloatsWithMark({
      draft: draftFor(side), atMarket: placementUnits[side].atMarket, markPrice: currentPrice, orders: symbolOrders,
    }),
    hasOpenPositions: hasOpenLimitPositions,
  });
  /** 引擎的保证金预检按委托价估（限价单即使已经穿价也按委托价扣），其余按引擎单价。 */
  const marginUnitUsd = (side: OrderSide) => (orderType === 'LIMIT' || orderType === 'POST_ONLY'
    ? effectivePrice
    : placementUnits[side].unitUsd);
  /**
   * 这一方向的可开名义（按分层判定里这一单的估值口径）。U 本位按币数取两条约束的较小者再乘回单价——
   * 保证金按委托价、分层按引擎单价（已经穿价的限价单是现价），两者的币数不能直接拿名义比。
   */
  const maxNotionalFor = (side: OrderSide) => {
    const tierUsd = placementSizingRemainingUsd(limitChecks[side], currentPrice, sizingLiveFor(side));
    const marginUsd = Math.max(0, available) * leverage;
    // 单笔数量上限（币本位张数 × 面值；U 本位币数）：100% 不会填出一张被 -4005 拒掉的单
    if (isCoinMargined) return Math.min(marginUsd, tierUsd, lotCapUnits * contractSizeUsd);
    const unit = placementUnits[side].unitUsd;
    const marginUnit = marginUnitUsd(side);
    if (!(unit > 0) || !(marginUnit > 0)) return Math.min(marginUsd, tierUsd);
    return Math.min(marginUsd / marginUnit, tierUsd / unit, lotCapUnits) * unit;
  };
  const maxNotionalBySide = { LONG: maxNotionalFor('LONG'), SHORT: maxNotionalFor('SHORT') };
  /**
   * 仓位比例按钮的 100% 取哪一列「可开」。两列不同有两个来源：
   *   · 同一个限价只对一个方向穿价（买价高于现价、卖价低于现价；分段订单是全部子单都穿价）：穿价的那个方向等于市价单
   *     （按现价估值、留余量），限价单挂得住的是另一个方向——100% 取挂得住的那一列（U 本位低于现价的买单、
   *     真币本位高于现价的卖单，取穿价那一列会少开一截）；那一列是 0 时才取另一列。拿这个量去点穿价的方向，
   *     超出的话按钮标红并说明「已穿过现价、按现价估值」，不会下出一张成交后超限的单；
   *   · 更新前仓位的对冲豁免让一侧更大：取较大的那一列——往超限的旧仓位那一侧本来就开不了，100% 给的是整份对冲；
   *     拿这个量点另一侧的按钮会标红并说明。
   */
  const bothSides: OrderSide[] = ['LONG', 'SHORT'];
  /** 限价类（限价、只做 Maker、分段）在这个方向上有没有挂得住的价（有「成交那一刻」那一道）。 */
  const restsOnBook = (side: OrderSide) => secondGates[side].kind === 'limit' && secondGates[side].price > 0;
  const restingSide: OrderSide | null = restsOnBook('LONG') === restsOnBook('SHORT')
    ? null
    : restsOnBook('LONG') ? 'LONG' : 'SHORT';
  const percentMax = (value: (side: OrderSide) => number) => {
    const usable = (v: number) => Number.isFinite(v) && v > 0;
    if (restingSide && usable(value(restingSide))) return value(restingSide);
    const open = bothSides.map(value).filter(usable);
    return open.length > 0 ? Math.max(...open) : 0;
  };
  const maxNotional = percentMax(side => maxNotionalBySide[side]);
  /** U 本位：这一方向最多能开的币数（按引擎单价把可开名义换成币）。 */
  const maxBaseCoinsFor = (side: OrderSide) => (placementUnits[side].unitUsd > 0
    ? maxNotionalBySide[side] / placementUnits[side].unitUsd
    : 0);
  const maxBaseCoins = percentMax(maxBaseCoinsFor);
  /**
   * 这三行描述的是**账户**，不是这一单，所以只能按实时价折——
   * totalMaintenance 甚至聚合了别的标的的仓位（见上方循环）。
   * 跟着折算价走的话，在触发价框里敲一个字，账户余额的币计读数就会整体跳一下。
   */
  const availableCoin = currentPrice > 0 ? Math.max(0, available) / currentPrice : 0;
  const accountEquityCoin = currentPrice > 0 ? Math.max(0, equity) / currentPrice : 0;
  const maintenanceCoin = currentPrice > 0 ? Math.max(0, totalMaintenance) / currentPrice : 0;
  const coinInputUnit: CoinInputUnit = currencyUnit === 'BASE'
    ? 'CONTRACTS'
    : usdtInputMode === 'INITIAL_MARGIN'
      ? 'COIN_MARGIN'
      : 'COIN_NOTIONAL';
  // 「保证金」模式下必须带上「保证金」三字：只写币名会与「数量」字段完全混淆，
  //  用户会把「5,000,000 RUNE 保证金」误读成「买 5,000,000 个 RUNE」。
  /**
   * 「至少要填多少」必须用**当前输入框那一档的单位**报，否则等于换个单位继续骗人。
   *   张       → 1
   *   币金额   → 一张的名义折币          = 面值 / 价
   *   币保证金 → 一张所需的保证金折币    = 面值 / (价 × 杠杆)
   * 之前三档共用「面值 / 价」，在保证金档下报出来的数是真实所需的 leverage 倍；
   * 用户照着填会开出 6 倍于本意的仓位。
   */
  const minInputInCurrentUnit = coinInputUnit === 'CONTRACTS'
    ? 1
    : coinInputUnit === 'COIN_MARGIN'
      ? (effectivePrice > 0 && leverage > 0 ? contractSizeUsd / (effectivePrice * leverage) : 0)
      : minCoinPerContract;
  /**
   * 按当前档折算出「这一单实际会下出去的量」，单位与输入框一致。
   * 币本位的张是整数,所以用户填的数几乎总要被取整——以前取整是隐形的:
   * 框里写 88、委托里是 72.956016,两个数都对,但不该同时出现在屏幕上。
   * 失焦时把框里的数换成这个值,输入框 / 提示 / 当前委托从此显示同一个数。
   */
  const snappedInput = !isCoinMargined || effectiveQty < 1
    ? null
    : coinInputUnit === 'CONTRACTS'
      ? String(effectiveQty)
      : coinInputUnit === 'COIN_MARGIN'
        ? marginCoin.toFixed(6)
        : effectiveCoinAmount.toFixed(6);

  const minInputUnitLabel = coinInputUnit === 'CONTRACTS'
    ? '张'
    : coinInputUnit === 'COIN_MARGIN'
      ? `${baseCoin} 保证金`
      : baseCoin;

  const unitLabel = currencyUnit === 'BASE'
    ? (isCoinMargined ? '张' : baseCoin)
    // 币本位三档必须都自带量纲。此前「币金额」档只写币名，与 U 本位 BASE 档
    // （那里币名确实等于持币数量）长得一模一样，用户把「10 API3」读成
    // 「买 10 个 API3」完全合理——而币本位永远拿不到「10 个币的仓位」，
    // 那个数字自始至终只是个折算金额。这次事故的入口就在这个标签上。
    : (isCoinMargined ? (usdtInputMode === 'ORDER_VALUE' ? `${baseCoin} 金额` : `${baseCoin} 保证金`) : 'USDT');
  const marginDisplay = isCoinMargined
    ? `${formatCoinAmount(marginCoin, baseCoin)} ≈ ${formatUSDT(margin)} USD`
    : `${formatUSDT(margin)} USDT`;
  const maintenanceDisplay = isCoinMargined
    ? `${formatCoinAmount(maintenanceCoin, baseCoin)} ≈ ${formatUSDT(totalMaintenance, 4)} USD`
    : `${formatUSDT(totalMaintenance, 4)} USDT`;
  const equityDisplay = isCoinMargined
    ? `${formatCoinAmount(accountEquityCoin, baseCoin)} ≈ ${formatUSDT(equity, 4)} USD`
    : `${formatUSDT(equity, 4)} USDT`;

  // ===== Handlers =====
  const fillBBO = () => {
    if (currentPrice > 0) setPrice(currentPrice.toFixed(pricePrecision));
  };

  /**
   * 把「未取整的输入数值」按给定折算价折成张。只许在输入变动 / 换算语义
   * 真正改变的时刻调用——张数由此锁定,行情跳动不得触碰。
   */
  const foldContracts = (amt: number, px: number): number => {
    if (!isCoinMargined || !(amt > 0) || !(px > 0)) return 0;
    if (currencyUnit === 'BASE') return coinContractsExact(amt);
    const notionalUsd = usdtInputMode === 'ORDER_VALUE'
      ? amt * px             // 币金额：币 × 价 = 名义
      : amt * px * leverage; // 币保证金：保证金 × 价 × 杠杆 = 名义
    return coinContractsExactFromUsdNotional(notionalUsd, symbol, contractSizeUsd);
  };
  const updateQuantity = (raw: string) => {
    setQuantity(raw);
    if (!isCoinMargined) return;
    const amt = parseFloat(raw) || 0;
    lockFoldRef.current = { raw: amt, price: effectivePrice };
    setLockedContracts(foldContracts(amt, effectivePrice));
  };

  /**
   * 只有换算语义**真正改变**时才重折,并且按「变了的是谁」分流:
   *   · 杠杆变 · 币金额档  → 杠杆不进该档映射,跳过——否则动一下杠杆就等于
   *     用实时价重掷一次骰子,原事故换个扳机重演;
   *   · 杠杆变 · 保证金档  → 语义真变,但折算价沿用锁定价:只让杠杆增量进来;
   *   · 限价框的数变       → 用户给了新的折算价,按它重折并更新锁定价;
   *   · 限价⇄市价切换      → 限价框为空时两边同为实时价 fallback,语义未变,跳过;
   *     框里有数时价格基准真的换了,按当前基准重折。
   * 重折一律从 lockFoldRef 的未取整数值出发。依赖里刻意没有 currentPrice。
   */
  const prevFoldDeps = useRef({ leverage, authoredPrice, priceSelection, orderType });
  /**
   * 本帧是否**正欠一次重折**。重折在 effect 里落地，而 snappedInput 是渲染期算的：
   * 折算基准刚变的那一帧，effectivePrice 已经是新价、lockedContracts 还是旧值，
   * 两者相乘出来的 snappedInput 属于一个不存在的状态。让同步 effect 写下去就会
   * 出现「框里躺着 892.936869、锁却是 0 张、提示写着『请至少填 892.936869』、按钮还是灰的」。
   * prevFoldDeps 在重折 effect 的**开头**更新，所以这一帧读到的仍是旧值——正好当闸门。
   */
  const foldBasisChanged =
    prevFoldDeps.current.leverage !== leverage
    || prevFoldDeps.current.authoredPrice !== authoredPrice
    || prevFoldDeps.current.priceSelection !== priceSelection
    || prevFoldDeps.current.orderType !== orderType;
  useEffect(() => {
    const prev = prevFoldDeps.current;
    prevFoldDeps.current = { leverage, authoredPrice, priceSelection, orderType };
    if (!isCoinMargined || currencyUnit === 'BASE') return;
    const leverageChanged = prev.leverage !== leverage;
    const priceStrChanged = prev.authoredPrice !== authoredPrice;
    const selChanged = prev.priceSelection !== priceSelection || prev.orderType !== orderType;
    if (!leverageChanged && !priceStrChanged && !selChanged) return;
    if (leverageChanged && !priceStrChanged && !selChanged && usdtInputMode === 'ORDER_VALUE') return;
    const authoredEmpty = !(parseFloat(authoredPrice) > 0);
    if (selChanged && !priceStrChanged && !leverageChanged && authoredEmpty) return;

    const { raw, price: foldPrice } = lockFoldRef.current;
    const nextPrice = (priceStrChanged || selChanged)
      ? effectivePrice                    // 价格基准被用户改了:用新基准
      : (foldPrice > 0 ? foldPrice : effectivePrice); // 只动了杠杆:沿用锁定价
    lockFoldRef.current = { raw, price: nextPrice };
    setLockedContracts(foldContracts(raw, nextPrice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leverage, authoredPrice, priceSelection, orderType]);

  /**
   * 未聚焦时，把输入框持续同步成「锁定张数在当前价下的等值」。
   *
   * 币本位的「币数」随价浮动是物理事实：4 张 = 40 USD 面值，折成币 = 40 ÷ 现价。
   * 此前只在失焦那一刻吸附一次，于是框里冻着吸附时刻的数（95.417571 @0.419209），
   * 而提示与当前委托跟着现价走（95.330021 @0.419595）——同一屏上两个数，
   * 正是用户反复报的「下单币数与当前委托显示的不一样」。
   *
   * 只改显示，**绝不碰折算源**。lockFoldRef.raw 始终是用户亲手写下的那个授权量。
   *
   * 早先这里把吸附值写回了折算源，于是折算源永远停在「整张数的边界」上：
   * 40 USD ÷ 0.0113 = 3539.823009。此后任何一次往低价的重折都必掉一张
   * （3539.823009 × 0.011199 ÷ 10 = 3.964 → 3），而且是单向棘轮——
   * 点开「条件委托」瞄一眼再点回「限价」，40 USD 的单子变 30 USD，
   * 再切两次只剩 10 USD，屏幕上没有任何一处说过数量变了。
   * 保留原始授权量 3600 则每次都折回 4 张，切多少次都一样。
   */
  useEffect(() => {
    if (qtyFocused || foldBasisChanged || snappedInput == null || snappedInput === quantity) return;
    setQuantity(snappedInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtyFocused, foldBasisChanged, snappedInput]);

  /**
   * 仓位比例一律**向下**取整：toFixed 是四舍五入，100% 会被进位推过分层上限，
   * 面板随即把自己刚填的单标红（45,871.559 → 45,871.6 = 50,000.04 USDT）。
   */
  const floorToDecimals = (value: number, decimals: number) => {
    const f = 10 ** decimals;
    return Math.max(0, Math.floor(value * f + 1e-9) / f);
  };
  /** 分段订单的张数取到笔数的整数倍：引擎按 round(张数 ÷ 笔数) 拆子单，不整除时会多出几张。 */
  const scaledSafeContracts = (contracts: number) => {
    const n = parseInt(scaledCount) || 5;
    return orderType === 'SCALED' && n >= 2 ? Math.floor(contracts / n) * n : contracts;
  };
  /** U 本位的金额 / 保证金档：面板按折算价把币数换成金额（引擎按 placementUnits 的单价估值，分段 / 跟踪 / 穿价限价会不同）。 */
  const coinsToInputUsdt = (coins: number) => (effectivePrice > 0 ? coins * effectivePrice : 0);
  const applyPercent = (p: number) => {
    setPercent(p);
    if (currencyUnit === 'USDT') {
      if (isCoinMargined) {
        // 先定张数、再折显示值。顺序反过来（先折币串再转回张）会在 toFixed
        // 的最后一位上掉一张——0.532 张的世界里六位小数不是免费的。
        const c = scaledSafeContracts(Math.max(0, Math.floor((maxNotional * (p / 100)) / contractSizeUsd)));
        setLockedContracts(c);
        const exact = c > 0 && effectivePrice > 0
          ? coinNotionalUsd(c, contractSizeUsd)
            / (usdtInputMode === 'ORDER_VALUE' ? effectivePrice : effectivePrice * leverage)
          : 0;
        lockFoldRef.current = { raw: exact, price: effectivePrice };
        setQuantity(exact > 0 ? exact.toFixed(6) : '0');
      } else {
        // 初始保证金档的 100% = 可开金额 ÷ 杠杆：分层没卡住时就是可用余额本身。
        const value = coinsToInputUsdt(maxBaseCoins);
        const target = usdtInputMode === 'ORDER_VALUE' ? value : value / Math.max(1, leverage);
        setQuantity(floorToDecimals(target * (p / 100), 2).toFixed(2));
      }
    } else {
      if (isCoinMargined) {
        const targetContracts = scaledSafeContracts(Math.max(0, Math.floor((maxNotional * (p / 100)) / contractSizeUsd)));
        setQuantity(String(targetContracts));
      } else {
        setQuantity(floorToDecimals(maxBaseCoins * (p / 100), quantityPrecision).toFixed(quantityPrecision));
      }
    }
  };

  /**
   * 「可开」按输入框当前那一档的单位报（与 100% 按钮填进去的数同一个折法，只往下取整）：
   *   币本位：张 / 币金额（整张 × 面值 ÷ 折算价）/ 币保证金（再 ÷ 杠杆），小字附张数与 USD 名义；
   *   U 本位：币数（按引擎单价、数量精度）/ USDT 金额 / USDT 保证金，币数档小字附 USDT 名义。
   */
  const maxOpenLabel = (side: OrderSide): { main: string; sub: string | null } => {
    const usd = maxNotionalBySide[side];
    const notional = Number.isFinite(usd) ? Math.max(0, usd) : NaN;
    if (!Number.isFinite(notional)) return { main: '--', sub: null };
    if (isCoinMargined) {
      const c = scaledSafeContracts(Math.floor(notional / contractSizeUsd + 1e-9));
      const usdText = `${formatUSDT(c * contractSizeUsd)} USD`;
      if (coinInputUnit === 'CONTRACTS') return { main: `${c.toLocaleString('en-US')} 张`, sub: usdText };
      const coins = effectivePrice > 0 ? (c * contractSizeUsd) / effectivePrice : NaN;
      if (!Number.isFinite(coins)) return { main: `${c.toLocaleString('en-US')} 张`, sub: usdText };
      const coinText = coinInputUnit === 'COIN_MARGIN'
        ? `${formatAmount(floorToDecimals(coins / Math.max(1, leverage), 6), 6)} ${baseCoin} 保证金`
        : `${formatAmount(floorToDecimals(coins, 6), 6)} ${baseCoin}`;
      return { main: coinText, sub: `${c.toLocaleString('en-US')} 张 · ${usdText}` };
    }
    const unit = placementUnits[side].unitUsd;
    if (!(unit > 0)) return { main: `${formatUSDT(notional)} USDT`, sub: null };
    const coins = notional / unit;
    if (currencyUnit === 'BASE') {
      return { main: `${formatAmount(floorToDecimals(coins, quantityPrecision), quantityPrecision)} ${baseCoin}`, sub: `${formatUSDT(notional)} USDT` };
    }
    if (usdtInputMode === 'INITIAL_MARGIN') {
      return { main: `${formatUSDT(floorToDecimals(coinsToInputUsdt(coins) / Math.max(1, leverage), 2))} USDT 保证金`, sub: null };
    }
    return { main: `${formatUSDT(floorToDecimals(coinsToInputUsdt(coins), 2))} USDT`, sub: null };
  };

  const selectCoinInputUnit = (unit: CoinInputUnit) => {
    const hasExistingOrder = effectiveQty > 0 && Number.isFinite(effectiveQty);
    if (unit === 'CONTRACTS') {
      setCurrencyUnit('BASE');
      setUsdtInputMode('ORDER_VALUE');
      setQuantity(hasExistingOrder ? String(coinContractsExact(effectiveQty)) : '');
    } else if (unit === 'COIN_NOTIONAL') {
      setCurrencyUnit('USDT');
      setUsdtInputMode('ORDER_VALUE');
      // 切档不改张数：锁直接沿用当前张数,显示值从它折出——
      // 走「折成币串再转回张」的字符串来回会在 toFixed 上丢一张。
      setLockedContracts(hasExistingOrder ? effectiveQty : 0);
      const coinNotional = effectivePrice > 0
        ? coinNotionalUsd(effectiveQty, contractSizeUsd) / effectivePrice
        : 0;
      lockFoldRef.current = { raw: hasExistingOrder ? coinNotional : 0, price: effectivePrice };
      setQuantity(hasExistingOrder ? coinNotional.toFixed(6) : '');
    } else {
      setCurrencyUnit('USDT');
      setUsdtInputMode('INITIAL_MARGIN');
      setLockedContracts(hasExistingOrder ? effectiveQty : 0);
      const nextMarginCoin = hasExistingOrder
        ? coinMarginAmount(effectiveQty, effectivePrice, leverage, contractSizeUsd)
        : 0;
      lockFoldRef.current = { raw: nextMarginCoin, price: effectivePrice };
      setQuantity(hasExistingOrder ? nextMarginCoin.toFixed(6) : '');
    }
    setPercent(0);
    setShowCurrencySelector(false);
  };

  /**
   * 单位偏好卡片 —— 与币安同构：
   *   卡片一 = 标的自身的计量单位（U 本位为币、币本位为张）；
   *   卡片二 = 保证金资产，内含「订单金额 / 初始保证金」两个常驻子选项。
   * 两种结算方式共用同一套结构，位置也一致（锚在数量框下方）。
   */
  const unitOptions = isCoinMargined
    ? [
        {
          key: 'CONTRACTS',
          label: '张',
          desc: `输入并显示合约张数；1 张 = ${contractSizeUsd} USD 面值。`,
          select: () => selectCoinInputUnit('CONTRACTS'),
        },
        {
          key: 'COIN',
          label: baseCoin,
          desc: `输入并显示 ${baseCoin} 的订单金额。如需使用初始保证金下单，请选择「初始保证金」选项，并输入相应金额。`,
          select: () => selectCoinInputUnit('COIN_NOTIONAL'),
          subModes: [
            { value: 'ORDER_VALUE' as UsdtInputMode, label: '订单金额', select: () => selectCoinInputUnit('COIN_NOTIONAL') },
            { value: 'INITIAL_MARGIN' as UsdtInputMode, label: '初始保证金', select: () => selectCoinInputUnit('COIN_MARGIN') },
          ],
        },
      ]
    : [
        {
          key: 'BASE',
          label: baseCoin,
          desc: `输入并显示 ${baseCoin} 的订单金额。`,
          select: () => { setCurrencyUnit('BASE'); setUsdtInputMode('ORDER_VALUE'); setQuantity(''); setPercent(0); setShowCurrencySelector(false); },
        },
        {
          key: 'USDT',
          label: 'USDT',
          desc: '输入并显示 USDT 的订单金额。如需使用初始保证金下单，请选择「初始保证金」选项，并输入相应金额。',
          select: () => { setCurrencyUnit('USDT'); setUsdtInputMode('ORDER_VALUE'); setQuantity(''); setPercent(0); setShowCurrencySelector(false); },
          subModes: [
            {
              value: 'ORDER_VALUE' as UsdtInputMode,
              label: '订单金额',
              select: () => { setCurrencyUnit('USDT'); setUsdtInputMode('ORDER_VALUE'); setQuantity(''); setPercent(0); setShowCurrencySelector(false); },
            },
            {
              value: 'INITIAL_MARGIN' as UsdtInputMode,
              label: '初始保证金',
              select: () => { setCurrencyUnit('USDT'); setUsdtInputMode('INITIAL_MARGIN'); setQuantity(''); setPercent(0); setShowCurrencySelector(false); },
            },
          ],
        },
      ];
  const activeUnitKey = isCoinMargined
    ? (coinInputUnit === 'CONTRACTS' ? 'CONTRACTS' : 'COIN')
    : (currencyUnit === 'BASE' ? 'BASE' : 'USDT');

  /**
   * 加仓计算器的「按上限下单」：整张的上限（U 本位是币数）连同下单方式预填进来。
   * 币本位一律切到「张」档——张数是唯一真源，直接写整张就不会再被另一个价折一次；
   * 限价计划把挂单价一并填进限价框；条件单计划切到高级槽的「条件委托」并填好触发价。
   * 只应用一次（consumeAddSizingPrefill），之后用户随便改。
   * 方向不在面板状态里（开多 / 开空是两个按钮），计划本身带着方向，下单入口按方向匹配。
   *
   * 两处取整**只往安全侧**：上限是授权额度，进一那一点是规则没批的量。
   *   · 限价：多头向下、空头向上取到面板的价格精度（计算器已按同一精度取整定量，这里是兜底）；
   *   · U 本位币数：按数量精度向下取整（币本位的张数计算器已向下取整）。
   * 结算方式跟计划走（计划跟被加仓的仓位走）：面板不同就先切过去（仅本会话），切换那一帧会清空数量，
   * 下一帧再预填；切不过去就说明原因、放弃这次预填，不留一个空数量让人对着按钮发呆。
   */
  const addSizingPrefill = useAddSizingPrefill(symbol);
  const prefillSeq = addSizingPrefill?.seq ?? null;
  const prefillSwitchRef = useRef<number | null>(null);
  useEffect(() => {
    if (!addSizingPrefill) return;
    const { seq, prefill } = addSizingPrefill;
    if ((prefill.settlement === 'coin') !== isCoinMargined) {
      if (prefillSwitchRef.current !== seq) {
        prefillSwitchRef.current = seq;
        ctx.setSymbolSettlementMode(symbol, prefill.settlement);
        return;
      }
      toast.error('加仓计划未能预填', {
        description: `计划按${prefill.settlement === 'coin' ? '币本位' : 'U本位'}算（跟被加仓的仓位走），下单面板没能切过去；请手动切换结算方式后按计算器的数下单。`,
      });
      consumeAddSizingPrefill(seq, symbol);
      return;
    }
    setActionMode('OPEN');
    setOrderType(prefill.orderType);
    if (prefill.orderType === 'CONDITIONAL') setAdvancedType('CONDITIONAL');
    setPriceSelection(prefill.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET');
    // 限价挂单价与条件单触发价同一种取整：计算器已按同一精度向有利侧取整定量，这里是兜底
    const fixPrice = (px: number) => {
      const safe = roundLimitPriceFavorable(px, pricePrecision, prefill.side);
      const fixed = Number.isFinite(safe) ? safe.toFixed(pricePrecision) : '';
      return Number(fixed) > 0 ? fixed : String(Number(px.toPrecision(8)));
    };
    if (prefill.orderType === 'LIMIT' && prefill.limitPrice != null && prefill.limitPrice > 0) {
      setPrice(fixPrice(prefill.limitPrice));
    }
    if (prefill.orderType === 'CONDITIONAL' && prefill.triggerPrice != null && prefill.triggerPrice > 0) {
      setStopPrice(fixPrice(prefill.triggerPrice));
    }
    setCurrencyUnit('BASE');
    setUsdtInputMode('ORDER_VALUE');
    setShowCurrencySelector(false);
    if (isCoinMargined) {
      const contracts = Math.max(0, Math.floor(prefill.contracts ?? 0));
      setQuantity(contracts > 0 ? String(contracts) : '');
      lockFoldRef.current = { raw: contracts, price: effectivePrice };
      setLockedContracts(contracts);
    } else {
      const p = Math.max(0, Math.min(12, Math.floor(quantityPrecision)));
      const scale = 10 ** p;
      const coins = prefill.coins > 0 ? Math.floor(prefill.coins * scale + 1e-7) / scale : 0;
      setQuantity(coins > 0 ? coins.toFixed(p) : '');
    }
    setPercent(0);
    consumeAddSizingPrefill(seq, symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillSeq, isCoinMargined, symbol]);

  // ===== Snapshot dialog state (intercepts every order placement) =====
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotSide, setSnapshotSide] = useState<OrderSide>('LONG');
  const [pendingOrderParams, setPendingOrderParams] = useState<PlaceOrderParams | null>(null);
  const [snapshotSimTime, setSnapshotSimTime] = useState<number>(Date.now());
  const [snapshotTimelineId, setSnapshotTimelineId] = useState<string | null>(null);
  const [snapshotEntryPrice, setSnapshotEntryPrice] = useState<number | null>(null);

  const buildOrderParams = (rawSide: OrderSide): PlaceOrderParams | null => {
    // 绝不向上兜底：把「不足一张」放大成一张正是本次要修的东西。
    // 不足一张时 belowMinContract 已经让 orderDisabledFor 为真，走不到这里。
    const finalQty = isCoinMargined ? coinContractsExact(effectiveQty) : effectiveQty;
    if (orderDisabledFor(rawSide) || finalQty <= 0) return null;
    /**
     * 勾选止盈止损**不再改写订单类型**。
     *
     * 此前 MARKET → MARKET_TP_SL、LIMIT → LIMIT_TP_SL，止盈价还顺着
     * `stopPrice || tpTrigger || slTrigger` 兜底链塞进 stopPrice——
     * 而触发价那行输入在市价/限价标签下根本不渲染（类型是提交这一刻才合成的），
     * 所以兜底一定会抓到止盈价。引擎于是把**止盈价当成开仓触发价**：
     * 市价单不再立刻成交、挂到止盈价上开仓；限价单要等价格先摸到止盈价才肯激活。
     * 现在保护价单独传，开仓价与保护价不再共用一个字段。
     */
    const finalType: OrderType = orderType;
    return {
      side: rawSide,
      type: finalType,
      price: priceSelection === 'LIMIT' ? (parseFloat(price) || 0) : 0,
      stopPrice: parseFloat(stopPrice) || 0,
      tpTriggerPrice: enableTpSl && tpSlSupported ? (parseFloat(tpTrigger) || 0) : 0,
      slTriggerPrice: enableTpSl && tpSlSupported ? (parseFloat(slTrigger) || 0) : 0,
      tpSlPercentage: 100,
      quantity: finalQty,
      leverage,
      marginMode,
      settlementMode,
      settlementAsset: isCoinMargined ? baseCoin : 'USDT',
      contractSizeUsd: isCoinMargined ? contractSizeUsd : undefined,
      contracts: isCoinMargined ? finalQty : undefined,
      priceSelection,
      triggerType,
      currencyUnit,
      usdtInputMode,
      inputAmount,
      callbackRate: parseFloat(callbackRate) / 100 || 0.01,
      trailingExecType,
      trailingLimitPrice: parseFloat(trailingLimitPrice) || 0,
      twapDuration: parseFloat(twapDuration) || 60,
      twapInterval: parseFloat(twapInterval) || 5,
      conditionalExecType: condExecType,
      conditionalLimitPrice: parseFloat(condLimitPrice) || 0,
      scaledCount: parseInt(scaledCount) || 5,
      scaledStartPrice: parseFloat(scaledStartPrice) || 0,
      scaledEndPrice: parseFloat(scaledEndPrice) || 0,
    };
  };

  const handleOrder = async (rawSide: OrderSide) => {
    const built = buildOrderParams(rawSide);
    if (!built) return;
    /**
     * 加仓计算器的计划在**点按钮这一刻**就取（只看不消费），随单子参数一路带到下单入口。
     * 决策模式要先填下单前快照，一填半小时并不稀奇；到提交时再去取，计划早过了保鲜期，
     * 这张照计算器预填的单就会悄悄不带计划、成交后也不复判。消费仍在下单入口：单子真的挂出 / 成交才清掉这一份。
     */
    const planned = peekAddSizingSnapshotForOrder({
      symbol, side: rawSide, type: built.type, settlement: built.settlementMode,
    });
    const params: PlaceOrderParams = planned ? { ...built, addSizingSnapshot: planned } : built;
    // 直接交易模式：跳过快照对话框，直接下单。journal 不会被创建，
    // 因此错题集 / 元监控 不会收录；但 tradeHistory 仍记录，可在战役中归类。
    if (ctx.tradingMode === 'direct') {
      try {
        await onPlaceOrder(params);
      } catch (e) {
        console.error('[OrderPanel] direct-mode place order failed', e);
      }
      return;
    }
    setPendingOrderParams(params);
    setSnapshotSide(rawSide);
    setSnapshotSimTime(ctx.getEffectiveTime(symbol));
    // 与锁定的模拟时间同一刻取时间线（弹窗随后会自动暂停，暂停不分叉）。
    setSnapshotTimelineId(ctx.getTimelineId(symbol));
    setSnapshotEntryPrice(ctx.priceMap[symbol] ?? currentPrice ?? null);
    setSnapshotOpen(true);
  };

  /**
   * 随单止盈止损目前只对「成交即建仓、且建的是一个仓位」的类型成立。
   * 分段订单会拆成 N 张子单（每张各自建仓，需要 N 对保护单）、
   * TWAP 的每一片都建一个新仓位且切片成交点没有兑现入口、
   * 跟踪委托的挂单是显式字面量造的，不带附挂字段。
   * 三者此前都能勾上然后被静默丢弃。
   */
  const tpSlSupported = orderType !== 'SCALED' && orderType !== 'TWAP' && orderType !== 'TRAILING_STOP';

  const isPrimaryTab = PRIMARY_ORDER_TABS.some(t => t.value === orderType);
  // 第三槽显示当前选中的高级类型名；正在使用高级类型时该槽为激活态
  const advancedActive = !isPrimaryTab;
  const advancedLabel = ADVANCED_ORDER_TYPES.find(t => t.value === advancedType)?.label ?? '条件委托';
  const activeTypeHint = ADVANCED_ORDER_TYPES.find(t => t.value === orderType)?.hint
    ?? (orderType === 'MARKET' ? '以当前市场最优价格立即成交。' : '以指定价格或更优价格成交。');

  // 限价输入只属于限价系（限价 / 只做Maker / 限价止盈止损）；
  // 市价系与「触发后按市价执行」的高级类型（条件 / 跟踪 / TWAP / 分段用区间价）都不显示
  const showLimitPriceField = orderType === 'LIMIT' || orderType === 'POST_ONLY' || orderType === 'LIMIT_TP_SL';

  return (
    <div className="flex flex-col h-full min-h-0 w-full min-w-[300px] bg-card text-foreground font-sans">
      {/* ============ TOP STATUS BADGES (frozen) ============ */}
      <div className="flex-none flex items-center gap-1.5 px-3 pt-2.5 pb-2">
        <button
          onClick={() => ctx.setSymbolMarginMode(symbol, marginMode === 'isolated' ? 'cross' : 'isolated')}
          className="px-2 py-0.5 rounded bg-secondary hover:bg-accent text-[11px] text-foreground transition-colors"
        >
          {marginMode === 'isolated' ? '逐仓' : '全仓'}
        </button>
        {/**
          * 与持仓卡上的「杠杆」按钮是**同一个**对话框、同一个 applySymbolLeverage。
          * 于是「改了下单模块的杠杆，持仓也跟着改」是结构上成立的，
          * 不存在只改一边的路径。原来那个 prompt() 只写 leverageMap，
          * 持仓纹丝不动，而且它连强平价前后对比都渲染不出来。
          */}
        <button
          data-testid="order-leverage"
          onClick={() => setLeverageModalOpen(true)}
          className="px-2 py-0.5 rounded bg-secondary hover:bg-accent text-[11px] text-foreground transition-colors"
        >
          {leverage}x
        </button>
        <button
          onClick={() => {
            const next = isCoinMargined ? 'usdt' : 'coin';
            ctx.setSymbolSettlementMode(symbol, next);
            setQuantity('');
            setPercent(0);
            setCurrencyUnit('USDT');
            setUsdtInputMode('ORDER_VALUE');
          }}
          className="px-2 h-[22px] flex items-center justify-center rounded bg-secondary hover:bg-accent text-[11px] text-foreground/90 transition-colors"
          title="合约结算方式"
        >
          {isCoinMargined ? '币本位' : 'U本位'}
        </button>

        <button
          type="button"
          data-testid="open-trading-prefs"
          onClick={() => setPrefsOpen(true)}
          title="交易偏好"
          aria-label={notifications.unreadCount > 0
            ? `交易偏好（${notifications.unreadCount} 条未读消息）`
            : '交易偏好'}
          className="relative ml-auto flex h-[22px] w-[22px] items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
          {/* 提示不再弹出，靠这个角标告诉你「有消息没看」；有未读报错时变红。 */}
          {notifications.unreadCount > 0 && (
            <span
              data-testid="prefs-unread-badge"
              data-has-error={notifications.unreadErrorCount > 0 ? 'true' : 'false'}
              className={`pointer-events-none absolute -right-1.5 -top-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px] font-mono text-[9px] leading-none ${
                notifications.unreadErrorCount > 0
                  ? 'bg-[#F6465D] text-white'
                  : 'bg-muted-foreground/70 text-background'
              }`}
            >
              {notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}
            </span>
          )}
        </button>

      </div>

      {/* ============ OPEN / CLOSE PILL ============ */}
      <div className="flex-none px-3 pb-2">
        <div className="flex bg-secondary rounded-md p-0.5">
          {(['OPEN', 'CLOSE'] as const).map(m => (
            <button
              key={m}
              onClick={() => setActionMode(m)}
              className={`flex-1 py-1 rounded text-[12px] font-medium transition-all ${
                actionMode === m
                  ? 'bg-accent text-card-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'OPEN' ? '开仓' : '平仓'}
            </button>
          ))}
        </div>
      </div>

      {/* ============ 订单类型：限价 | 市价 | <高级槽>（币安式三槽） ============ */}
      <div className="flex-none px-3 pb-1 flex items-center gap-3 text-[12px] border-b border-border">
        {PRIMARY_ORDER_TABS.map(t => {
          const active = orderType === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setOrderType(t.value)}
              className={`relative pb-1.5 transition-colors ${
                active ? 'text-card-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-primary rounded-full" />}
            </button>
          );
        })}
        <div className="relative" ref={orderTypeMenuRef}>
          <button
            data-testid="advanced-type-slot"
            onClick={() => setShowOrderTypeMenu(v => !v)}
            className={`relative pb-1.5 flex items-center gap-0.5 transition-colors ${
              advancedActive ? 'text-card-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {advancedLabel}
            <ChevronDown className={`w-3 h-3 transition-transform ${showOrderTypeMenu ? 'rotate-180' : ''}`} />
            {advancedActive && <span className="absolute left-0 right-3 -bottom-px h-[2px] bg-primary rounded-full" />}
          </button>
          {showOrderTypeMenu && (
            <div data-testid="advanced-type-menu" className="absolute z-40 top-full mt-1 left-0 min-w-[188px] rounded-md border border-border bg-popover py-1 shadow-xl">
              {ADVANCED_ORDER_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => { setAdvancedType(t.value); setOrderType(t.value); setShowOrderTypeMenu(false); }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-foreground/90 transition-colors hover:bg-secondary"
                  title={t.hint}
                >
                  {t.label}
                  {advancedType === t.value && advancedActive && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <span
          className="ml-auto pb-1.5 text-muted-foreground/70"
          title={activeTypeHint}
          aria-label="订单类型说明"
        >
          <Info className="h-3.5 w-3.5" />
        </span>
      </div>

      {/* ============ MAIN BODY (independent scroll area) ============ */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-[#2b3139] scrollbar-track-transparent px-3 pt-2.5 pb-6 space-y-2.5">

        {/* Available balance row */}
        <div className="flex items-center justify-between text-[12px]">
          <div className="text-muted-foreground">
            可用{' '}
            {isCoinMargined ? (
              <>
                <span className="text-foreground font-mono tabular-nums">{formatCoinAmount(availableCoin, baseCoin)}</span>
                <span className="text-muted-foreground/60 ml-1">≈ {formatUSDT(available)} USD</span>
              </>
            ) : (
              <>
                <span className="text-foreground font-mono tabular-nums">{formatUSDT(available)}</span>
                <span className="text-muted-foreground/80 ml-1">USDT</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <button className="hover:text-foreground transition-colors" title="资金划转">
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
            <button className="hover:text-foreground transition-colors" title="计算器">
              <Calculator className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Limit price input (with BBO button) */}
        {showLimitPriceField && (
          <div className="flex items-stretch gap-1.5 w-full min-w-0">
            <div className="flex flex-1 min-w-0 items-center bg-secondary rounded-md h-9 px-3">
              <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">价格</span>
              <input
                data-testid="order-limit-price"
                type="text"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder={currentPrice > 0 ? currentPrice.toFixed(pricePrecision) : '0.00'}
                className="flex-1 w-full min-w-0 bg-transparent text-right text-[13px] text-foreground font-mono tabular-nums outline-none placeholder:text-muted-foreground/60"
              />
              <span className="text-[11px] text-muted-foreground/80 ml-2 shrink-0">{quoteUnitLabel}</span>
            </div>
            <button
              onClick={fillBBO}
              className="px-2.5 rounded-md bg-secondary hover:bg-accent text-[11px] text-foreground/90 font-medium transition-colors"
              title="Best Bid Offer — 填入当前最新价"
            >
              BBO
            </button>
          </div>
        )}

        {/* Market price hint */}
        {/* 「市价」静态行只属于市价系；高级类型（条件/跟踪/TWAP/分段）不显示价格行——与币安一致 */}
        {(orderType === 'MARKET' || orderType === 'MARKET_TP_SL') && (
          <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
            <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">价格</span>
            <span className="flex-1 min-w-0 text-right text-[13px] text-muted-foreground truncate">市价</span>
            <span className="text-[11px] text-muted-foreground/80 ml-2 shrink-0">{quoteUnitLabel}</span>
          </div>
        )}
        {/* 市价单的预计成交价：引擎按 0.01% + 名义/50亿 滑点成交（calcSlippage，同一个函数），
            3,000 万名义就是 0.6%。提前写在这里，而不是等成交后在记录里发现。方向未定，多空各给一个。
            条件委托触发后同样按市价成交，基准换成触发价（放在触发价那一行下面）。 */}
        {(orderType === 'MARKET' || orderType === 'MARKET_TP_SL') && currentPrice > 0 && (
          <ExpectedFillLine base={currentPrice} notional={notionalValue} pricePrecision={pricePrecision} unitLabel={quoteUnitLabel} />
        )}

        {/* Trigger price (TP/SL or conditional types)；跟踪委托此行是「激活价（可选）」 */}
        {(orderType === 'LIMIT_TP_SL' || orderType === 'MARKET_TP_SL' || orderType === 'CONDITIONAL' || orderType === 'TRAILING_STOP') && (
          <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
            <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">
              {orderType === 'TRAILING_STOP' ? '激活价' : '触发价'}
            </span>
            <input
              data-testid="order-trigger-price"
              type="text"
              value={stopPrice}
              onChange={e => setStopPrice(e.target.value)}
              placeholder={pickMode && crosshairPrice != null ? crosshairPrice.toFixed(pricePrecision) : '0.00'}
              className={`flex-1 w-full min-w-0 bg-transparent text-right text-[13px] text-foreground font-mono tabular-nums outline-none placeholder:text-muted-foreground/60 ${
                pickMode ? 'placeholder:text-primary/70' : ''
              }`}
            />
            <button
              onClick={() => onPickModeChange?.(!pickMode)}
              className={`ml-2 p-0.5 rounded transition-colors shrink-0 ${
                pickMode ? 'text-primary' : 'text-muted-foreground/80 hover:text-foreground/90'
              }`}
              title="从图表取价"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-muted-foreground/80 ml-2 shrink-0">{quoteUnitLabel}</span>
          </div>
        )}
        {orderType === 'CONDITIONAL' && (parseFloat(stopPrice) || 0) > 0 && (
          <ExpectedFillLine
            base={parseFloat(stopPrice)} notional={notionalValue} pricePrecision={pricePrecision} unitLabel={quoteUnitLabel}
            prefix="触发后预计成交"
          />
        )}

        {/* ===== 跟踪委托：回调率 ===== */}
        {orderType === 'TRAILING_STOP' && (
          <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
            <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">回调率</span>
            <input
              data-testid="trailing-callback"
              type="number" inputMode="decimal" min={0.1} max={99} step={0.1}
              value={callbackRate}
              onChange={e => setCallbackRate(e.target.value)}
              placeholder="1"
              className="flex-1 w-full min-w-0 bg-transparent text-right text-[13px] text-foreground font-mono tabular-nums outline-none placeholder:text-muted-foreground/60"
            />
            <span className="text-[11px] text-muted-foreground/80 ml-2 shrink-0">%</span>
          </div>
        )}

        {/* ===== TWAP：总时长 + 快选（币安式 30分/1时/6时/12时） ===== */}
        {orderType === 'TWAP' && (
          <>
            <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
              <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">总时长</span>
              <input
                data-testid="twap-duration"
                type="number" inputMode="numeric" min={5} step={5}
                value={twapDuration}
                onChange={e => setTwapDuration(e.target.value)}
                placeholder="60"
                className="flex-1 w-full min-w-0 bg-transparent text-right text-[13px] text-foreground font-mono tabular-nums outline-none placeholder:text-muted-foreground/60"
              />
              <span className="text-[11px] text-muted-foreground/80 ml-2 shrink-0">分</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {([['30分', 30], ['1时', 60], ['6时', 360], ['12时', 720]] as const).map(([label, mins]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setTwapDuration(String(mins))}
                  className={`h-7 rounded text-[11px] transition-colors ${
                    parseFloat(twapDuration) === mins
                      ? 'bg-accent text-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ===== 分段订单：区间两端价 + 单数 ===== */}
        {orderType === 'SCALED' && (
          <>
            <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
              <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">起始价</span>
              <input
                data-testid="scaled-start"
                type="number" inputMode="decimal" step="any"
                value={scaledStartPrice}
                onChange={e => setScaledStartPrice(e.target.value)}
                placeholder="0.00"
                className="flex-1 w-full min-w-0 bg-transparent text-right text-[13px] text-foreground font-mono tabular-nums outline-none placeholder:text-muted-foreground/60"
              />
              <span className="text-[11px] text-muted-foreground/80 ml-2 shrink-0">{quoteUnitLabel}</span>
            </div>
            <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
              <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">终止价</span>
              <input
                data-testid="scaled-end"
                type="number" inputMode="decimal" step="any"
                value={scaledEndPrice}
                onChange={e => setScaledEndPrice(e.target.value)}
                placeholder="0.00"
                className="flex-1 w-full min-w-0 bg-transparent text-right text-[13px] text-foreground font-mono tabular-nums outline-none placeholder:text-muted-foreground/60"
              />
              <span className="text-[11px] text-muted-foreground/80 ml-2 shrink-0">{quoteUnitLabel}</span>
            </div>
            <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
              <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">单数</span>
              <input
                data-testid="scaled-count"
                type="number" inputMode="numeric" min={2} max={50} step={1}
                value={scaledCount}
                onChange={e => setScaledCount(e.target.value)}
                placeholder="5"
                className="flex-1 w-full min-w-0 bg-transparent text-right text-[13px] text-foreground font-mono tabular-nums outline-none placeholder:text-muted-foreground/60"
              />
              <span className="text-[11px] text-muted-foreground/80 ml-2 shrink-0">张</span>
            </div>
          </>
        )}

        {/* Quantity input with currency unit selector */}
        <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
          <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">数量</span>
          <input
            type="text"
            value={quantity}
            onChange={e => { updateQuantity(e.target.value); setPercent(0); }}
            onFocus={() => setQtyFocused(true)}
            onBlur={() => setQtyFocused(false)}
            data-testid="order-qty-input"
            placeholder="0"
            className="flex-1 w-full min-w-0 bg-transparent text-right text-[13px] text-foreground font-mono tabular-nums outline-none placeholder:text-muted-foreground/60"
          />
          <Popover open={showCurrencySelector} onOpenChange={setShowCurrencySelector}>
            <PopoverTrigger asChild>
              <button
                data-testid="unit-preference-trigger"
                className="ml-2 flex items-center gap-0.5 text-[11px] text-foreground/90 hover:text-foreground shrink-0"
              >
                {unitLabel} <ChevronDown className="w-3 h-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              collisionPadding={12}
              data-testid="unit-preference"
              className="w-[320px] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain border-border bg-card p-3"
            >
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">单位偏好</div>
              <div className="space-y-2">
                {unitOptions.map(option => {
                  const active = option.key === activeUnitKey;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      data-testid={`unit-card-${option.key}`}
                      aria-pressed={active}
                      onClick={() => option.select()}
                      className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-foreground/70 bg-secondary/40'
                          : 'border-border hover:bg-secondary/30'
                      }`}
                    >
                      <div className="text-sm font-medium text-foreground">{option.label}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">{option.desc}</p>
                      {option.subModes && (
                        <div className="mt-2 flex gap-4">
                          {option.subModes.map(sub => {
                            const subActive = active && sub.value === usdtInputMode;
                            return (
                              <span
                                key={sub.value}
                                role="radio"
                                aria-checked={subActive}
                                data-testid={`unit-sub-${sub.value}`}
                                onClick={event => { event.stopPropagation(); sub.select(); }}
                                className="flex cursor-pointer items-center gap-1.5"
                              >
                                <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                                  subActive ? 'border-primary' : 'border-muted-foreground/50'
                                }`}>
                                  {subActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                </span>
                                <span className={`text-xs ${subActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                                  {sub.label}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* 币本位的下单量只能是整数张（面值锁在 USD），所以输入几乎总要被取整。
            以前取整是静默的，还会把「不足一张」放大成一张——用户看到的数和
            成交的数不是一个。这里把两种情况都说出来。 */}
        {belowMinContract && (
          <div
            data-testid="coin-min-order-hint"
            className="mt-1 text-[10px] leading-4 text-trading-red"
          >
            低于最小下单量：1 张 = {formatUSDT(contractSizeUsd)} USD
            ≈ {formatCoinAmount(minCoinPerContract, baseCoin)}
            {'（按'}{orderPriceKindLabel(priceRef.kind)}{'）'}
            {'，请至少填 '}
            {coinInputUnit === 'CONTRACTS' ? '1' : minInputInCurrentUnit.toFixed(6)}
            {' '}{minInputUnitLabel}
          </div>
        )}
        {!belowMinContract && isCoinMargined && inputAmount > 0 && effectiveQty > 0 && (
          <div
            data-testid="coin-effective-qty-hint"
            className="mt-1 text-[10px] leading-4 text-muted-foreground/80"
          >
            实际下单 {effectiveQty} 张 ≈ 名义 {formatCoinAmount(effectiveCoinAmount, baseCoin)}
            {' '}≈ {formatUSDT(notionalValue)} USD
            {/* 折算口径必须写在数旁边：同一张单在不同价下是不同的币数，这没错；
                错的是不说按哪个价算的。委托列表那一行用的是同一个标签。 */}
            {'（按'}{orderPriceKindLabel(priceRef.kind)}{'折算）'}
            {coinInputUnit === 'COIN_MARGIN' && (
              <>{'，占用保证金 '}{formatCoinAmount(marginCoin, baseCoin)}</>
            )}
          </div>
        )}

        {/* 币安单笔数量上限：按市价成交的类型常驻一行小字；数量超过上限时换成红色警告，下单按钮置灰 */}
        {lotRefusal ? (
          <div
            data-testid="lot-size-warning"
            className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] bg-trading-red/10 text-trading-red border border-trading-red/30"
          >
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              {lotSize.refusalLead}{lotRefusal.title}
              <span className="block mt-0.5 text-[9px] text-trading-red/70">{lotRefusal.detail}</span>
            </span>
          </div>
        ) : lotCapHint && (
          <div data-testid="lot-size-hint" className="mt-1 text-[10px] leading-4 text-muted-foreground/80">
            {lotCapHint}
          </div>
        )}

        {/* 仓位比例滑条 —— 币安式：菱形锚点常驻、不占一行百分比文字，
            当前比例只在非 0 时以小字浮在右上，避免固定标签占掉纵向空间。 */}
        <div className="px-1 pt-2 pb-1.5">
          <div className="relative h-5 flex items-center">
            <input
              type="range" min={0} max={100} step={1}
              value={percent}
              onChange={e => applyPercent(parseInt(e.target.value))}
              aria-label="仓位比例"
              className="absolute inset-0 w-full h-5 opacity-0 cursor-pointer z-10"
            />
            <div className="relative h-[2px] w-full rounded-full bg-secondary">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-primary"
                style={{ width: `${percent}%` }}
              />
              {[0, 25, 50, 75, 100].map(p => (
                <button
                  key={p}
                  type="button"
                  tabIndex={-1}
                  onClick={() => applyPercent(p)}
                  aria-label={`${p}%`}
                  className={`absolute top-1/2 z-20 h-[7px] w-[7px] rotate-45 -translate-x-1/2 -translate-y-1/2 border transition-colors ${
                    percent >= p
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/40 bg-card'
                  }`}
                  style={{ left: `${p}%` }}
                />
              ))}
              {/* 拖动手柄 */}
              <span
                className="pointer-events-none absolute top-1/2 z-30 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-card shadow-sm"
                style={{ left: `${percent}%` }}
              />
            </div>
          </div>
          {percent > 0 && (
            <div className="mt-0.5 text-right text-[10px] tabular-nums text-primary">{percent}%</div>
          )}
        </div>

        {/* TP/SL + TIF row */}
        <div className="flex items-center justify-between text-[11px]">
          {/* 分段 / TWAP / 跟踪三类不挂随单保护单——它们各自的挂单是显式字面量造的,
              不带 attachedTpSl,而 TWAP 的切片成交点也没有兑现入口。
              勾选框此前对这三类照常渲染、照常可勾、然后**静默丢弃**。
              没做到就别摆在那里:直接不给勾,并把原因写在旁边。 */}
          <label className={`flex items-center gap-1.5 text-foreground/90 ${
            tpSlSupported ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
          }`}>
            <input
              type="checkbox"
              data-testid="enable-tpsl"
              checked={enableTpSl && tpSlSupported}
              disabled={!tpSlSupported}
              onChange={e => setEnableTpSl(e.target.checked)}
              className="w-3 h-3 accent-primary"
            />
            <span>止盈/止损{!tpSlSupported && <span className="ml-1 text-muted-foreground/70">（该类型不支持）</span>}</span>
          </label>

          <div className="relative" ref={tifMenuRef}>
            <button
              onClick={() => setShowTifMenu(s => !s)}
              className="flex items-center gap-0.5 text-foreground/90 hover:text-foreground"
            >
              {tif} <ChevronDown className="w-3 h-3" />
            </button>
            {showTifMenu && (
              <div className="absolute z-40 right-0 top-full mt-1 min-w-[120px] rounded-md border border-border bg-popover shadow-xl">
                {(['GTC', 'IOC', 'FOK'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => { setTif(t); setShowTifMenu(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-secondary ${
                      tif === t ? 'text-primary' : 'text-foreground/90'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Inline TP/SL trigger fields */}
        {enableTpSl && tpSlSupported && (
          <div className="space-y-1.5">
            <div className="flex items-center bg-secondary rounded-md h-8 px-3">
              <span className="text-[11px] text-trading-green mr-2">止盈</span>
              <input
                type="text" value={tpTrigger} onChange={e => setTpTrigger(e.target.value)}
                placeholder="触发价"
                className="flex-1 bg-transparent text-right text-[12px] text-foreground font-mono outline-none placeholder:text-muted-foreground/60"
              />
              <span className="text-[11px] text-muted-foreground/80 ml-2">{quoteUnitLabel}</span>
            </div>
            <div className="flex items-center bg-secondary rounded-md h-8 px-3">
              <span className="text-[11px] text-trading-red mr-2">止损</span>
              <input
                type="text" value={slTrigger} onChange={e => setSlTrigger(e.target.value)}
                placeholder="触发价"
                className="flex-1 bg-transparent text-right text-[12px] text-foreground font-mono outline-none placeholder:text-muted-foreground/60"
              />
              <span className="text-[11px] text-muted-foreground/80 ml-2">{quoteUnitLabel}</span>
            </div>
          </div>
        )}

        {/* 分层上限：持仓 + 当前委托 + 这一单 超过当前杠杆的最高可持有头寸 */}
        {leverageExceeded && (
          <div
            data-testid="position-limit-warning"
            className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] bg-trading-red/10 text-trading-red border border-trading-red/30"
          >
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              {limitWarningText}
              {tierNote && (
                <span data-testid="position-limit-note" className="block mt-0.5 text-[9px] text-trading-red/70">{tierNote}</span>
              )}
            </span>
          </div>
        )}

        {/* 只靠对冲旧仓位的豁免放行：按旧模型开 */}
        {legacyHedgeNote && (
          <div data-testid="legacy-hedge-note" className="px-2 py-1 rounded text-[10px] bg-muted/40 text-muted-foreground border border-border">
            {legacyHedgeNote}
          </div>
        )}

        {/* 维持保证金口径不同：这一单不与同方向仓位合并，各算各的强平价 */}
        {mergeModelNote && (
          <div data-testid="merge-model-note" className="px-2 py-1 rounded text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            {mergeModelNote}
          </div>
        )}

        {/* 已挂的触发类开仓单：这张单下出去后，它们触发时会被分层上限拒掉（只提醒，不拦——币安也不拦） */}
        {triggerRiskWarning && (
          <div
            data-testid="trigger-risk-warning"
            className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30"
          >
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="space-y-0.5">
              {triggerRiskWarning.map(r => (
                <span key={r.title} className="block">
                  <span className="block">{r.title}</span>
                  <span className="block text-[9px] opacity-80">{r.description}</span>
                </span>
              ))}
            </span>
          </div>
        )}

        {/* ===== ACTION BUTTONS + PRE-TRADE INFO ===== */}
        <div className="grid grid-cols-2 gap-2 pt-1 w-full min-w-0">
          <button
            onClick={() => handleOrder('LONG')}
            disabled={orderDisabledFor('LONG')}
            className="w-full min-w-0 h-10 px-1 rounded-md bg-trading-green hover:bg-trading-green/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-all truncate"
          >
            {coolingOff ? '🧊 冷静中' : (actionMode === 'OPEN' ? '开多' : '平空')}
          </button>
          <button
            onClick={() => handleOrder('SHORT')}
            disabled={orderDisabledFor('SHORT')}
            className="w-full min-w-0 h-10 px-1 rounded-md bg-trading-red hover:bg-trading-red/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-all truncate"
          >
            {coolingOff ? '🧊 冷静中' : (actionMode === 'OPEN' ? '开空' : '平多')}
          </button>
        </div>

        {/* Pre-trade calculation: left aligned for LONG, right aligned for SHORT */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono tabular-nums">
          {(['LONG', 'SHORT'] as const).map(side => {
            const open = maxOpenLabel(side);
            return (
              <div key={side} className={`${side === 'LONG' ? 'text-left' : 'text-right'} space-y-0.5`}>
                <div className="text-muted-foreground/80">保证金 <span className="text-foreground/90">{marginDisplay}</span></div>
                <div data-testid={`max-open-${side}`} className="text-muted-foreground/80">
                  可开 <span data-testid={`max-open-${side}-main`} className="text-foreground/90">{open.main}</span>
                  {open.sub && <span data-testid={`max-open-${side}-sub`} className="block text-[9px] text-muted-foreground/60">{open.sub}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* TWAP 新手引导（仅 TWAP 类型显示，币安同位） */}
        {orderType === 'TWAP' && (
          <button
            type="button"
            data-testid="twap-guide"
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            title="TWAP（时间加权平均价格）会把订单在总时长内按时间均匀拆成小片、逐片以市价成交，用于摊薄大单的冲击成本。切片间隔由系统按总时长自动决定。"
          >
            <Info className="w-3 h-3" />
            TWAP 新手引导
          </button>
        )}
        {/* 杠杆分层：此前这里标着「手续费等级」，显示的却是杠杆档位——名实不符，改回它真正的内容 */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="leverage-tier-link"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Info className="w-3 h-3" />
              杠杆分层
              <span className="text-muted-foreground/80 ml-0.5">
                · {leverage}x 最高 {formatTierAmount(limitCheck.cap, tierUnit)}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            collisionPadding={12}
            data-testid="leverage-tier-popover"
            className="w-[380px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain border-border bg-card p-3"
          >
            <LeverageTierTable
              resolved={limitCheck.tiers}
              leverage={leverage}
              exposure={Number.isFinite(limitCheck.exposureAfter) ? limitCheck.exposureAfter : null}
            />
          </PopoverContent>
        </Popover>

        {/* ===== ACCOUNT RISK PANEL ===== */}
        <div className="border-t border-border pt-3 mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-foreground">账户</span>
            <button className="text-muted-foreground/80 hover:text-foreground/90" title="切换">
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground/80">保证金比率</span>
            <div className="flex items-center gap-1.5">
              <Gauge className={`w-3.5 h-3.5 ${ratioColor}`} />
              <span data-testid="account-margin-ratio" className={`font-mono tabular-nums ${ratioColor}`}>{marginRatio.toFixed(2)}%</span>
            </div>
          </div>
          {/* mini gauge bar */}
          <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
            <div className={`h-full ${ratioBg} transition-all`} style={{ width: `${Math.min(100, marginRatio)}%` }} />
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] w-full min-w-0">
            <span className="text-muted-foreground/80 shrink-0">维持保证金</span>
            <span data-testid="account-maintenance" className="font-mono tabular-nums text-foreground truncate text-right min-w-0">{maintenanceDisplay}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] w-full min-w-0">
            <span className="text-muted-foreground/80 shrink-0">保证金余额</span>
            <span className="font-mono tabular-nums text-foreground truncate text-right min-w-0">{equityDisplay}</span>
          </div>

          <button className="w-full h-9 mt-1 rounded-md bg-secondary hover:bg-accent text-[12px] text-foreground font-medium transition-colors">
            {isCoinMargined ? `${baseCoin} 币本位保证金模式` : '单币保证金模式'}
          </button>
        </div>
      </div>

      <TradingPreferencesDrawer
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        prefs={tradingPrefs}
        onChange={setTradingPrefs}
        onOpenCoolingOff={onOpenCoolingOff}
        panels={panels}
        onPanelChange={onPanelChange}
      />

      {/* ===== Pre-trade snapshot dialog (hard-gates every order placement) ===== */}
      {leverageModalOpen && (
        <LeverageModal
          symbol={symbol}
          currentLeverage={leverage}
          settlementMode={settlementMode}
          positions={positions}
          orders={symbolOrders}
          markPrice={currentPrice}
          availableBalance={Math.max(0, available)}
          onClose={() => setLeverageModalOpen(false)}
          onConfirm={(next) => {
            // 与对话框同一种结算方式（面板当前的），引擎按它夹值、判定、写回。
            const plan = ctx.applySymbolLeverage(symbol, next, settlementMode);
            if (!plan.ok) { toast.error(plan.refusal?.message ?? '杠杆未调整'); return; }
            toast.success(`杠杆已调整为 ${plan.to}x`, {
              description: plan.totalReleaseUsd > 1e-9
                ? `释放保证金 ${formatUSDT(plan.totalReleaseUsd)} ${quoteUnitLabel}`
                : undefined,
            });
            setLeverageModalOpen(false);
          }}
        />
      )}
      <PreTradeSnapshotDialog
        isOpen={snapshotOpen}
        onOpenChange={(o) => {
          setSnapshotOpen(o);
          if (!o) setPendingOrderParams(null);
        }}
        mode="trade"
        symbol={symbol}
        direction={snapshotSide === 'LONG' ? 'long' : 'short'}
        simulatedTimeMs={snapshotSimTime}
        timelineId={snapshotTimelineId}
        lockedEntryPrice={snapshotEntryPrice}
        leverage={leverage}
        marginMode={marginMode}
        pricePrecision={pricePrecision}
        orderParams={pendingOrderParams}
        initialPositionSizeUsdt={(() => {
          if (!pendingOrderParams) return null;
          const p = snapshotEntryPrice ?? currentPrice ?? 0;
          if (pendingOrderParams.settlementMode === 'coin') {
            return coinNotionalUsd(
              pendingOrderParams.contracts ?? pendingOrderParams.quantity,
              pendingOrderParams.contractSizeUsd ?? contractSizeUsd,
            );
          }
          return p > 0 ? Number((pendingOrderParams.quantity * p).toFixed(2)) : null;
        })()}
        onAutoPause={onAutoPauseTimeMachine}
        onPlaceOrder={async (params) => {
          const result = await onPlaceOrder(params);
          if (result && typeof result === 'object' && 'id' in result) {
            return result as { id: string };
          }
          // null = 引擎拒单；不回报结果的回调（void）照旧当作下出去了、只是没有可关联的 id。
          return result === undefined ? { id: '' } : null;
        }}
      />
    </div>
  );
}

// ===== Reusable: Bottom Sheet Overlay =====

/**
 * 预计成交价一行：引擎的 Taker 滑点（calcSlippage，同一个函数）在基准价上给出多 / 空两个成交价。
 * 市价单的基准是现价，条件委托的基准是触发价（触发后按市价成交）。
 */
function ExpectedFillLine({ base, notional, pricePrecision, unitLabel, prefix = '预计成交' }: {
  base: number; notional: number; pricePrecision: number; unitLabel: string; prefix?: string;
}) {
  const longFill = calcSlippage(base, notional, 'LONG');
  const shortFill = calcSlippage(base, notional, 'SHORT');
  const slipPct = (longFill / base - 1) * 100;
  const fmtFill = (v: number) => (Math.abs(v) >= 1 ? v.toFixed(Math.max(2, Math.min(pricePrecision, 6))) : v.toPrecision(6));
  return (
    <div data-testid="order-expected-fill" className="px-1 text-[10px] leading-4 text-muted-foreground/80 tabular-nums">
      {prefix}（滑点 ±{slipPct.toFixed(2)}%）开多 ≈ {fmtFill(longFill)} · 开空 ≈ {fmtFill(shortFill)}
      {notional > 0 ? `，名义 ${formatUSDT(notional)} ${unitLabel}` : ''}
    </div>
  );
}
