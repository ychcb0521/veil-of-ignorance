/**
 * 币安杠杆分层快照的数据入口（只做类型与查表，不含任何规则）。
 *
 * 数据由 scripts/update-binance-leverage-tiers.mjs 生成，来源是币安网页用的公开分层接口
 * 与 dapi exchangeInfo；快照时间见 fetchedAt。体积约 93 KB（gzip 约 17 KB），
 * 低于 200 KB 的拆包门槛，所以直接静态打进主包，不做懒加载。
 *
 * 单独成一个模块是为了避开循环依赖：coinMargined 要从这里取面值，
 * 而 leverageTiers 又要用 coinMargined 的符号换算。
 */
import raw from '@/data/binanceLeverageTiers.json';

/** [floor, cap, maxLeverage, maintenanceMarginRate, maintenanceAmount(cum)] */
export type LeverageTierRow = readonly [number, number, number, number, number];

export interface LeverageTierTableSet {
  tables: readonly (readonly LeverageTierRow[])[];
  symbols: Readonly<Record<string, number>>;
}

export interface BinanceLeverageTierData {
  fetchedAt: string;
  sources: Readonly<Record<string, string | null>>;
  /** U 本位：floor / cap / cum 以 USDT 计（名义 = 数量 × 标记价）。 */
  usdm: LeverageTierTableSet;
  /** 币本位：floor / cap / cum 以币计（名义 = 张数 × 面值 ÷ 标记价）。 */
  coinm: LeverageTierTableSet & { contractSizeUsd: Readonly<Record<string, number>> };
  /** 使用最多的那张 U 本位表的下标；快照里查不到的标的暂按它处理。 */
  fallbackUsdmTable: number;
}

export const LEVERAGE_TIER_DATA = raw as unknown as BinanceLeverageTierData;

/** 快照日期（UTC，YYYY-MM-DD），界面上写「分层快照 2026-09-16」用。 */
export const LEVERAGE_TIER_SNAPSHOT_DATE = String(LEVERAGE_TIER_DATA.fetchedAt).slice(0, 10);

/**
 * 币安币本位合约的面值（USD/张），按交易对查（BTCUSD → 100）。
 * 币安没有上线这个币的币本位合约时返回 null，由调用方决定合成合约的默认面值。
 */
export function listedCoinContractSizeUsd(baseAsset: string): number | null {
  const value = LEVERAGE_TIER_DATA.coinm.contractSizeUsd[`${String(baseAsset || '').toUpperCase()}USD`];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 快照里有没有这个基础币的合约（U 本位 BASEUSDT 或币本位 BASEUSD）。
 * 只用来给交易对切基础币消歧：'BNBUSD' 既以 BUSD 结尾又以 USD 结尾，
 * 切成 'BN' 还是 'BNB' 得问快照（见 coinMargined.getSettlementAsset）。
 */
export function isListedBaseAsset(baseAsset: string): boolean {
  const base = String(baseAsset || '').toUpperCase();
  if (!base) return false;
  return LEVERAGE_TIER_DATA.usdm.symbols[`${base}USDT`] != null
    || LEVERAGE_TIER_DATA.coinm.contractSizeUsd[`${base}USD`] != null;
}
