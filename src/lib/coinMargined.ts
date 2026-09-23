import type { OrderSide } from '@/types/trading';
import { isListedBaseAsset, listedCoinContractSizeUsd } from '@/lib/leverageTierData';

export type CoinLikeInstrument = {
  settlementMode?: 'usdt' | 'coin' | null;
  settlementAsset?: string | null;
  contractSizeUsd?: number | null;
  contracts?: number | null;
  quantity?: number | null;
};

/** 可能的计价后缀。真正用到的只有 USDT 与 USD，USDC / BUSD 是历史上的交易对留的。 */
const QUOTE_ASSETS = ['USDT', 'USDC', 'BUSD', 'USD'] as const;

/**
 * 交易对的基础币。计价后缀**只去掉一个**：此前 USDT、USDC、BUSD、USD 依次各去一遍，
 * USDCUSDT → USDC → '' → 兜底成 BTC（FDUSDUSDT 则变成 FD），币本位于是借错了合约的分层与面值。
 *
 * 一个后缀也可能有两种切法：'BNBUSD' 既以 BUSD 结尾又以 USD 结尾（ARBUSD、TRBUSD……凡是基础币以 B 结尾的都是），
 * 只按最长的后缀切会得到 'BN'，于是查不到 BNBUSD_PERP，币本位 BNB 悄悄借了通用 U 本位表（50x）而不是它自己的 20x。
 * 所以**留得多的先试**（后缀短的先试），取快照里真有这个合约的那一个：BNBUSD → BNB（快照有 BNBUSDT / BNBUSD，没有 BNUSDT）。
 * 都查不到就退回原来的切法（后缀长的优先），BUSD 计价的老交易对（BTCBUSD → BTC）因此不变。
 */
export function getSettlementAsset(symbol: string): string {
  const normalized = (symbol || 'BTCUSDT').toUpperCase().replace(/[-_/]/g, '').replace(/PERP$/, '');
  const bases = QUOTE_ASSETS
    .filter(quote => normalized.endsWith(quote))
    .map(quote => normalized.slice(0, -quote.length))
    .sort((a, b) => b.length - a.length);
  const stripped = bases.find(base => base && isListedBaseAsset(base)) ?? bases[bases.length - 1] ?? normalized;
  return stripped || 'BTC';
}

export function getCoinMarginedSymbol(symbol: string): string {
  return `${getSettlementAsset(symbol)}USD_PERP`;
}

/** 币安没有上线的币本位合约（模拟器合成的，例如 KAITOUSD）按主流山寨币的面值：10 USD/张。 */
export const SYNTHETIC_COIN_CONTRACT_SIZE_USD = 10;

/**
 * 币本位合约面值（USD/张）。币安已上线的按 dapi exchangeInfo 的 contractSize
 * （快照：BTCUSD 100，其余 19 个永续 10）；没上线的合成合约取 10。
 */
export function getCoinMarginedContractSizeUsd(symbol: string): number {
  return listedCoinContractSizeUsd(getSettlementAsset(symbol)) ?? SYNTHETIC_COIN_CONTRACT_SIZE_USD;
}

export function getCoinContractSizeUsd(symbol: string, item?: CoinLikeInstrument | null): number {
  const value = Number(item?.contractSizeUsd);
  return Number.isFinite(value) && value > 0 ? value : getCoinMarginedContractSizeUsd(symbol);
}

/**
 * 把张数取整到合约粒度，**不设下限**。可能返回 0——那正是「这一单小于一张」的信号。
 *
 * 与 roundCoinContracts 有两处区别，都是要害：
 *
 * 1. **不设下限**。后者写着 Math.max(1, …)，于是「不足一张」被静默放大成一张。
 *    币本位一张面值 10 USD（BTC 100 USD），在 0.4092 的币价上一张 ≈ 24.44 个币——
 *    用户在「币金额」档填 10，期望 ≈4.09 USD 的仓位，拿到的是 10 USD、24.44 个币，
 *    **2.4 倍**，而输入框自始至终显示「10」。
 *
 * 2. **向下取整，不是四舍五入**。输入框里的数字是用户的**授权上限**：
 *    保证金、手续费、强平距离全都随它等比放大，多开的那一截是他从没批准过的钱。
 *    少开可以再补一单，多开要付一个 taker 来回加滑点才能削回去；真实交易所对
 *    LOT_SIZE 也一律截断。四舍五入下 1.514 张 → 2 张，用户填 37 个币拿到 48.88 个，
 *    多 32%，而这正是「填的数和拿到的数不一样」这件事本身。
 *    ε 是为了 2.9999999 这种浮点噪声，别让它掉成 2。
 */
export function coinContractsExact(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // ε=1e-7：显示值走 toFixed(6) 的字符串来回后,张数会带 ~1e-8 量级的噪声
  // （95.417571 × 价 ÷ 面值 = 3.99999996…),1e-9 吸不住它,会把 4 张掉成 3。
  // 1e-7 仍远小于半张,不会把真实的 3.9 抬成 4。
  return Math.floor(value + 1e-7);
}

export function coinContractsExactFromUsdNotional(
  notionalUsd: number,
  symbol: string,
  contractSizeUsd = getCoinMarginedContractSizeUsd(symbol),
): number {
  if (!(contractSizeUsd > 0)) return 0;
  return coinContractsExact(Number(notionalUsd) / contractSizeUsd);
}

/**
 * 规范化**已经存在的**订单/仓位的张数。这里保留 Math.max(1, …)：
 * 一张已经成交的单子不该被读成 0 张（那会变成幽灵仓位）。
 * ⚠ 但它绝不能用在「把用户输入换算成下单量」的路径上——见 coinContractsExact。
 */
export function roundCoinContracts(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 0;
}

export function getCoinContracts(item?: CoinLikeInstrument | null): number {
  return roundCoinContracts(Number(item?.contracts ?? item?.quantity ?? 0));
}

export function coinContractsFromUsdNotional(
  notionalUsd: number,
  symbol: string,
  contractSizeUsd = getCoinMarginedContractSizeUsd(symbol),
): number {
  return roundCoinContracts(Number(notionalUsd) / contractSizeUsd);
}

export function coinNotionalUsd(contracts: number, contractSizeUsd: number): number {
  return getCoinContracts({ contracts }) * contractSizeUsd;
}

export function coinMarginAmount(
  contracts: number,
  price: number,
  leverage: number,
  contractSizeUsd: number,
): number {
  if (!(price > 0) || !(leverage > 0)) return 0;
  return coinNotionalUsd(contracts, contractSizeUsd) / (price * leverage);
}

export function coinFeeAmount(
  contracts: number,
  price: number,
  feeRate: number,
  contractSizeUsd: number,
): number {
  if (!(price > 0)) return 0;
  return coinNotionalUsd(contracts, contractSizeUsd) * feeRate / price;
}

export function coinPnlAmount(
  side: OrderSide,
  contracts: number,
  entryPrice: number,
  exitPrice: number,
  contractSizeUsd: number,
): number {
  if (!(entryPrice > 0) || !(exitPrice > 0)) return 0;
  const notional = coinNotionalUsd(contracts, contractSizeUsd);
  return side === 'LONG'
    ? notional * (1 / entryPrice - 1 / exitPrice)
    : notional * (1 / exitPrice - 1 / entryPrice);
}

export function coinAmountToUsd(amount: number, price: number): number {
  return Number.isFinite(amount) && Number.isFinite(price) ? amount * price : 0;
}

/**
 * 名义仓位的「币本位计数」：把 USD 名义按给定价格折成以币计的数量。
 *
 * 币本位合约的面值以 USD 计（1 张 = N USD），所以名义天然是 USD。
 * 但持仓者关心的是「这笔仓位相当于多少枚币」——那才是币本位的自然读数，
 * 也与下单面板「以币计的订单金额」同一口径，两处对得上。
 *
 * 价格非正时返回 null（不臆造 0，否则会被误读成空仓）。
 */
export function coinNotionalAmount(notionalUsd: number, price: number): number | null {
  if (!(price > 0) || !Number.isFinite(notionalUsd)) return null;
  const amount = notionalUsd / price;
  return Number.isFinite(amount) ? amount : null;
}

export function formatCoinAmount(amount: number, asset: string, decimals = 6): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe.toFixed(decimals)} ${asset}`;
}

export function isCoinMarginedInstrument(item?: CoinLikeInstrument | null): boolean {
  return item?.settlementMode === 'coin';
}
