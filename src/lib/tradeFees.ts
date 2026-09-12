/**
 * 一条成交记录的完整手续费：开仓费 + 平仓费，按币安合约的口径读出来给战役页用。
 *
 * 为什么需要这一层：记录里的 `pnl` 是「毛盈亏 − 平仓费」，而开仓费在开仓当时就从钱包扣走了，
 * 记录里一直没有它（这个应用不写 OPEN 记录）。于是会出现「平仓价高于开仓价却亏损」：
 * HPEUSDT 2026-09-12 主多 62.0584 → 62.0646，毛盈亏 +74.36，平仓 Taker 费 297.75，
 * 记录写 −223.39；开仓那一笔 297.72 的 Taker 费另外从钱包扣了，钱包净结果其实是 −521。
 *
 * 币安口径（官方 FAQ「Binance Futures Fee Structure & Fee Calculations」）：
 *   手续费 = 名义价值 × 费率，开仓、平仓各收一次
 *   U 本位：名义 = 数量 × 成交价，以 USDT 计
 *   币本位：名义 = 张数 × 面值 ÷ 成交价，以币计（折美元就是 张数 × 面值 × 费率）
 *   市价单、触发后的止损/止盈市价单是 Taker；挂在盘口成交的限价单是 Maker
 *
 * 2026-09-12 之后的成交把开仓费、费率、Maker/Taker 都存进了记录；之前的记录没有，
 * 这里按它们成交当时模拟器实际收的费率（LEGACY_TAKER_FEE，0.04%，全部按 Taker）从名义推算，
 * 并标明「估算」——用今天的费率去估当年扣走的钱会对不上钱包。
 */
import { LEGACY_TAKER_FEE, MAKER_FEE, TAKER_FEE, type TradeRecord } from '@/types/trading';
import { getPositionNotionalUsd, isCoinSettled } from '@/lib/tradingSettlement';
import { getSettlementAsset } from '@/lib/coinMargined';

export interface FeeSide {
  usd: number;
  /** 币本位：以币计的手续费；U 本位为 null。 */
  coin: number | null;
  /** 适用费率（小数，0.0005 = 0.05%）；说不清时为 null。 */
  rate: number | null;
  /** Maker 还是 Taker；说不清时为 null。 */
  maker: boolean | null;
  /** 记录里没存，按当年费率从名义推算出来的。 */
  estimated: boolean;
}

/**
 * 币本位手续费按币计。币价差几个数量级：ASTER 一笔是 86.54，BTC 一笔是 0.0000495，
 * 所以大于 1 保留两位小数、小于 1 按四位有效数字，两种都读得出来。
 */
export function formatFeeCoin(coin: number | null | undefined, asset?: string): string {
  if (!finite(coin)) return '—';
  // 上千的币数不报小数：4,003 个币的手续费里那 0.71 个是噪声，却要占掉三个字符宽，
  // 而这一列本来就窄——小数点后那一点精度换不来任何判断。
  const magnitude = Math.abs(coin);
  const text = magnitude >= 1000
    ? coin.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : magnitude >= 1
      ? coin.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : coin.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  return asset ? `${text} ${asset}` : text;
}

export interface TradeRecordFees {
  /** 开仓费；记录连开仓价 / 数量都没有时为 null。 */
  open: FeeSide | null;
  /** 平仓费。强平记录里它包含强平清算费（见 liquidationFeeUsd）。 */
  close: FeeSide;
  /** 平仓费里包含的强平清算费；非强平记录为 null。 */
  liquidationFeeUsd: number | null;
  /** 币本位：手续费按币结算，开平两笔的**币数**不同（价格越高付的币越少），美元数却相同。 */
  coinSettled: boolean;
  /** 结算币种，如 BTC / ASTER；U 本位为 'USDT'。 */
  asset: string;
  /** 开仓费 + 平仓费；开仓费未知时为 null。 */
  totalUsd: number | null;
  /** 币本位的币计合计；U 本位为 null。 */
  totalCoin: number | null;
  /** 记录盈亏（已扣平仓费）再扣开仓费：这一笔对钱包的净影响。 */
  netAfterOpenFee: number | null;
  /** 任一侧是估算的。 */
  estimated: boolean;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 记录在某个价上的名义（USD）：U 本位 数量 × 价；币本位 张数 × 面值。 */
export function tradeRecordNotionalUsdAt(record: TradeRecord, price: number): number | null {
  if (!finite(price) || price <= 0) return null;
  const notional = getPositionNotionalUsd(record.symbol, record, price);
  return finite(notional) && notional > 0 ? notional : null;
}

function openSide(record: TradeRecord): FeeSide | null {
  if (finite(record.openFeeUsd)) {
    return {
      usd: record.openFeeUsd,
      coin: finite(record.openFeeCoin) ? record.openFeeCoin : null,
      rate: finite(record.openFeeRate) ? record.openFeeRate : null,
      maker: typeof record.openIsMaker === 'boolean' ? record.openIsMaker : null,
      estimated: false,
    };
  }
  // 旧记录：开仓当时全部按 Taker、按当年费率收的，从开仓名义倒推。
  const notional = tradeRecordNotionalUsdAt(record, record.entryPrice);
  if (notional == null) return null;
  const usd = notional * LEGACY_TAKER_FEE;
  return {
    usd,
    coin: isCoinSettled(record) ? usd / record.entryPrice : null,
    rate: LEGACY_TAKER_FEE,
    maker: false,
    estimated: true,
  };
}

function closeSide(record: TradeRecord): FeeSide {
  const usd = finite(record.fee) ? record.fee : 0;
  const liquidation = record.action === 'LIQUIDATION';
  // 币本位的老记录若没存 feeCoin，按「美元 ÷ 平仓价」还原——与 coinFeeAmount 同一条式子。
  const coinFallback = isCoinSettled(record) && record.exitPrice > 0 ? usd / record.exitPrice : null;
  if (finite(record.closeFeeRate)) {
    return {
      usd,
      coin: finite(record.feeCoin) ? record.feeCoin : coinFallback,
      rate: record.closeFeeRate,
      maker: typeof record.closeIsMaker === 'boolean' ? record.closeIsMaker : false,
      estimated: false,
    };
  }
  // 旧记录：金额是存下来的（准确），只有费率没存。平仓在这个应用里一律按 Taker 收；
  // 非强平记录可以从 费 ÷ 平仓名义 把当时的费率倒推出来，强平记录里混着强平费，倒推不出。
  const notional = liquidation ? null : tradeRecordNotionalUsdAt(record, record.exitPrice);
  const impliedRate = notional != null && usd > 0 ? usd / notional : null;
  return {
    usd,
    coin: finite(record.feeCoin) ? record.feeCoin : coinFallback,
    rate: impliedRate != null && impliedRate > 0 && impliedRate < 0.01 ? impliedRate : null,
    maker: false,
    estimated: true,
  };
}

export function tradeRecordFees(record: TradeRecord): TradeRecordFees {
  const open = openSide(record);
  const close = closeSide(record);
  const liquidationFeeUsd = record.action === 'LIQUIDATION'
    ? (finite(record.liquidationFeeUsd) ? record.liquidationFeeUsd : null)
    : null;
  const totalUsd = open ? open.usd + close.usd : null;
  const coinSettled = isCoinSettled(record);
  const totalCoin = coinSettled && open?.coin != null && close.coin != null
    ? open.coin + close.coin
    : null;
  const pnl = finite(record.pnl) ? record.pnl : null;
  return {
    open,
    close,
    liquidationFeeUsd,
    coinSettled,
    asset: coinSettled ? (record.settlementAsset || getSettlementAsset(record.symbol)) : 'USDT',
    totalUsd,
    totalCoin,
    netAfterOpenFee: open && pnl != null ? pnl - open.usd : null,
    estimated: Boolean(open?.estimated) || close.estimated,
  };
}

/** 0.0005 → "0.05%"。 */
export function formatFeeRate(rate: number | null | undefined): string {
  if (!finite(rate)) return '—';
  return `${+(rate * 100).toFixed(4)}%`;
}

/** 「Taker 0.05%」「Maker 0.02%」「Taker ≈0.04%」（费率是倒推的）「Taker（估）」。 */
export function feeKindLabel(side: FeeSide): string {
  const kind = side.maker == null ? '—' : side.maker ? 'Maker' : 'Taker';
  if (side.rate == null) return side.estimated ? `${kind}（估）` : kind;
  const rate = formatFeeRate(side.rate);
  return side.estimated ? `${kind} ≈${rate}` : `${kind} ${rate}`;
}

const money = (v: number) => v.toFixed(2);
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

/**
 * 给界面 tooltip 用的一段完整说明：把币安的式子、这条记录的名义、费率、两笔费用和
 * 「盈亏列为什么是这个数」一次讲清楚。
 */
export function describeTradeRecordFees(record: TradeRecord): string {
  const fees = tradeRecordFees(record);
  const coin = isCoinSettled(record);
  const parts: string[] = [];
  if (fees.totalUsd != null && fees.open != null) {
    parts.push(
      `这一笔手续费合计 ${money(fees.totalUsd)} USDT（开仓 ${money(fees.open.usd)} + 平仓 ${money(fees.close.usd)}），钱包按这个数扣。`,
    );
  }
  parts.push(
    coin
      ? `币安口径（币本位）：手续费 = 名义 × 费率，名义 = 张数 × 面值 ÷ 成交价，收的是 ${fees.asset}；`
        + '钱包再按成交当时的价折成 USDT。折算之后价格被约掉（= 张数 × 面值 × 费率），'
        + '所以开平两笔的**金额必然相同**，差别只在**币数**：成交价越高，同一笔名义付出的币越少。'
      : '币安口径（U 本位）：手续费 = 数量 × 成交价 × 费率，直接以 USDT 计。平仓价高于开仓价时，平仓费也高于开仓费。',
  );
  if (coin && fees.open?.coin != null && fees.close.coin != null) {
    parts.push(
      `币数：开仓 ${formatFeeCoin(fees.open.coin, fees.asset)}、平仓 ${formatFeeCoin(fees.close.coin, fees.asset)}，`
      + `合计 ${formatFeeCoin(fees.totalCoin, fees.asset)}。`,
    );
  }
  const openNotional = tradeRecordNotionalUsdAt(record, record.entryPrice);
  if (fees.open && openNotional != null) {
    parts.push(
      `开仓：${money(openNotional)} × ${formatFeeRate(fees.open.rate)} = ${money(fees.open.usd)}（${fees.open.maker ? 'Maker' : 'Taker'}${fees.open.estimated ? '，记录未存开仓费，按当时费率估算' : ''}）。`,
    );
  } else if (fees.open) {
    parts.push(`开仓费 ${money(fees.open.usd)}${fees.open.estimated ? '（估算）' : ''}。`);
  } else {
    parts.push('开仓费：记录缺少开仓价或数量，无法给出。');
  }
  const closeNotional = tradeRecordNotionalUsdAt(record, record.exitPrice);
  if (fees.liquidationFeeUsd != null) {
    parts.push(`平仓：${money(fees.close.usd)}，其中强平清算费 ${money(fees.liquidationFeeUsd)}。`);
  } else if (closeNotional != null && fees.close.rate != null) {
    parts.push(
      `平仓：${money(closeNotional)} × ${formatFeeRate(fees.close.rate)} = ${money(fees.close.usd)}（${fees.close.maker ? 'Maker' : 'Taker'}${fees.close.estimated ? '，费率由记录倒推' : ''}）。`,
    );
  } else {
    parts.push(`平仓费 ${money(fees.close.usd)}。`);
  }
  if (finite(record.pnl)) {
    if (record.liquidationSettlement === 'bankruptcy') {
      parts.push(`盈亏列按破产价结算（亏损 = 逐仓保证金），已含平仓费与强平费。`);
    } else {
      const gross = record.pnl + fees.close.usd;
      parts.push(`盈亏列 = 毛盈亏 ${signed(gross)} − 平仓费 ${money(fees.close.usd)} = ${signed(record.pnl)}。`);
    }
    if (fees.netAfterOpenFee != null) {
      parts.push(`开仓费在开仓当时已从钱包扣除；再扣开仓费后这一笔的净结果为 ${signed(fees.netAfterOpenFee)}。`);
    }
  }
  return parts.join(' ');
}

/** 一批记录的手续费合计（按记录 id 去重：同一条记录挂在几条腿上只算一次）。 */
export function sumTradeRecordFees(records: Iterable<TradeRecord>): {
  totalUsd: number;
  /** 全部是同一币种的币本位记录时给出币计合计，否则为 null（不同币种不能相加）。 */
  totalCoin: number | null;
  asset: string;
  estimated: boolean;
} | null {
  const seen = new Set<string>();
  let total = 0;
  let coinTotal = 0;
  let any = false;
  let estimated = false;
  let coinOk = true;
  let asset = 'USDT';
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const fees = tradeRecordFees(record);
    if (fees.totalUsd == null) continue;
    total += fees.totalUsd;
    any = true;
    estimated ||= fees.estimated;
    if (fees.coinSettled && fees.totalCoin != null && (asset === 'USDT' || asset === fees.asset)) {
      asset = fees.asset;
      coinTotal += fees.totalCoin;
    } else {
      coinOk = false;
    }
  }
  if (!any) return null;
  return { totalUsd: total, totalCoin: coinOk && asset !== 'USDT' ? coinTotal : null, asset, estimated };
}

/** 当前费率表（供界面展示）。 */
export const FEE_SCHEDULE = { maker: MAKER_FEE, taker: TAKER_FEE } as const;
