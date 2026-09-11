/**
 * 爆仓弹窗的口径：逐仓与全仓是两种完全不同的强平，文案必须分开。
 *
 * 原来只有全仓会弹窗，文案写死为「所有挂单已撤销，所有持仓已按市价强制平仓」
 * 「包含 0.5% 强平清算费」。逐仓强平接入同一个弹窗之后，这两句对逐仓全是错的：
 * 逐仓只接管那一笔仓位、只撤它自己的止盈止损，按破产价结算，费用是保证金亏剩下的部分。
 * 连全仓那句也不对——全仓强平从来不动逐仓仓位（见 TradingContext 的撤单范围）。
 */
import { LIQUIDATION_FEE_RATE, MAINTENANCE_MARGIN_RATE } from '@/types/trading';

export type LiquidationScope = 'isolated' | 'cross' | 'mixed';

export interface LiquidationDetails {
  lostAmount: number;
  liquidatedPositions: number;
  /** 缺省按全仓口径（老调用方）。 */
  scope?: LiquidationScope;
}

/** 弹窗还开着时又发生强平：并入同一个弹窗，数字累加，而不是把前一笔覆盖掉。 */
export function mergeLiquidationDetails(a: LiquidationDetails, b: LiquidationDetails): LiquidationDetails {
  const sa = a.scope ?? 'cross';
  const sb = b.scope ?? 'cross';
  return {
    lostAmount: a.lostAmount + b.lostAmount,
    liquidatedPositions: a.liquidatedPositions + b.liquidatedPositions,
    scope: sa === sb ? sa : 'mixed',
  };
}

export interface LiquidationNoticeCopy {
  lead: string;
  /** 正文里加粗标红的那一段。 */
  emphasis: string;
  tail: string;
  footnote: string;
}

const pct = (rate: number) => `${+(rate * 100).toFixed(2)}%`;

export function liquidationNoticeCopy(scope: LiquidationScope = 'cross', count = 1): LiquidationNoticeCopy {
  const mmr = `维持保证金率 ${pct(MAINTENANCE_MARGIN_RATE)}`;
  const crossFee = `${pct(LIQUIDATION_FEE_RATE)} 强平清算费`;
  if (scope === 'isolated') {
    const many = count > 1;
    return {
      lead: many ? `逐仓保证金已耗尽，${count} 笔逐仓仓位已被` : '逐仓保证金已耗尽，该仓位已被',
      emphasis: '强制接管',
      tail: many
        ? '。按破产价结算：亏损以各自的保证金为限，挂在它们上面的止盈止损已撤销，其余仓位不受影响。'
        : '。按破产价结算：亏损以这笔仓位的保证金为限，挂在它上面的止盈止损已撤销，其余仓位不受影响。',
      footnote: `保证金亏剩的部分计为强平费 · ${mmr}`,
    };
  }
  if (scope === 'mixed') {
    return {
      lead: '逐仓与全仓仓位先后被',
      emphasis: '强制接管',
      tail: '。逐仓按破产价结算，亏损以各自保证金为限；全仓按市价平仓。这些仓位上的委托已撤销。',
      footnote: `逐仓：保证金亏剩的部分计为强平费 · 全仓：包含 ${crossFee} · ${mmr}`,
    };
  }
  return {
    lead: '全仓权益跌破维持保证金，所有全仓仓位已被',
    emphasis: '按市价强制平仓',
    tail: '。挂在这些仓位上的委托已撤销；逐仓仓位不受影响。',
    footnote: `包含 ${crossFee} · ${mmr}`,
  };
}
