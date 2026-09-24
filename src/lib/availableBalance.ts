import type { Position } from '@/types/trading';

/**
 * 可用余额——引擎下单预检（handlePlaceOrder）、改杠杆（applySymbolLeverage）、持仓卡的杠杆对话框、
 * 下单面板的「可用 / 可开 / 100%」与它的杠杆对话框**共用这一个数**，免得同一步操作在一处放行、在另一处被拒。
 *
 * 可用 = 余额 − Σ全仓保证金（全部标的，单一资金池）。
 * 逐仓保证金不再减：开仓时它已经从余额里扣掉了（settleFillDebit 的注释），再减一次就是重复计算——
 * 下单面板此前按「余额 − Σ全部保证金」算，每开一个逐仓仓位「可用」就少算一份它的保证金，
 * 无限制模式下它成了「可开」的唯一上限，杠杆对话框还拿它拒掉引擎放行的降杠杆。
 */
export function calcAvailableBalance(
  balance: number,
  positionsMap: Readonly<Record<string, readonly Pick<Position, 'marginMode' | 'margin'>[] | undefined>>,
): number {
  let totalCrossMargin = 0;
  for (const positions of Object.values(positionsMap)) {
    for (const p of positions ?? []) {
      if (p.marginMode === 'cross') totalCrossMargin += p.margin;
    }
  }
  return balance - totalCrossMargin;
}
