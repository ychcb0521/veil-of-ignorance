/**
 * 币安合约「单笔数量上限」——数据入口与判定（纯函数，不碰 React、不弹提示）。
 *
 * 规则（币安 exchangeInfo 的 symbols[].filters，快照见 src/data/binanceSymbolFilters.json）：
 *   · MARKET_LOT_SIZE.maxQty：**一笔市价单**最多多少（-4005「Quantity greater than max quantity」）。
 *     例：BTCUSDT 120 BTC、ETHUSDT 2,000 ETH、KAITOUSDT 200,000 KAITO、TUTUSDT 4,000,000 TUT；
 *     币本位以张计：BTCUSD_PERP 60,000 张。
 *   · LOT_SIZE.maxQty：**一笔限价单**最多多少，比市价单宽得多（KAITOUSDT 2,000,000、BTCUSDT 1,000）。
 *   · 上限管的是**一笔单子**，不是仓位：仓位可以比它大，分几笔市价单或挂限价单就开得出、平得掉。
 *
 * 哪些单子按市价判（lotSizeKindOfOrder）：市价单、条件委托（触发后按市价成交）、市价止盈止损、
 * 跟踪委托（触发后按市价）、TWAP 的每一片；其余（限价、只做 Maker、分段订单的每张子单、限价止盈止损）按限价判。
 *
 * 豁免（与币安一致或按币安的默认做法）：
 *   · 平掉整个仓位的止盈止损（成数 100%）——相当于币安的 closePosition=true（「Close-All」，不带数量），
 *     币安文档没有说它受单笔上限约束；持仓卡按成数（不足 100%）挂的止盈止损带明确数量，照常受限。
 *   · 引擎强平、「一键平仓」、停止回放时的收尾平仓——都不是用户下的一笔市价单。
 *     币安 FAQ 对「一键平仓」的说法是超过市价单上限的仓位「可能延迟成交」，不是拒单。
 *
 * 数量单位跟引擎走：U 本位以币计，币本位以张计。
 *   · 币安上线了这个币的币本位永续（BTCUSD_PERP 等 20 个）：直接用它的张数上限。
 *   · 币安**没有**的币本位合约（模拟器合成的，例如 KAITOUSD）：借同一个币的 U 本位上限，
 *     把这一单换成 U 本位那张合约的单位去比——与杠杆分层的合成币本位同一个思路
 *     （分层表以 USDT 计，就拿 USD 面值去比；这里上限以币计，就拿币数去比）。
 *     币数 = 张数 × 面值 ÷ 价，所以张数上限 = ⌊币数上限 × 价 ÷ 面值⌋，**随价变化**：
 *     判定一律用这一单真正成交的价（市价 = 现价，条件单 = 触发价，限价 = 委托价，TWAP = 每一片成交时的价）。
 *     跟踪委托的成交价是「极值 × (1 ∓ 回调幅度)」，下单时不可知：按激活价（没有激活价按现价）× (1 − 回调幅度) 判。
 *     **有激活价**的卖出方向：峰值从激活价起算、只会更高（lib/trailingStop），成交价不会低于它，挂得出去就不会在触发时被拒。
 *     **没有激活价**的卖出方向：挂出即激活，峰值从挂出之后第一段撮合行情的高点起算，可能低于下单时的现价
 *     （回放按 K 线高低点撮合、插值的区间可能落在现价下方），成交价也就可能低于下单时判的价——与买入方向一样
 *     触发时再判一次，过不去撤单留痕。买入方向从谷底反弹成交，这相当于留了约两个回调幅度的余量，谷底再深时上限更小。
 *     委托列表按此刻的回调线提前标出；同一段行情里刚摸到极值就回撤触发的，来不及提前标。
 *     TWAP 每一片按执行那一刻的价折张：价格下跌时每片上限随之变小，面板的小字会说。
 *   · 快照里查不到的合约（新上线、已下架、快照没收的）：**不设上限、从不拦**——宁可放过，也不拿一个猜的数拦人。
 *
 * 触发时再判：挂单在本次更新之后下的（带 lotSizeRule 戳）才在触发 / 执行那一刻再判一次；
 * 更新前挂出的委托是按旧规则放行的，触发时不再判——与杠杆分层对旧委托的处理同一条规则，
 * 升级不会在触发那一刻悄悄撤掉早就挂好的对冲单或止损。
 *
 * 持仓限制模式（lib/positionLimitMode）：上面全是「币安标准」的规则。「无限制」模式（默认）下每个入口都带着
 * mode = 'unlimited' 进来，一律放行、没有上限（checkLotSize 的 maxUnits 为 null，与「快照里查不到」同一个口径）。
 * 委托照样盖 lotSizeRule 戳：切到币安标准之后，触发 / 执行那一刻按那一刻的模式再判。缺省 mode 按币安标准。
 */
import raw from '@/data/binanceSymbolFilters.json';
import type { OrderType, PendingOrder, Position, SettlementMode } from '@/types/trading';
import { getCoinMarginedContractSizeUsd, getCoinMarginedSymbol, getSettlementAsset } from '@/lib/coinMargined';
import { getPositionUnits, isCoinSettled } from '@/lib/tradingSettlement';
import { tpSlCloseUnits } from '@/lib/tpSlOrders';
import { orderReferencePrice } from '@/lib/orderReferencePrice';
import { formatPrice } from '@/lib/formatters';
import { LIVE_PRICE_TIER_HEADROOM } from '@/lib/positionLimit';
import { isUnlimitedLimitMode, type PositionLimitMode } from '@/lib/positionLimitMode';

// ─────────────────────── 快照 ───────────────────────

/** [市价 maxQty, minQty, stepSize, 限价 maxQty, minQty, stepSize, liquidationFee] */
type SymbolFilterRow = readonly [number, number, number, number, number, number, number];

interface BinanceSymbolFilterData {
  fetchedAt: string;
  sources: Readonly<Record<string, unknown>>;
  columns: readonly string[];
  /** U 本位永续，数量以币计。 */
  usdm: Readonly<Record<string, SymbolFilterRow>>;
  /** 币本位永续，数量以张计。 */
  coinm: Readonly<Record<string, SymbolFilterRow>>;
}

export const SYMBOL_FILTER_DATA = raw as unknown as BinanceSymbolFilterData;

/** 快照日期（UTC，YYYY-MM-DD）。 */
export const SYMBOL_FILTER_SNAPSHOT_DATE = String(SYMBOL_FILTER_DATA.fetchedAt).slice(0, 10);

export interface QuantityFilter {
  maxQty: number;
  minQty: number;
  stepSize: number;
}

export interface BinanceSymbolFilters {
  binanceSymbol: string;
  /** MARKET_LOT_SIZE：单笔市价单。 */
  market: QuantityFilter;
  /** LOT_SIZE：单笔限价单。 */
  limit: QuantityFilter;
  /** 强平清算费率（小数）。只存着备用，**本次不参与任何计算**。 */
  liquidationFee: number;
}

/** 按币安合约名查快照（KAITOUSDT / BTCUSD_PERP）；查不到返回 null。 */
export function binanceSymbolFilters(kind: 'usdm' | 'coinm', binanceSymbol: string): BinanceSymbolFilters | null {
  const symbol = String(binanceSymbol || '').trim().toUpperCase();
  const row = SYMBOL_FILTER_DATA[kind][symbol];
  if (!row) return null;
  const [mMax, mMin, mStep, lMax, lMin, lStep, liquidationFee] = row;
  return {
    binanceSymbol: symbol,
    market: { maxQty: mMax, minQty: mMin, stepSize: mStep },
    limit: { maxQty: lMax, minQty: lMin, stepSize: lStep },
    liquidationFee,
  };
}

// ─────────────────────── 应用标的 → 币安合约 ───────────────────────

export type LotSizeSettlement = 'usdt' | 'coin';

/**
 * usdm       币安 U 本位合约自己的上限（以币计）
 * coinm      币安币本位合约自己的上限（以张计）
 * usdm-proxy 币安没有这个币的币本位合约，借同一个币的 U 本位上限（以币计），按价折成张
 */
export type LotSizeSource = 'usdm' | 'coinm' | 'usdm-proxy';

export interface ResolvedLotSize {
  appSymbol: string;
  settlement: LotSizeSettlement;
  source: LotSizeSource;
  filters: BinanceSymbolFilters;
  /** 基础币（KAITO）。 */
  baseAsset: string;
  /** 引擎的数量单位：U 本位是币名，币本位是「张」。 */
  unit: string;
  /** 合成币本位折算用的面值（USD/张）；其余为 null。 */
  contractSizeUsd: number | null;
  /** 需要向用户说明的情况（合成币本位）；直接对得上币安合约时为 null。 */
  note: string | null;
  snapshotDate: string;
}

const resolveCache = new Map<string, ResolvedLotSize | null>();

function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase();
}

/** 与杠杆分层同一个找法：原样、去掉分隔符、再退到「基础币 + USDT」。 */
function findUsdmFilters(appSymbol: string): BinanceSymbolFilters | null {
  const candidates = [appSymbol, appSymbol.replace(/[-_/]/g, ''), `${getSettlementAsset(appSymbol)}USDT`];
  for (const candidate of candidates) {
    const hit = binanceSymbolFilters('usdm', candidate);
    if (hit) return hit;
  }
  return null;
}

/**
 * 一个应用内标的（positionsMap 的键，如 KAITOUSDT）在给定结算方式下用哪一份单笔上限。
 * 快照里查不到时返回 null——调用方一律当作「不设上限」。
 */
export function resolveLotSize(appSymbol: string, settlement: SettlementMode | LotSizeSettlement = 'usdt'): ResolvedLotSize | null {
  const symbol = normalizeSymbol(appSymbol);
  const mode: LotSizeSettlement = settlement === 'coin' ? 'coin' : 'usdt';
  const cacheKey = `${mode}:${symbol}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey) ?? null;

  const base = getSettlementAsset(symbol);
  let out: ResolvedLotSize | null = null;
  if (mode === 'usdt') {
    const filters = findUsdmFilters(symbol);
    if (filters) {
      out = {
        appSymbol: symbol, settlement: mode, source: 'usdm', filters, baseAsset: base, unit: base,
        contractSizeUsd: null, note: null, snapshotDate: SYMBOL_FILTER_SNAPSHOT_DATE,
      };
    }
  } else {
    const direct = binanceSymbolFilters('coinm', symbol);
    const listed = direct ?? binanceSymbolFilters('coinm', getCoinMarginedSymbol(symbol));
    if (listed) {
      out = {
        appSymbol: symbol, settlement: mode, source: 'coinm', filters: listed, baseAsset: base, unit: '张',
        contractSizeUsd: null, note: null, snapshotDate: SYMBOL_FILTER_SNAPSHOT_DATE,
      };
    } else {
      const proxy = binanceSymbolFilters('usdm', `${base}USDT`);
      if (proxy) {
        out = {
          appSymbol: symbol, settlement: mode, source: 'usdm-proxy', filters: proxy, baseAsset: base, unit: '张',
          contractSizeUsd: getCoinMarginedContractSizeUsd(symbol),
          note: `币安无 ${base} 币本位合约，按 U 本位 ${proxy.binanceSymbol} 的单笔上限折算`,
          snapshotDate: SYMBOL_FILTER_SNAPSHOT_DATE,
        };
      }
    }
  }
  resolveCache.set(cacheKey, out);
  return out;
}

export type LotSizeKind = 'market' | 'limit';

/**
 * 单笔上限，按引擎的数量单位（U 本位币数、币本位张数）。
 * 合成币本位按 price 把币数上限折成整张（向下取整：上限是授权额度，进一那一点是规则没批的量）；
 * 取不到价时返回 null（不设上限，不拿猜的价拦人）。
 */
export function lotSizeMaxUnits(resolved: ResolvedLotSize, kind: LotSizeKind, price?: number | null): number | null {
  const maxQty = kind === 'market' ? resolved.filters.market.maxQty : resolved.filters.limit.maxQty;
  if (resolved.source !== 'usdm-proxy') return maxQty;
  const px = Number(price);
  const face = Number(resolved.contractSizeUsd);
  if (!(px > 0) || !(face > 0)) return null;
  return Math.floor((maxQty * px) / face + 1e-9);
}

/** 便捷版：查不到快照或取不到价时为 null（不设上限）。 */
export function maxOrderUnits(
  appSymbol: string,
  settlement: SettlementMode | LotSizeSettlement,
  kind: LotSizeKind,
  price?: number | null,
): number | null {
  const resolved = resolveLotSize(appSymbol, settlement);
  return resolved ? lotSizeMaxUnits(resolved, kind, price) : null;
}

// ─────────────────────── 判定 ───────────────────────

export interface LotSizeCheck {
  ok: boolean;
  kind: LotSizeKind;
  /** 这一笔的量（引擎单位）。 */
  units: number;
  /** 单笔上限（引擎单位）；null = 快照里查不到或取不到价，不设上限。 */
  maxUnits: number | null;
  resolved: ResolvedLotSize | null;
  /** 合成币本位折算用的价；其余为 null。 */
  price: number | null;
  /** 被拒时的一句话（提示标题 / 面板警告正文）；放行时为 null。 */
  title: string | null;
  /** 被拒时：上限从哪来（「币安 KAITOUSDT 的市价单单笔上限（快照 …）」）；放行时为 null。 */
  source: string | null;
  /** 被拒时的补充 = 上限从哪来 + 怎么办（按单子的类型：拆成几笔 / 改用限价单 / 拆成几张同类的挂单）；放行时为 null。 */
  detail: string | null;
}

/** stepSize 的小数位数（0.1 → 1、0.001 → 3、1 → 0）。 */
function stepDecimals(step: number): number {
  if (!(step > 0)) return 8;
  for (let d = 0; d < 8; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return 8;
}

/**
 * 数量按引擎单位写：币本位「N 张」（整张），U 本位「N KAITO」——按该合约这一类单子的 stepSize 保留小数
 * （KAITO 一位、BTC 三位），按 USDT 金额折出来的币数不带一长串浮点尾巴。
 * rounding 'up'：往上进到下一格（只用在「这一单」上：四舍五入后看着没超上限、其实超了的量）。
 */
export function formatLotUnits(
  units: number,
  resolved: Pick<ResolvedLotSize, 'unit' | 'settlement'> & { filters?: BinanceSymbolFilters },
  kind: LotSizeKind = 'market',
  rounding: 'nearest' | 'up' = 'nearest',
): string {
  if (!Number.isFinite(units)) return `-- ${resolved.unit}`;
  const step = resolved.filters ? (kind === 'market' ? resolved.filters.market.stepSize : resolved.filters.limit.stepSize) : 0;
  const decimals = resolved.settlement === 'coin' ? 0 : stepDecimals(step);
  const f = 10 ** decimals;
  const value = rounding === 'up' ? Math.ceil(units * f - 1e-6) / f : Math.round(units * f) / f;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: decimals })} ${resolved.unit}`;
}

/** 被拒的「这一单」：四舍五入后若看着不超上限（200,000.04 → 200,000.0），往上进一格写，免得「最多 200,000，这一单 200,000」。 */
function formatOverUnits(units: number, maxUnits: number, resolved: ResolvedLotSize, kind: LotSizeKind): string {
  const nearest = formatLotUnits(units, resolved, kind);
  const shown = Number(nearest.split(' ')[0].replace(/,/g, ''));
  return shown > maxUnits ? nearest : formatLotUnits(units, resolved, kind, 'up');
}

/** 「单笔市价上限 200,000 KAITO」——面板的常驻小字；合成币本位附上借来的那个数。 */
export function lotSizeCapLabel(check: Pick<LotSizeCheck, 'kind' | 'maxUnits' | 'resolved'>): string | null {
  const { resolved, maxUnits } = check;
  if (!resolved || maxUnits == null) return null;
  const head = `单笔${check.kind === 'market' ? '市价' : '限价'}上限 ${formatLotUnits(maxUnits, resolved, check.kind)}`;
  if (resolved.source !== 'usdm-proxy') return head;
  const borrowed = check.kind === 'market' ? resolved.filters.market.maxQty : resolved.filters.limit.maxQty;
  return `${head}（按 ${resolved.filters.binanceSymbol} 的 ${borrowed.toLocaleString('en-US')} ${resolved.baseAsset} 折算）`;
}

/** 上限从哪来：「币安 KAITOUSDT 市价单单笔上限（快照 2026-09-23）」。 */
function sourceText(check: LotSizeCheck): string {
  const r = check.resolved!;
  const what = check.kind === 'market' ? '市价单' : '限价单';
  if (r.source === 'usdm-proxy') {
    const borrowed = check.kind === 'market' ? r.filters.market.maxQty : r.filters.limit.maxQty;
    return `币安无 ${r.baseAsset} 币本位合约，按 U 本位 ${r.filters.binanceSymbol} 的${what}单笔上限 `
      + `${borrowed.toLocaleString('en-US')} ${r.baseAsset}，按价 ${formatPrice(check.price ?? 0)}、面值 ${r.contractSizeUsd} USD 折成张`
      + `（快照 ${r.snapshotDate}）`;
  }
  return `币安 ${r.filters.binanceSymbol} 的${what}单笔上限（快照 ${r.snapshotDate}）`;
}

/** 这一笔在哪一步被拒：下单时（默认）；挂着的单按此刻的价到时会被拒（委托列表的标记）；触发 / 执行那一刻已撤单。 */
export type LotSizeStage = 'placement' | 'pending' | 'triggered';

/** 触发后才按市价成交的挂单：出路是拆成几张同类的单（每张不超过上限）。 */
const TRIGGERED_ORDER_NAMES: Readonly<Record<string, string>> = {
  CONDITIONAL: '条件单',
  TRAILING_STOP: '跟踪委托',
  MARKET_TP_SL: '市价止盈止损单',
};

/**
 * 超过上限时怎么办，按单子的类型写：
 *   · TWAP 超的是一片：让每一片更小；
 *   · 限价类：拆成几笔；
 *   · 条件单 / 跟踪委托 / 市价止盈止损：拆成几张同类的单（挂着的单：撤单后拆开重挂；触发时已撤：拆开重新挂）。
 *     **不叫人改用限价单**：止损方向的单子（S₁ 的对冲在现价下方卖出、突破加仓在现价上方买入）换成同价的限价单
 *     是一张立刻能成交的单，当场就按现价成交了——正是用户不想要的；
 *   · 市价单（含最优价）：拆成几笔市价单，或改用限价单（写出限价单的上限）。
 */
function remedyText(check: LotSizeCheck, noun: LotSizeNoun, orderType: string | null, stage: LotSizeStage): string {
  const r = check.resolved!;
  // TWAP 的片数按总时长自动定（1 小时以上约 20 片），用户能调的只有总量：每一片 = 总量 ÷ 片数。
  if (noun === '这一片') {
    if (stage === 'pending') return '请撤单后减少总量重挂（每一片 = 总量 ÷ 片数，片数按总时长自动定，1 小时以上约 20 片）。';
    if (stage === 'triggered') return '请减少总量重新下（每一片 = 总量 ÷ 片数，片数按总时长自动定，1 小时以上约 20 片）。';
    return '请减少总量（每一片 = 总量 ÷ 片数，片数按总时长自动定，1 小时以上约 20 片）。';
  }
  if (check.kind === 'limit') return '请拆成几笔下单。';
  const triggered = orderType ? TRIGGERED_ORDER_NAMES[orderType] : undefined;
  if (triggered) {
    if (stage === 'pending') return `请撤单后拆成几张${triggered}重挂（每张不超过上限）。`;
    if (stage === 'triggered') return `请拆成几张${triggered}重新挂（每张不超过上限）。`;
    return `请拆成几张${triggered}（每张不超过上限）。`;
  }
  const limitMax = lotSizeMaxUnits(r, 'limit', check.price);
  const limitText = limitMax != null ? `（限价单单笔最多 ${formatLotUnits(limitMax, r, 'limit')}）` : '';
  return `请拆成几笔市价单，或改用限价单${limitText}。`;
}

/** 被拒时怎么称呼这一笔：一般的单「这一单」，TWAP 的一片「这一片」，分段订单的一张子单「这张子单」。 */
export type LotSizeNoun = '这一单' | '这一片' | '这张子单';

/** 容差：U 本位按金额折出来的币数带浮点尾巴（200,000.00000001），不该因为它被拒。 */
const exceeds = (units: number, maxUnits: number) => units > maxUnits * (1 + 1e-9) + 1e-9;

export function checkLotSize(args: {
  symbol: string;
  settlement: SettlementMode | LotSizeSettlement | null | undefined;
  kind: LotSizeKind;
  units: number;
  /** 这一笔成交的价：合成币本位按它把币数上限折成张；其余用不到。 */
  price?: number | null;
  /** 被拒时怎么称呼这一笔（默认「这一单」）。 */
  noun?: LotSizeNoun;
  /** 这一笔是哪种单（条件单 / 跟踪委托的出路与市价单不同）；不给按市价单写出路。 */
  orderType?: OrderType | string | null;
  /** 在哪一步判的（默认下单时）：挂着的单与触发时已撤的单，出路要说先撤单 / 重新挂。 */
  stage?: LotSizeStage;
  /** 持仓限制模式：无限制时不设单笔上限（maxUnits 为 null）。缺省按币安标准。 */
  mode?: PositionLimitMode | null;
}): LotSizeCheck {
  if (isUnlimitedLimitMode(args.mode)) {
    return {
      ok: true, kind: args.kind, units: Number(args.units), maxUnits: null, resolved: null, price: null,
      title: null, source: null, detail: null,
    };
  }
  const settlement: LotSizeSettlement = args.settlement === 'coin' ? 'coin' : 'usdt';
  const resolved = resolveLotSize(args.symbol, settlement);
  const units = Number(args.units);
  const price = resolved?.source === 'usdm-proxy' && Number(args.price) > 0 ? Number(args.price) : null;
  const maxUnits = resolved ? lotSizeMaxUnits(resolved, args.kind, args.price) : null;
  const base: LotSizeCheck = {
    ok: true, kind: args.kind, units, maxUnits, resolved, price, title: null, source: null, detail: null,
  };
  if (!resolved || maxUnits == null || !(units > 0) || !exceeds(units, maxUnits)) return base;
  const refused: LotSizeCheck = { ...base, ok: false };
  const noun = args.noun ?? '这一单';
  refused.title = `单笔${args.kind === 'market' ? '市价' : '限价'}单最多 ${formatLotUnits(maxUnits, resolved, args.kind)}，`
    + `${noun} ${formatOverUnits(units, maxUnits, resolved, args.kind)}`;
  refused.source = sourceText(refused);
  refused.detail = `${refused.source}。${remedyText(refused, noun, args.orderType ? String(args.orderType) : null, args.stage ?? 'placement')}`;
  return refused;
}

// ─────────────────────── 单子按哪种判 ───────────────────────

const MARKET_EXECUTED_TYPES = new Set<string>(['MARKET', 'MARKET_TP_SL', 'CONDITIONAL', 'TWAP']);

/**
 * 这张（挂着的）单成交时是市价单还是限价单。条件委托在引擎里一律在触发价上按吃单成交（与面板的「触发后按市价」一致）；
 * 跟踪委托只有存下来的单显式是限价执行才按限价（旧版本挂出的单；本次更新之后引擎挂的都是市价执行，
 * 下单时的判定也一律按市价，见 placementLotSize）。最优价（priceSelection = BEST）立即吃单，按市价。
 */
export function lotSizeKindOfOrder(
  order: { type: OrderType | string; trailingExecType?: 'MARKET' | 'LIMIT' | null; priceSelection?: string | null },
): LotSizeKind {
  if (order.priceSelection === 'BEST') return 'market';
  if (order.type === 'TRAILING_STOP') return order.trailingExecType === 'LIMIT' ? 'limit' : 'market';
  return MARKET_EXECUTED_TYPES.has(String(order.type)) ? 'market' : 'limit';
}

/**
 * 平掉整个仓位的止盈止损（成数 100%）。相当于币安的 closePosition=true：不带数量、触发时平掉整个仓位，
 * 不受单笔上限约束。按成数（不足 100%）挂的止盈止损带明确数量，照常受限。
 */
export function isWholePositionCloseOrder(order: Pick<PendingOrder, 'reduceOnly' | 'reducePercentage'> | null | undefined): boolean {
  return !!order?.reduceOnly && Number(order.reducePercentage) >= 100;
}

/** 本次更新之后下的委托盖这个戳：触发 / 执行那一刻再判单笔上限。更新前挂出的没有戳，触发时不再判。 */
export const LOT_SIZE_RULE = 'binance-lot-size-v1' as const;
export const ORDER_LOT_SIZE_STAMP = { lotSizeRule: LOT_SIZE_RULE } as const;

export function isLotSizeStamped(order: Pick<PendingOrder, 'lotSizeRule'> | null | undefined): boolean {
  return order?.lotSizeRule === LOT_SIZE_RULE;
}

// ─────────────────────── TWAP 切片 ───────────────────────

/**
 * TWAP 怎么切片——引擎（Index 的 TWAP ENGINE）与下单时的判定共用这一个式子：
 * 片数 = ⌊总时长 ÷ 间隔⌋（至少 1），每片 = 总量 ÷ 片数；币本位每片取整张（至少 1 张）。
 */
export function twapSlicePlan(args: {
  totalQty: number;
  durationMs: number;
  intervalMs: number;
  coin: boolean;
}): { totalSlices: number; sliceQty: number } {
  const intervalMs = args.intervalMs > 0 ? args.intervalMs : 300000;
  const totalSlices = Math.max(1, Math.floor(args.durationMs / intervalMs));
  const rawSliceQty = args.totalQty / totalSlices;
  const sliceQty = args.coin ? Math.max(1, Math.round(rawSliceQty)) : rawSliceQty;
  return { totalSlices, sliceQty };
}

/** 挂着的 TWAP 每一片多大（按挂单上存的总量、间隔、结束时刻，与引擎同一个式子）。 */
export function twapOrderSliceUnits(order: PendingOrder): number {
  const totalQty = order.twapTotalQty || order.quantity;
  const intervalMs = order.twapInterval || 300000;
  const endTime = order.twapEndTime || order.createdAt + 3600000;
  return twapSlicePlan({ totalQty, durationMs: endTime - order.createdAt, intervalMs, coin: isCoinSettled(order) }).sliceQty;
}

// ─────────────────────── 跟踪委托的成交价 ───────────────────────

const positive = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const clampCallback = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 0.99) : 0;
};

/**
 * 跟踪委托判单笔上限用的价（只有合成币本位的上限随价变，其余合约用不到）。成交价 = 回调线 = 极值 × (1 ∓ 回调幅度)
 * （lib/trailingStop：卖出追峰值、从峰值回撤成交；买入追谷底、从谷底反弹成交）：
 *   · 还没激活（下单时也一样）：激活价（没有激活价按现价）× (1 − 回调幅度)。有激活价的卖出方向，峰值从激活价起算、
 *     不低于它，成交价不会低于这个价——挂得出去就不会在触发时被拒；没有激活价的卖出方向挂出即激活，峰值从挂出之后
 *     第一段行情算起、可能低于下单时的现价，不在此列（触发时再判）；买入方向的谷底可能更深，这个价相当于留了约两个回调幅度的余量。
 *   · 已激活：此刻的回调线——卖出按峰值 × (1 − 回调幅度)（峰值只会更高，成交价只会更高），买入按谷底 × (1 + 回调幅度)
 *     （谷底再深，成交价更低，委托列表跟着谷底提前标出来）。极值缺失时按现价。
 */
export function trailingLotSizePrice(
  order: {
    side?: string | null;
    stopPrice?: number | null;
    callbackRate?: number | null;
    trailingActivated?: boolean | null;
    peakPrice?: number | null;
    troughPrice?: number | null;
  },
  markPrice: number,
): number {
  const mark = positive(markPrice);
  const rate = clampCallback(order.callbackRate);
  if (order.trailingActivated) {
    if (order.side === 'SHORT') return (positive(order.peakPrice) || mark) * (1 - rate);
    return (positive(order.troughPrice) || mark) * (1 + rate);
  }
  return (positive(order.stopPrice) || mark) * (1 - rate);
}

// ─────────────────────── 下单时 ───────────────────────

/** 下单时判定需要的字段（handlePlaceOrder 的 PlaceOrderParams 与面板的草稿都满足）。 */
export interface LotSizeDraft {
  type: OrderType;
  quantity: number;
  contracts?: number;
  settlementMode?: SettlementMode | null;
  price?: number;
  stopPrice?: number;
  priceSelection?: string | null;
  /** 跟踪委托的回调幅度（小数：0.01 = 1%），与 PlaceOrderParams 同一个口径。 */
  callbackRate?: number;
  /** TWAP 总时长 / 间隔（分钟），与 PlaceOrderParams 同一个口径。 */
  twapDuration?: number;
  twapInterval?: number;
  scaledCount?: number;
  scaledStartPrice?: number;
  scaledEndPrice?: number;
  /** 随单止盈止损（成数不足 100% 时带明确数量，照常受限）。 */
  tpTriggerPrice?: number;
  slTriggerPrice?: number;
  tpSlPercentage?: number;
}

export interface PlacementLotSize {
  /** 这一单主体（TWAP 是一片、分段是一张子单）按哪种单子、哪个价判——面板的「单笔市价上限」读它。 */
  main: LotSizeCheck;
  /** 第一处过不去的（主体、分段的某张子单、TWAP 的一片、随单止盈止损）；都过得去为 null。 */
  refusal: LotSizeCheck | null;
  /** 主体被拆成几笔（TWAP 片数、分段笔数，其余 1）：面板按它把单笔上限乘回总量。 */
  pieces: number;
  /** 分段 / TWAP / 随单止盈止损被拒时，标题前要加的那半句（「第 3 张子单」「每一片」「随单止损」）；主体被拒时为空。 */
  refusalLead: string;
}

/**
 * 下单那一刻的单笔上限判定（引擎 handlePlaceOrder 与下单面板共用）。分支次序与 handlePlaceOrder 一致：
 *   市价 / 最优价：按现价（marketPrice）判**全量**——最优价先于分段 / TWAP，引擎整笔立即吃单，不切片、不拆子单；
 *   条件委托 / 市价止盈止损：按触发价（触发后在它上面按市价成交）；
 *   跟踪委托：按激活价（没有激活价按现价）× (1 − 回调幅度)（见 trailingLotSizePrice；触发时再判一次）；
 *   TWAP：每一片按现价（每片执行时再判一次）；
 *   分段订单：逐张子单按各自的委托价（限价上限）；
 *   限价 / 只做 Maker / 限价止盈止损：按委托价（限价上限）；
 *   随单止盈止损成数不足 100% 时：各按自己的触发价、按市价上限判那一截。
 * 合成币本位的上限随价变化，所以「按哪个价」要紧；其余合约的上限与价无关。
 */
export function placementLotSize(
  symbol: string,
  draft: LotSizeDraft,
  marketPrice: number,
  /** 持仓限制模式：无限制时一律放行、没有上限。缺省按币安标准。 */
  mode?: PositionLimitMode | null,
): PlacementLotSize {
  const coin = isCoinSettled(draft);
  const settlement = coin ? 'coin' : 'usdt';
  const units = coin ? positive(draft.contracts ?? draft.quantity) : positive(draft.quantity);
  /**
   * 引擎挂出去的跟踪委托一律按市价执行（handlePlaceOrder 存的是 trailingExecType: 'MARKET'，不管调用方传了什么），
   * 所以按市价上限判——按调用方传的 'LIMIT' 判限价上限，会放出一张触发时注定被市价上限撤掉的单。
   */
  const kind: LotSizeKind = draft.type === 'TRAILING_STOP' ? 'market' : lotSizeKindOfOrder(draft);
  const market = positive(marketPrice);
  const check = (k: LotSizeKind, u: number, price: number, noun?: LotSizeNoun, orderType?: string) => checkLotSize({
    symbol, settlement, kind: k, units: u, price, noun, orderType, mode,
  });

  let main: LotSizeCheck;
  let refusal: LotSizeCheck | null = null;
  let refusalLead = '';
  let pieces = 1;

  if (draft.priceSelection === 'BEST' || draft.type === 'MARKET') {
    // 立即成交：整笔一张市价单（handlePlaceOrder 的最优价分支在分段 / TWAP 之前，整笔按现价成交）
    main = check('market', units, market, undefined, 'MARKET');
    if (!main.ok) refusal = main;
  } else if (draft.type === 'SCALED') {
    const count = Math.max(2, Math.floor(positive(draft.scaledCount) || 5));
    pieces = count;
    const perChild = coin ? Math.max(1, Math.round(units / count)) : units / count;
    const start = positive(draft.scaledStartPrice);
    const end = positive(draft.scaledEndPrice);
    const step = count > 1 ? (end - start) / (count - 1) : 0;
    const childPrices = start > 0 && end > 0
      ? Array.from({ length: count }, (_, i) => start + step * i)
      : [market];
    const childChecks = childPrices.map(px => check('limit', perChild, px, '这张子单'));
    // 面板读「最紧的那一张」：合成币本位里委托价最低的子单能折的张数最少
    main = childChecks.reduce((a, b) => ((b.maxUnits ?? Infinity) < (a.maxUnits ?? Infinity) ? b : a));
    const bad = childChecks.findIndex(c => !c.ok);
    if (bad >= 0) {
      refusal = childChecks[bad];
      refusalLead = `分段订单第 ${bad + 1} 张子单：`;
    }
  } else if (draft.type === 'TWAP') {
    const plan = twapSlicePlan({
      totalQty: units,
      durationMs: (positive(draft.twapDuration) || 60) * 60 * 1000,
      intervalMs: (positive(draft.twapInterval) || 5) * 60 * 1000,
      coin,
    });
    pieces = plan.totalSlices;
    main = check('market', plan.sliceQty, market, '这一片');
    if (!main.ok) {
      refusal = main;
      refusalLead = `TWAP 每一片（共 ${plan.totalSlices} 片）：`;
    }
  } else {
    // 限价类按委托价；条件委托 / 市价止盈止损按触发价（存在 stopPrice）；跟踪委托按激活价下方一个回调幅度；取不到退回现价
    const price = kind === 'limit'
      ? positive(draft.price) || positive(draft.stopPrice) || market
      : draft.type === 'TRAILING_STOP'
        ? trailingLotSizePrice({ stopPrice: draft.stopPrice, callbackRate: draft.callbackRate }, market)
        : positive(draft.stopPrice) || market;
    main = check(kind, units, price, undefined, draft.type);
    if (!main.ok) refusal = main;
  }

  // 随单止盈止损：100% 平掉整个仓位的不受限（相当于 closePosition），成数不足 100% 的那一截按市价上限判
  const pct = positive(draft.tpSlPercentage) || 100;
  if (!refusal && pct < 100 && units > 0) {
    const legUnits = coin ? Math.max(1, Math.round(units * (pct / 100))) : units * (pct / 100);
    for (const [label, px] of [['随单止盈', positive(draft.tpTriggerPrice)], ['随单止损', positive(draft.slTriggerPrice)]] as const) {
      if (!(px > 0)) continue;
      const leg = check('market', legUnits, px);
      if (!leg.ok) {
        refusal = {
          ...leg,
          detail: `${leg.source}。随单止盈止损触发后是一笔市价单：把成数调到 100%（平掉整个仓位的不受单笔上限约束），或减少数量。`,
        };
        refusalLead = `${label}（${pct}% 仓位）：`;
        break;
      }
    }
  }
  return { main, refusal, pieces, refusalLead };
}

// ─────────────────────── 触发 / 执行时 ───────────────────────

/**
 * 挂单触发 / 执行那一刻的再判：本次更新之后下的（带戳）、按市价成交、不是「平掉整个仓位」的止盈止损，
 * 按这一刻的价（合成币本位折张用）判这一笔的量（TWAP 传这一片）。过不去返回那次判定，过得去或不判返回 null。
 * 限价单不在触发时再判：它的量与上限在下单时就定了（合成币本位也按委托价折，价不变）。
 */
export function lotSizeRefusalAtExecution(
  symbol: string,
  order: PendingOrder,
  price: number,
  units: number = getPositionUnits(order),
  /** 触发 / 执行那一刻（默认，被拒即撤单）；委托列表的标记传 'pending'（出路说先撤单再重挂）。 */
  stage: LotSizeStage = 'triggered',
  /** 此刻的持仓限制模式：无限制时不判（返回 null）。缺省按币安标准。 */
  mode?: PositionLimitMode | null,
): LotSizeCheck | null {
  if (isUnlimitedLimitMode(mode)) return null;
  if (!isLotSizeStamped(order) || isWholePositionCloseOrder(order)) return null;
  if (lotSizeKindOfOrder(order) !== 'market') return null;
  const check = checkLotSize({
    symbol: order.reduceSymbol || symbol,
    settlement: order.settlementMode,
    kind: 'market',
    units,
    price,
    noun: order.type === 'TWAP' ? '这一片' : '这一单',
    orderType: order.type,
    stage,
  });
  return check.ok ? null : check;
}

/**
 * 委托列表的「触发时将超单笔上限」：按此刻能知道的价，这张挂单到触发 / 执行时会被单笔上限拒掉。
 *   条件委托 / 市价止盈止损（含持仓卡的止盈止损）：触发价；
 *   跟踪委托：回调线（trailingLotSizePrice：还没激活按激活价 × (1 − 回调幅度)，已激活按此刻的极值折回调线）；
 *   TWAP：每一片按现价。
 * 只标触发时真的会再判的单（lotSizeRefusalAtExecution 的同一组条件）。
 */
export function pendingLotSizeRisk(
  symbol: string,
  order: PendingOrder,
  markPrice: number,
  /** 此刻的持仓限制模式：无限制时从不标。缺省按币安标准。 */
  mode?: PositionLimitMode | null,
): LotSizeCheck | null {
  if (isUnlimitedLimitMode(mode)) return null;
  if (!isLotSizeStamped(order) || isWholePositionCloseOrder(order)) return null;
  if (lotSizeKindOfOrder(order) !== 'market') return null;
  const mark = positive(markPrice);
  let price = mark;
  let units = getPositionUnits(order);
  if (order.type === 'TWAP') {
    units = twapOrderSliceUnits(order);
  } else if (order.type === 'TRAILING_STOP') {
    price = trailingLotSizePrice(order, mark);
  } else {
    const ref = orderReferencePrice(order, mark);
    price = ref.price || mark;
  }
  return lotSizeRefusalAtExecution(symbol, order, price, units, 'pending', mode);
}

/** 委托列表那枚标记上的字。 */
export function pendingLotSizeBadge(order: Pick<PendingOrder, 'type'>): string {
  return order.type === 'TWAP' ? '执行时将超单笔上限' : '触发时将超单笔上限';
}

// ─────────────────────── 持仓卡：市价平仓 / 按成数的止盈止损 ───────────────────────

export type CardCloseMode = 'market-close' | 'tpsl';

/**
 * 按成数平仓时写给人看的成数（0–1 → 「0.8%」），必须就是引擎真正平掉的那个成数（handleClosePosition 没有 1% 的下限）：
 * 仓位是单笔上限的 100 多倍时「按上限平」给的成数不到 1%，四舍五入成「1%」「0%」就是在说一个没发生的数。
 *   · 1% 及以上：一位小数，整数照旧写整数（50%、33.3%）；
 *   · 不到 1%：两位有效数字（0.8%、0.33%、0.01%）；
 *   · 差一丝才到 100% 的往下截（99.99% 写 99.9%，不写成 100%）。
 */
export function formatClosePercent(fraction: number): string {
  const pct = Number(fraction) * 100;
  if (!(pct > 0)) return '0%';
  if (pct >= 100) return '100%';
  const decimals = pct >= 1 ? 1 : Math.min(8, 1 - Math.floor(Math.log10(pct)));
  const f = 10 ** decimals;
  let value = Math.round(pct * f) / f;
  if (value >= 100) value = Math.floor(pct * f) / f;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: decimals })}%`;
}

/**
 * 持仓卡「止盈/止损」弹窗的成数滑条：最小一格 10%、每格 10%。按成数挂的止盈止损超过单笔上限时，
 * 连这一格都放不下就只剩 100%（平掉整个仓位的不受限）——别叫人「把成数调小」，滑条上没有更小的数。
 */
export const CARD_TPSL_PERCENT_STEP = 10;

/**
 * 引擎给一笔仓位按成数平掉多少（与 handleClosePosition / tpSlCloseUnits 同一个取整）。
 * 市价平仓不再有 1% 的下限（handleClosePosition 按给的成数平）：仓位是单笔上限的 100 多倍时，
 * 「按上限平」给出的成数不到 1%，也得真的只平那么多。
 */
export function cardLegCloseUnits(leg: Position, fraction: number, mode: CardCloseMode): number {
  if (mode === 'tpsl') return tpSlCloseUnits(leg, Math.min(100, Math.max(0, fraction * 100)));
  const units = getPositionUnits(leg);
  if (!(units > 0) || !(fraction > 0)) return 0;
  const q = units * Math.min(1, fraction);
  return isCoinSettled(leg) ? Math.max(1, Math.round(q)) : q;
}

export interface CardCloseLotSize {
  ok: boolean;
  /** 同一张卡上 U 本位与币本位是两张合约，各是一笔市价单。 */
  orders: { settlement: LotSizeSettlement; units: number; check: LotSizeCheck }[];
  /** 第一笔过不去的；都过得去为 null。 */
  refusal: LotSizeCheck | null;
  /**
   * 不超上限最多能按多大的成数平（0–1）；没有上限时为 1——「按上限平」按它填数量。
   * 市价平仓（按现价折张）的合成币本位在上限前留 LIVE_PRICE_TIER_HEADROOM（0.2%）：现价每帧都在变，
   * 恰好卡线的数量跌一个 tick 就又超了（与下单面板 100%、加仓计算器同一个余量）。判定本身（ok / refusal）不留。
   */
  maxFraction: number;
}

function cardOrders(symbol: string, legs: readonly Position[], fraction: number, price: number, mode: CardCloseMode) {
  const bySettlement = new Map<LotSizeSettlement, number>();
  for (const leg of legs) {
    const units = cardLegCloseUnits(leg, fraction, mode);
    if (!(units > 0)) continue;
    const s: LotSizeSettlement = isCoinSettled(leg) ? 'coin' : 'usdt';
    bySettlement.set(s, (bySettlement.get(s) ?? 0) + units);
  }
  return [...bySettlement.entries()].map(([settlement, units]) => ({
    settlement,
    units,
    check: checkLotSize({ symbol, settlement, kind: 'market', units, price }),
  }));
}

/**
 * 持仓卡按成数市价平仓（mode 'market-close'，价 = 现价），或按成数挂止盈止损（'tpsl'，价 = 触发价）：
 * 卡上同一种结算方式的几笔在币安是同一个仓位、平仓是一笔市价单，所以按结算方式合计了再比。
 * 止盈止损成数 100%（平掉整个仓位）不受限（见文件头的豁免）。
 */
export function cardCloseLotSize(
  symbol: string,
  legs: readonly Position[],
  fraction: number,
  price: number,
  mode: CardCloseMode = 'market-close',
  /** 此刻的持仓限制模式：无限制时不设单笔上限（按任何成数都能平，maxFraction 为 1）。缺省按币安标准。 */
  limitMode?: PositionLimitMode | null,
): CardCloseLotSize {
  if (isUnlimitedLimitMode(limitMode)) return { ok: true, orders: [], refusal: null, maxFraction: 1 };
  if (mode === 'tpsl' && fraction >= 1) return { ok: true, orders: [], refusal: null, maxFraction: 1 };
  const orders = cardOrders(symbol, legs, fraction, price, mode);
  const refusal = orders.find(o => !o.check.ok)?.check ?? null;
  // 找上限时不带容差：给出的成数乘回去必须不超过上限（判定本身留的浮点容差只用来放过按金额折出来的尾巴）
  const allowance = (check: LotSizeCheck): number => {
    const max = check.maxUnits as number;
    return mode === 'market-close' && check.resolved?.source === 'usdm-proxy'
      ? Math.floor(max * (1 - LIVE_PRICE_TIER_HEADROOM))
      : max;
  };
  const fits = (f: number) => cardOrders(symbol, legs, f, price, mode)
    .every(o => o.check.maxUnits == null || o.units <= allowance(o.check));
  let maxFraction = 1;
  if (!fits(1)) {
    // 平掉的量随成数单调不减：二分出最大的那个成数（币本位最少 1 张：连 1 张都放不下时为 0）
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    maxFraction = lo;
  }
  return { ok: refusal == null, orders, refusal, maxFraction };
}
