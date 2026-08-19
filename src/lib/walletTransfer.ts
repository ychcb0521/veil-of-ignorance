/**
 * 钱包划转 —— 按币安的「划转」语义在同一账号的三个钱包之间搬钱。
 *
 * 币安的划转是账内转移，不是出入金：
 *   · 即时到账、不收手续费；
 *   · 划转前后账户总资产严格不变（这是本模块最重要的不变量）；
 *   · 来源与目标不能相同；
 *   · 金额必须为正，且不超过来源钱包的「可用」余额。
 *
 * 合约钱包的可划转额取「可用余额」而非权益：已被持仓占用的保证金和未实现盈亏
 * 都不能划走——这与币安一致，也与本引擎的记账一致（开仓扣 balance、平仓退回）。
 */

export type WalletId = 'futures' | 'spot' | 'funding';

export const WALLET_IDS: WalletId[] = ['futures', 'spot', 'funding'];

export const WALLET_LABELS: Record<WalletId, { zh: string; en: string }> = {
  futures: { zh: '合约', en: 'Futures' },
  spot: { zh: '现货', en: 'Spot' },
  funding: { zh: '资金', en: 'Funding' },
};

/** 各钱包的可划转余额。 */
export type WalletBalances = Record<WalletId, number>;

export type TransferRejection =
  /** 来源与目标是同一个钱包 */
  | 'same-wallet'
  /** 金额非有限数、为 0 或为负 */
  | 'invalid-amount'
  /** 超过来源钱包可用余额 */
  | 'insufficient';

export interface TransferRequest {
  from: WalletId;
  to: WalletId;
  amount: number;
}

export type TransferValidation =
  | { ok: true; amount: number }
  | { ok: false; reason: TransferRejection; message: string };

/**
 * USDT 记账精度。浮点累加会漂移（0.1+0.2≠0.3），每一步都归整到 8 位，
 * 才能保证「划转前后总额不变」这条不变量在多次往返后依然成立。
 */
const SCALE = 1e8;

export function roundAmount(value: number): number {
  return Math.round(value * SCALE) / SCALE;
}

/** 来源钱包此刻最多能划走多少——UI 的「最大」按钮与校验共用同一口径。 */
export function maxTransferable(balances: WalletBalances, from: WalletId): number {
  const available = balances[from];
  if (!Number.isFinite(available) || available <= 0) return 0;
  return roundAmount(available);
}

export function validateTransfer(
  balances: WalletBalances,
  request: TransferRequest,
): TransferValidation {
  const { from, to, amount } = request;
  if (from === to) {
    return { ok: false, reason: 'same-wallet', message: '来源与目标钱包不能相同' };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'invalid-amount', message: '请输入大于 0 的划转数量' };
  }
  const rounded = roundAmount(amount);
  const limit = maxTransferable(balances, from);
  // 用归整后的值比较：否则 12.3 与 12.299999999 这类输入会被误判为超额
  if (rounded > limit) {
    return { ok: false, reason: 'insufficient', message: '划转数量超过可用余额' };
  }
  return { ok: true, amount: rounded };
}

/**
 * 结算一笔划转，返回新的余额表。调用前必须先 validateTransfer——
 * 这里只做结算，不重复校验，避免两处规则各自演化。
 */
export function applyTransfer(
  balances: WalletBalances,
  request: TransferRequest & { amount: number },
): WalletBalances {
  const { from, to, amount } = request;
  return {
    ...balances,
    [from]: roundAmount(balances[from] - amount),
    [to]: roundAmount(balances[to] + amount),
  };
}

/** 一条划转记录，用于「划转记录」列表。 */
export interface TransferRecord {
  id: string;
  from: WalletId;
  to: WalletId;
  amount: number;
  /** 模拟时间（与交易记录同一时间轴），毫秒。 */
  timestamp: number;
  asset: 'USDT';
}
