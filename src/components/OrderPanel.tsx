import { useState, useRef, useEffect, useMemo } from 'react';
import type { OrderSide, OrderType } from '@/types/trading';
import { ORDER_TYPE_INFO, getMaxLeverageForNotional, getLeverageTierInfo, MAINTENANCE_MARGIN_RATE, calcUnrealizedPnl } from '@/types/trading';
import { ChevronDown, Check, AlertTriangle, Crosshair, ArrowLeftRight, Calculator, Gauge, Info, MoreHorizontal } from 'lucide-react';
import { TradingPreferencesDrawer } from '@/components/TradingPreferencesDrawer';
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
import { formatUSDT } from '@/lib/formatters';
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
import {
  getPositionNotionalUsd,
} from '@/lib/tradingSettlement';

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
 * 止盈止损不占标签位：币安把 TP/SL 做成限价/市价表单里的勾选项（本面板已有），
 * LIMIT_TP_SL / MARKET_TP_SL 由勾选组合出，不再单列。
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
      totalMaintenance += getPositionNotionalUsd(posSymbol, p, mark) * MAINTENANCE_MARGIN_RATE;
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
    ctx.setSymbolLeverage(symbol, clampPrefLeverage(tradingPrefs.defaultLeverage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tradingPrefs.useDefaultLeverage, tradingPrefs.defaultLeverage]);

  // 换标的或切结算方式时，数量单位回到该模式的原生单位并清空输入——
  // 否则「5,000,000」这种数字会带着上一个模式的语义留在框里，极易误读。
  useEffect(() => {
    setCurrencyUnit('USDT');
    setUsdtInputMode('ORDER_VALUE');
    setQuantity('');
    setLockedContracts(0);
    setPercent(0);
  }, [isCoinMargined, symbol]);

  // Sync priceSelection ↔ orderType
  useEffect(() => {
    if (orderType === 'MARKET' || orderType === 'MARKET_TP_SL') setPriceSelection('MARKET');
    else if (orderType === 'LIMIT' || orderType === 'POST_ONLY' || orderType === 'LIMIT_TP_SL') setPriceSelection('LIMIT');
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
  const effectivePrice = priceSelection === 'LIMIT' ? (parseFloat(price) || currentPrice) : currentPrice;

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
    marginCoin = coinMarginAmount(effectiveQty, effectivePrice, leverage, contractSizeUsd);
    margin = marginCoin * effectivePrice;
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

  const maxAllowedLeverage = getMaxLeverageForNotional(notionalValue);
  const leverageExceeded = leverage > maxAllowedLeverage && notionalValue > 0;
  const tierInfo = getLeverageTierInfo(notionalValue);
  // belowMinContract 此前是死代码：roundCoinContracts 只会返回 0 或 ≥1，
  // 永远落不进 (0,1)，所以「不足一张」从来没被拦住过，而是被放大成一张下出去。
  // 换成 coinContractsExact 之后这条守卫才真正活了。
  const orderDisabled = disabled || leverageExceeded || !!coolingOff || belowMinContract;

  // Max buy/sell capacity in USDT (notional)
  const maxNotional = Math.max(0, available) * leverage;
  const availableCoin = effectivePrice > 0 ? Math.max(0, available) / effectivePrice : 0;
  const accountEquityCoin = effectivePrice > 0 ? Math.max(0, equity) / effectivePrice : 0;
  const maintenanceCoin = effectivePrice > 0 ? Math.max(0, totalMaintenance) / effectivePrice : 0;
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
  const maxNotionalUnit = isCoinMargined ? 'USD' : 'USDT';
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
  const prevFoldDeps = useRef({ leverage, price, priceSelection });
  useEffect(() => {
    const prev = prevFoldDeps.current;
    prevFoldDeps.current = { leverage, price, priceSelection };
    if (!isCoinMargined || currencyUnit === 'BASE') return;
    const leverageChanged = prev.leverage !== leverage;
    const priceStrChanged = prev.price !== price;
    const selChanged = prev.priceSelection !== priceSelection;
    if (!leverageChanged && !priceStrChanged && !selChanged) return;
    if (leverageChanged && !priceStrChanged && !selChanged && usdtInputMode === 'ORDER_VALUE') return;
    const limitEmpty = !(parseFloat(price) > 0);
    if (selChanged && !priceStrChanged && !leverageChanged && limitEmpty) return;

    const { raw, price: foldPrice } = lockFoldRef.current;
    const nextPrice = (priceStrChanged || selChanged)
      ? effectivePrice                    // 价格基准被用户改了:用新基准
      : (foldPrice > 0 ? foldPrice : effectivePrice); // 只动了杠杆:沿用锁定价
    lockFoldRef.current = { raw, price: nextPrice };
    setLockedContracts(foldContracts(raw, nextPrice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leverage, price, priceSelection]);

  const applyPercent = (p: number) => {
    setPercent(p);
    if (currencyUnit === 'USDT') {
      if (isCoinMargined) {
        // 先定张数、再折显示值。顺序反过来（先折币串再转回张）会在 toFixed
        // 的最后一位上掉一张——0.532 张的世界里六位小数不是免费的。
        const c = Math.max(0, Math.floor((maxNotional * (p / 100)) / contractSizeUsd));
        setLockedContracts(c);
        const exact = c > 0 && effectivePrice > 0
          ? coinNotionalUsd(c, contractSizeUsd)
            / (usdtInputMode === 'ORDER_VALUE' ? effectivePrice : effectivePrice * leverage)
          : 0;
        lockFoldRef.current = { raw: exact, price: effectivePrice };
        setQuantity(exact > 0 ? exact.toFixed(6) : '0');
      } else {
        const target = usdtInputMode === 'ORDER_VALUE' ? maxNotional : Math.max(0, available);
        setQuantity((target * (p / 100)).toFixed(2));
      }
    } else {
      if (isCoinMargined) {
        const targetContracts = Math.max(0, Math.floor((maxNotional * (p / 100)) / contractSizeUsd));
        setQuantity(String(targetContracts));
      } else {
        const maxBase = effectivePrice > 0 ? maxNotional / effectivePrice : 0;
        setQuantity((maxBase * (p / 100)).toFixed(quantityPrecision));
      }
    }
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

  // ===== Snapshot dialog state (intercepts every order placement) =====
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotSide, setSnapshotSide] = useState<OrderSide>('LONG');
  const [pendingOrderParams, setPendingOrderParams] = useState<PlaceOrderParams | null>(null);
  const [snapshotSimTime, setSnapshotSimTime] = useState<number>(Date.now());
  const [snapshotEntryPrice, setSnapshotEntryPrice] = useState<number | null>(null);

  const buildOrderParams = (rawSide: OrderSide): PlaceOrderParams | null => {
    // 绝不向上兜底：把「不足一张」放大成一张正是本次要修的东西。
    // 不足一张时 belowMinContract 已经让 orderDisabled 为真，走不到这里。
    const finalQty = isCoinMargined ? coinContractsExact(effectiveQty) : effectiveQty;
    if (orderDisabled || finalQty <= 0) return null;
    const finalType: OrderType = enableTpSl
      ? (orderType === 'MARKET' ? 'MARKET_TP_SL' : orderType === 'LIMIT' ? 'LIMIT_TP_SL' : orderType)
      : orderType;
    return {
      side: rawSide,
      type: finalType,
      price: priceSelection === 'LIMIT' ? (parseFloat(price) || 0) : 0,
      stopPrice: parseFloat(stopPrice) || parseFloat(tpTrigger) || parseFloat(slTrigger) || 0,
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
    const params = buildOrderParams(rawSide);
    if (!params) return;
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
    setSnapshotEntryPrice(ctx.priceMap[symbol] ?? currentPrice ?? null);
    setSnapshotOpen(true);
  };

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
        <button
          onClick={() => {
            const next = prompt('设置杠杆 (1-125)', String(leverage));
            if (next) {
              const v = parseInt(next);
              if (!isNaN(v)) setLeverage(v);
            }
          }}
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
          aria-label="交易偏好"
          className="ml-auto flex h-[22px] w-[22px] items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
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

        {/* Trigger price (TP/SL or conditional types)；跟踪委托此行是「激活价（可选）」 */}
        {(orderType === 'LIMIT_TP_SL' || orderType === 'MARKET_TP_SL' || orderType === 'CONDITIONAL' || orderType === 'TRAILING_STOP') && (
          <div className="flex items-center bg-secondary rounded-md h-9 px-3 w-full min-w-0">
            <span className="text-[11px] text-muted-foreground/80 mr-2 shrink-0">
              {orderType === 'TRAILING_STOP' ? '激活价' : '触发价'}
            </span>
            <input
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
            onBlur={() => {
              // 不足一张时不吸附：那会把用户刚填的数抹成空白，
              // 而他需要看着自己填的数去对照红字里的最小量。
              if (snappedInput == null || snappedInput === quantity) return;
              setQuantity(snappedInput);
              // 吸附只改显示;折算源同步为与锁**精确一致**的未取整数值,
              // 锁本身不动。之后的重折从这里出发,不从六位小数的显示串反推。
              lockFoldRef.current = {
                raw: coinInputUnit === 'CONTRACTS' ? effectiveQty
                  : coinInputUnit === 'COIN_MARGIN' ? marginCoin
                  : effectiveCoinAmount,
                price: effectivePrice,
              };
            }}
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
            {coinInputUnit === 'COIN_MARGIN' && (
              <>{'，占用保证金 '}{formatCoinAmount(marginCoin, baseCoin)}</>
            )}
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
          <label className="flex items-center gap-1.5 cursor-pointer text-foreground/90">
            <input
              type="checkbox"
              checked={enableTpSl}
              onChange={e => setEnableTpSl(e.target.checked)}
              className="w-3 h-3 accent-primary"
            />
            <span>止盈/止损</span>
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
        {enableTpSl && (
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

        {/* Tier exceeded warning */}
        {leverageExceeded && (
          <div className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] bg-trading-red/10 text-trading-red border border-trading-red/30">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>名义价值超出当前 {leverage}x 杠杆上限（最高 {maxAllowedLeverage}x）</span>
          </div>
        )}

        {/* ===== ACTION BUTTONS + PRE-TRADE INFO ===== */}
        <div className="grid grid-cols-2 gap-2 pt-1 w-full min-w-0">
          <button
            onClick={() => handleOrder('LONG')}
            disabled={orderDisabled}
            className="w-full min-w-0 h-10 px-1 rounded-md bg-trading-green hover:bg-trading-green/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-all truncate"
          >
            {coolingOff ? '🧊 冷静中' : (actionMode === 'OPEN' ? '开多' : '平空')}
          </button>
          <button
            onClick={() => handleOrder('SHORT')}
            disabled={orderDisabled}
            className="w-full min-w-0 h-10 px-1 rounded-md bg-trading-red hover:bg-trading-red/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-all truncate"
          >
            {coolingOff ? '🧊 冷静中' : (actionMode === 'OPEN' ? '开空' : '平多')}
          </button>
        </div>

        {/* Pre-trade calculation: left aligned for LONG, right aligned for SHORT */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono tabular-nums">
          <div className="text-left space-y-0.5">
            <div className="text-muted-foreground/80">保证金 <span className="text-foreground/90">{marginDisplay}</span></div>
            <div className="text-muted-foreground/80">可开 <span className="text-foreground/90">{formatUSDT(maxNotional)}</span> {maxNotionalUnit}</div>
          </div>
          <div className="text-right space-y-0.5">
            <div className="text-muted-foreground/80">保证金 <span className="text-foreground/90">{marginDisplay}</span></div>
            <div className="text-muted-foreground/80">可开 <span className="text-foreground/90">{formatUSDT(maxNotional)}</span> {maxNotionalUnit}</div>
          </div>
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
        {/* Fee tier link */}
        <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <Info className="w-3 h-3" />
          手续费等级
          <span className="text-muted-foreground/80 ml-0.5">· {tierInfo.tierLabel}</span>
        </button>

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
              <span className={`font-mono tabular-nums ${ratioColor}`}>{marginRatio.toFixed(2)}%</span>
            </div>
          </div>
          {/* mini gauge bar */}
          <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
            <div className={`h-full ${ratioBg} transition-all`} style={{ width: `${Math.min(100, marginRatio)}%` }} />
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] w-full min-w-0">
            <span className="text-muted-foreground/80 shrink-0">维持保证金</span>
            <span className="font-mono tabular-nums text-foreground truncate text-right min-w-0">{maintenanceDisplay}</span>
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
          return null;
        }}
      />
    </div>
  );
}

// ===== Reusable: Bottom Sheet Overlay =====
