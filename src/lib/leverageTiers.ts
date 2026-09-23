/**
 * 币安合约「杠杆与保证金」分层——纯函数层。
 *
 * 规则（币安公开分层数据 + FAQ，快照见 leverageTierData）：
 *   · 分层**按合约**各不相同。U 本位的档位以 USDT 名义计（数量 × 标记价）；
 *     币本位的档位以**币**计（张数 × 面值 ÷ 标记价）。
 *   · 一个仓位能用的最高杠杆 = 它的名义所在档位的 maxOpenPosLeverage。
 *   · 杠杆 L 下最多能持有的名义 = 最后一个 maxOpenPosLeverage ≥ L 的档位的上限（cap）。
 *   · 名义落在 (floor, cap] 里算这一档（0 算第 1 档）：「15x 最高 50,000」说的就是 50,000 本身可以开。
 *   · 超过最高一档的上限，任何杠杆都不能开。
 *   · 维持保证金 = 名义 × 档位维持保证金率 − 档位速算扣除额（cum），与所选杠杆无关；
 *     cum 让维持保证金在档位边界上连续（生成脚本与单测逐个边界校验）。
 *
 * 币安没有上线的币本位合约（模拟器合成的，例如 KAITOUSD）没有币安规则可抄：
 * 按同一个币的 U 本位分层，拿 USD 名义（张数 × 面值）去比——这恰好等于
 * 「把 USDT 档位按标记价折成币」再比币数。
 */
import {
  LEVERAGE_TIER_DATA,
  LEVERAGE_TIER_SNAPSHOT_DATE,
  listedCoinContractSizeUsd,
  type LeverageTierRow,
} from '@/lib/leverageTierData';
import {
  getCoinMarginedContractSizeUsd,
  getCoinMarginedSymbol,
  getSettlementAsset,
} from '@/lib/coinMargined';

export { LEVERAGE_TIER_SNAPSHOT_DATE };

export interface LeverageTier {
  /** 档位序号，从 1 开始。 */
  bracket: number;
  /** 档位下沿（不含），与 cap 同单位。 */
  floor: number;
  /** 档位上限（含）。 */
  cap: number;
  /** 这一档允许的最高杠杆（maxOpenPosLeverage）。 */
  maxLeverage: number;
  /** 维持保证金率（小数）。 */
  maintenanceMarginRate: number;
  /** 维持保证金速算扣除额（cum），与 floor / cap 同单位。 */
  maintenanceAmount: number;
}

export type TierSettlement = 'usdt' | 'coin';

/**
 * usdm       币安 U 本位合约自己的分层
 * coinm      币安币本位合约自己的分层（以币计）
 * usdm-proxy 币安没有这个币的币本位合约，借同一个币的 U 本位分层，按 USD 名义比
 * fallback   快照里查不到，暂按最常见的那张 U 本位分层
 */
export type LeverageTierSource = 'usdm' | 'coinm' | 'usdm-proxy' | 'fallback';

/**
 * 名义怎么量：
 * quote    数量 × 标记价（USDT），随价格变
 * coin     张数 × 面值 ÷ 标记价（币），随价格变
 * usd-face 张数 × 面值（USD），与价格无关
 */
export type TierMeasure = 'quote' | 'coin' | 'usd-face';

export interface ResolvedSymbolTiers {
  appSymbol: string;
  settlement: TierSettlement;
  tiers: readonly LeverageTier[];
  /** 档位金额的单位：'USDT'（U 本位）、币名（币本位，如 'BTC'）、'USD'（合成币本位按面值计）。 */
  unit: string;
  source: LeverageTierSource;
  measure: TierMeasure;
  /** 第 1 档的最高杠杆，即杠杆滑块的上限。 */
  maxLeverage: number;
  /** 最高一档的上限：超过它任何杠杆都不能开。 */
  topCap: number;
  /** 币本位的面值（USD/张）；U 本位没有。 */
  contractSizeUsd?: number;
  /** 分层取自快照里的哪个币安合约；兜底时为 null。 */
  binanceSymbol: string | null;
  /** 需要向用户说明的情况（合成合约、兜底）；直接对得上币安合约时为 null。 */
  note: string | null;
  /** 快照日期（UTC）。 */
  snapshotDate: string;
}

const decodedTables = new Map<string, readonly LeverageTier[]>();

function decodeTable(kind: 'usdm' | 'coinm', index: number): readonly LeverageTier[] | null {
  const key = `${kind}:${index}`;
  const cached = decodedTables.get(key);
  if (cached) return cached;
  const rows: readonly LeverageTierRow[] | undefined = LEVERAGE_TIER_DATA[kind].tables[index];
  if (!rows || rows.length === 0) return null;
  const tiers = Object.freeze(rows.map(([floor, cap, maxLeverage, maintenanceMarginRate, maintenanceAmount], i) =>
    Object.freeze({ bracket: i + 1, floor, cap, maxLeverage, maintenanceMarginRate, maintenanceAmount })));
  decodedTables.set(key, tiers);
  return tiers;
}

function tableFor(kind: 'usdm' | 'coinm', binanceSymbol: string): readonly LeverageTier[] | null {
  const index = LEVERAGE_TIER_DATA[kind].symbols[binanceSymbol];
  return typeof index === 'number' ? decodeTable(kind, index) : null;
}

/** 快照里用得最多的那张 U 本位分层（113 个合约共用）。 */
export function fallbackUsdmTiers(): readonly LeverageTier[] {
  const tiers = decodeTable('usdm', LEVERAGE_TIER_DATA.fallbackUsdmTable);
  if (!tiers) throw new Error('杠杆分层快照缺少兜底表');
  return tiers;
}

function fallbackUsage(): number {
  const index = LEVERAGE_TIER_DATA.fallbackUsdmTable;
  return Object.values(LEVERAGE_TIER_DATA.usdm.symbols).filter(i => i === index).length;
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase();
}

/** 按 U 本位名找表：原样、去掉分隔符、再退到「基础币 + USDT」。 */
function findUsdmSymbol(appSymbol: string): string | null {
  const candidates = [
    appSymbol,
    appSymbol.replace(/[-_/]/g, ''),
    `${getSettlementAsset(appSymbol)}USDT`,
  ];
  return candidates.find(s => LEVERAGE_TIER_DATA.usdm.symbols[s] != null) ?? null;
}

function resolved(
  base: Omit<ResolvedSymbolTiers, 'maxLeverage' | 'topCap' | 'snapshotDate'>,
): ResolvedSymbolTiers {
  const tiers = base.tiers;
  return Object.freeze({
    ...base,
    maxLeverage: tiers[0]?.maxLeverage ?? 1,
    topCap: tiers[tiers.length - 1]?.cap ?? 0,
    snapshotDate: LEVERAGE_TIER_SNAPSHOT_DATE,
  });
}

const resolveCache = new Map<string, ResolvedSymbolTiers>();

/**
 * 一个应用内标的（positionsMap 的键，如 KAITOUSDT）在给定结算方式下用哪张分层。
 *
 *   U 本位：快照里的同名合约；查不到 → fallback。
 *   币本位：币安上线了这个币的币本位永续（如 BTCUSD_PERP）→ 它自己的分层，以币计，面值取快照；
 *           没上线（如 KAITOUSD）→ 同一个币的 U 本位分层（usdm-proxy），按 USD 名义比，面值 10；
 *           连 U 本位都查不到 → fallback，同样按 USD 名义比。
 */
export function resolveSymbolTiers(appSymbol: string, settlement: TierSettlement = 'usdt'): ResolvedSymbolTiers {
  const symbol = normalizeSymbol(appSymbol);
  const mode: TierSettlement = settlement === 'coin' ? 'coin' : 'usdt';
  const cacheKey = `${mode}:${symbol}`;
  const hit = resolveCache.get(cacheKey);
  if (hit) return hit;

  const base = getSettlementAsset(symbol);
  let out: ResolvedSymbolTiers;
  if (mode === 'usdt') {
    const usdmSymbol = findUsdmSymbol(symbol);
    const tiers = usdmSymbol ? tableFor('usdm', usdmSymbol) : null;
    out = tiers
      ? resolved({
        appSymbol: symbol, settlement: mode, tiers, unit: 'USDT', source: 'usdm', measure: 'quote',
        binanceSymbol: usdmSymbol, note: null,
      })
      : resolved({
        appSymbol: symbol, settlement: mode, tiers: fallbackUsdmTiers(), unit: 'USDT', source: 'fallback', measure: 'quote',
        binanceSymbol: null,
        note: `快照中没有 ${symbol} 的分层，暂按最常见的 U 本位分层（${fallbackUsage()} 个合约使用）`,
      });
  } else {
    const direct = LEVERAGE_TIER_DATA.coinm.symbols[symbol] != null;
    const coinmSymbol = direct ? symbol : getCoinMarginedSymbol(symbol);
    const coinTiers = tableFor('coinm', coinmSymbol);
    if (coinTiers) {
      // 直接给了币安合约名（含交割合约 BTCUSD_260925）时，基础币取交易对去掉 USD。
      const coin = direct ? coinmSymbol.split('_')[0].replace(/USD$/, '') : base;
      out = resolved({
        appSymbol: symbol, settlement: mode, tiers: coinTiers, unit: coin, source: 'coinm', measure: 'coin',
        contractSizeUsd: listedCoinContractSizeUsd(coin) ?? getCoinMarginedContractSizeUsd(symbol),
        binanceSymbol: coinmSymbol, note: null,
      });
    } else {
      const usdmSymbol = `${base}USDT`;
      const proxyTiers = tableFor('usdm', usdmSymbol);
      const contractSizeUsd = getCoinMarginedContractSizeUsd(symbol);
      out = proxyTiers
        ? resolved({
          appSymbol: symbol, settlement: mode, tiers: proxyTiers, unit: 'USD', source: 'usdm-proxy', measure: 'usd-face',
          contractSizeUsd, binanceSymbol: usdmSymbol,
          note: `币安无 ${base} 币本位合约，按 U 本位 ${usdmSymbol} 分层折算`,
        })
        : resolved({
          appSymbol: symbol, settlement: mode, tiers: fallbackUsdmTiers(), unit: 'USD', source: 'fallback', measure: 'usd-face',
          contractSizeUsd, binanceSymbol: null,
          note: `币安无 ${base} 币本位合约，快照中也没有 ${usdmSymbol}，暂按最常见的 U 本位分层折算`,
        });
    }
  }
  resolveCache.set(cacheKey, out);
  return out;
}

// ─────────────────────────── 档位查询 ───────────────────────────

/** 浮点噪声的容差：52,466 × 0.953… 这类乘积可能多出 1e-11 量级，不能因此跳档。 */
const capWithTolerance = (cap: number) => cap + Math.abs(cap) * 1e-12;

/** 名义所在档位的下标；名义 ≤ 0 算第 1 档，超过最高一档返回最后一档的下标。 */
export function tierIndexFor(tiers: readonly LeverageTier[], notional: number): number {
  if (tiers.length === 0) return -1;
  if (!(notional > 0)) return 0;
  for (let i = 0; i < tiers.length; i++) {
    if (notional <= capWithTolerance(tiers[i].cap)) return i;
  }
  return tiers.length - 1;
}

/**
 * 名义所在的档位（floor < n ≤ cap；n ≤ 0 算第 1 档）。
 * 超过最高一档的上限时返回最高一档——维持保证金沿用最高一档的费率继续算；
 * 能不能开由 maxLeverageForNotional / exceedsTopCap 判断。
 */
export function tierFor(tiers: readonly LeverageTier[], notional: number): LeverageTier {
  const index = tierIndexFor(tiers, notional);
  if (index < 0) throw new Error('分层表为空');
  return tiers[index];
}

/** 名义是否超过这张表的最高上限（任何杠杆都不能开）。 */
export function exceedsTopCap(tiers: readonly LeverageTier[], notional: number): boolean {
  const top = tiers[tiers.length - 1];
  return !top || notional > capWithTolerance(top.cap);
}

/** 这个名义最高能用多少倍：所在档位的 maxOpenPosLeverage；超过最高上限返回 0。 */
export function maxLeverageForNotional(tiers: readonly LeverageTier[], notional: number): number {
  if (tiers.length === 0 || exceedsTopCap(tiers, notional)) return 0;
  return tierFor(tiers, notional).maxLeverage;
}

/**
 * 杠杆 L 下最多能持有的名义：最后一个 maxOpenPosLeverage ≥ L 的档位的上限。
 * L 高于第 1 档的最高杠杆时返回 0（这个杠杆根本不存在）。
 */
export function maxPositionAtLeverage(tiers: readonly LeverageTier[], leverage: number): number {
  let cap = 0;
  for (const tier of tiers) {
    if (tier.maxLeverage >= leverage) cap = tier.cap;
    else break;
  }
  return cap;
}

/** 维持保证金 = 名义 × 所在档位费率 − 所在档位速算扣除额（与名义同单位）。名义 ≤ 0 为 0。 */
export function maintenanceMargin(tiers: readonly LeverageTier[], notional: number): number {
  if (!(notional > 0) || tiers.length === 0) return 0;
  const tier = tierFor(tiers, notional);
  return notional * tier.maintenanceMarginRate - tier.maintenanceAmount;
}

/** 杠杆夹到 [1, 这个合约的最高杠杆] 的整数；读不出数时取最保守的 1x。 */
export function clampLeverageToTiers(resolvedTiers: Pick<ResolvedSymbolTiers, 'maxLeverage'>, leverage: number): number {
  const max = Math.max(1, Math.floor(resolvedTiers.maxLeverage || 1));
  const value = Number.isFinite(leverage) ? Math.round(leverage) : 1;
  return Math.max(1, Math.min(max, value));
}

// ─────────────────────────── 单位换算 ───────────────────────────

/**
 * 把 USD 名义（getPositionNotionalUsd 的口径：U 本位 = 数量 × 价，币本位 = 张数 × 面值）
 * 换成档位的单位。只有真币本位（measure = coin）要按标记价折成币。
 */
export function tierAmountFromUsdNotional(
  resolvedTiers: Pick<ResolvedSymbolTiers, 'measure'>,
  notionalUsd: number,
  markPrice: number,
): number {
  if (!Number.isFinite(notionalUsd)) return NaN;
  if (resolvedTiers.measure !== 'coin') return notionalUsd;
  return markPrice > 0 ? notionalUsd / markPrice : NaN;
}

/** tierAmountFromUsdNotional 的反向：档位金额 → USD 名义。 */
export function usdNotionalFromTierAmount(
  resolvedTiers: Pick<ResolvedSymbolTiers, 'measure'>,
  amount: number,
  markPrice: number,
): number {
  if (!Number.isFinite(amount)) return NaN;
  if (resolvedTiers.measure !== 'coin') return amount;
  return markPrice > 0 ? amount * markPrice : NaN;
}

/** 档位金额的显示：USDT / USD 取整加千分位，币数保留到 8 位有效小数并去掉尾零。 */
export function formatTierAmount(amount: number, unit: string): string {
  if (!Number.isFinite(amount)) return `-- ${unit}`;
  if (unit === 'USDT' || unit === 'USD') {
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`;
  }
  const text = amount.toLocaleString('en-US', { maximumFractionDigits: 8 });
  return `${text} ${unit}`;
}

// ─────────────────────── 币安逐仓强平价公式 ───────────────────────

/**
 * 币安的做法：先按当前名义所在档位算强平价；算出来的价位上名义落进别的档位，就换那一档重算。
 *
 * 这个过程一定收敛到唯一解：维持保证金在名义上连续、分段线性且斜率（费率）不减，是凸函数，
 * 每一档的直线都是它的支撑线；多单每一档算出的价都不高于真解、且逐步抬高（空单对称），
 * 所以最多走「档位数」步就停在一个自洽的档位上。迭代上限只是防御坏数据。
 */
function solveAcrossTiers(
  tiers: readonly LeverageTier[],
  startNotional: number,
  priceForTier: (tier: LeverageTier) => number,
  notionalAtPrice: (price: number) => number,
): number {
  if (tiers.length === 0) return NaN;
  let index = tierIndexFor(tiers, startNotional);
  let price = priceForTier(tiers[index]);
  for (let step = 0; step <= tiers.length; step++) {
    if (Number.isNaN(price)) return NaN;
    const next = tierIndexFor(tiers, notionalAtPrice(price));
    if (next === index) return price;
    index = next;
    price = priceForTier(tiers[index]);
  }
  return price;
}

export type LiquidationSide = 'LONG' | 'SHORT';

/**
 * U 本位单个逐仓仓位的强平价（币安公式，单向 / 双向持仓的单边、逐仓：TMM = UPNL = 0）：
 *
 *   多：LP = (数量 × 开仓价 − 钱包余额 − cum) ÷ (数量 × (1 − 维持保证金率))
 *   空：LP = (数量 × 开仓价 + 钱包余额 + cum) ÷ (数量 × (1 + 维持保证金率))
 *
 * 钱包余额 = 这个仓位的逐仓保证金（USDT）；档位按 LP 处的名义（数量 × LP）确定。
 * 多单保证金足够厚时结果可以是负数（与旧公式一致，不截到 0）。
 */
export function binanceIsolatedLiquidationPriceUsdm(input: {
  side: LiquidationSide;
  quantity: number;
  entryPrice: number;
  walletBalance: number;
  tiers: readonly LeverageTier[];
}): number {
  const { side, quantity: q, entryPrice: e, walletBalance: wb, tiers } = input;
  if (!(q > 0) || !(e > 0) || !Number.isFinite(wb)) return NaN;
  const priceForTier = (t: LeverageTier) => (side === 'LONG'
    ? (q * e - wb - t.maintenanceAmount) / (q * (1 - t.maintenanceMarginRate))
    : (q * e + wb + t.maintenanceAmount) / (q * (1 + t.maintenanceMarginRate)));
  return solveAcrossTiers(tiers, q * e, priceForTier, price => q * price);
}

/**
 * 币本位单个逐仓仓位的强平价（币安公式，档位以币计、cum 以币计；CM = 面值）：
 *
 *   多：LP = N × (1 + mmr) ÷ (保证金币数 + cum + N ÷ 开仓价)
 *   空：LP = N × (1 − mmr) ÷ (N ÷ 开仓价 − 保证金币数 − cum)
 *
 * N = 张数 × 面值（USD）。档位按 LP 处的币数名义（N ÷ LP）确定。
 * 空单分母 ≤ 0 表示价格涨到多高都不会被强平，返回 Infinity。
 */
export function binanceIsolatedLiquidationPriceCoinm(input: {
  side: LiquidationSide;
  contracts: number;
  contractSizeUsd: number;
  entryPrice: number;
  walletBalanceCoin: number;
  tiers: readonly LeverageTier[];
}): number {
  const { side, contracts, contractSizeUsd, entryPrice: e, walletBalanceCoin: wb, tiers } = input;
  const n = contracts * contractSizeUsd;
  if (!(n > 0) || !(e > 0) || !Number.isFinite(wb)) return NaN;
  const priceForTier = (t: LeverageTier) => {
    if (side === 'LONG') return (n * (1 + t.maintenanceMarginRate)) / (wb + t.maintenanceAmount + n / e);
    const den = n / e - wb - t.maintenanceAmount;
    return den > 0 ? (n * (1 - t.maintenanceMarginRate)) / den : Infinity;
  };
  return solveAcrossTiers(tiers, n / e, priceForTier, price => (price > 0 ? n / price : 0));
}

/**
 * 合成币本位（usdm-proxy / 币本位兜底）的强平价：反向合约的盈亏，U 本位的档位（USD 名义、cum 以 USD 计）。
 *
 *   维持保证金(USD) = N × mmr − cum，N = 张数 × 面值，与价格无关，所以档位固定、不必换档。
 *   多：LP = (N × (1 + mmr) − cum) ÷ (保证金币数 + N ÷ 开仓价)
 *   空：LP = (N × (1 − mmr) + cum) ÷ (N ÷ 开仓价 − 保证金币数)
 *
 * cum = 0 时与旧的 0.4% 币本位公式逐字相同。
 */
export function usdFaceIsolatedLiquidationPriceCoin(input: {
  side: LiquidationSide;
  contracts: number;
  contractSizeUsd: number;
  entryPrice: number;
  walletBalanceCoin: number;
  tiers: readonly LeverageTier[];
}): number {
  const { side, contracts, contractSizeUsd, entryPrice: e, walletBalanceCoin: wb, tiers } = input;
  const n = contracts * contractSizeUsd;
  if (!(n > 0) || !(e > 0) || !Number.isFinite(wb) || tiers.length === 0) return NaN;
  const t = tierFor(tiers, n);
  if (side === 'LONG') return (n * (1 + t.maintenanceMarginRate) - t.maintenanceAmount) / (wb + n / e);
  const den = n / e - wb;
  return den > 0 ? (n * (1 - t.maintenanceMarginRate) + t.maintenanceAmount) / den : Infinity;
}
