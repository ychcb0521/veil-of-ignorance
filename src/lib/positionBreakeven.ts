/**
 * 仓位卡的「保本线」：把镜像止盈已落袋的利润摊回这副仓位之后的成本线——
 * 价格回到这里，持仓的浮动盈亏与已落袋的镜像利润正好相抵。
 *
 * 【用户要求】「有镜像止盈、且已经用镜像止盈的利润加仓之后，持仓均价……数学上的均价应该与委托空单的价格一致」：
 * 仓位卡原来只有真实成交均价（不扣落袋利润），按上限加满之后它比对冲空单的价高出「用掉的镜像利润 ÷ 总币数」，
 * 对不上。保本线才是加仓计算那套逻辑里的「数学均价」：按上限加满时它正好落在对冲线上，没加满时在对冲线的安全一侧。
 * 已落袋利润**只算镜像止盈**（用户定的口径），见 detectBankedMirrorProfit 的 mirrorUsd / mirrorCoin。
 *
 *   U 本位（线性）：  多 = 均价 − 利润 ÷ 币数            空 = 均价 + 利润 ÷ 币数
 *   币本位（反向）：  多 = 名义 ÷（币数 + 利润币）        空 = 名义 ÷（币数 − 利润币）
 *     反向合约的盈亏是 名义 ×（1/开仓价 − 1/现价），以币计；币数 = 名义 ÷ 均价，利润也以币计。
 *
 * 没有镜像利润时保本线就是均价。算不出（币数 / 均价无效、利润已经大到价格跌到 0 也不亏）返回 null。
 */
export interface PositionBreakevenInput {
  side: 'LONG' | 'SHORT';
  /** 这组仓位全是币本位（反向合约）才按反向公式；混着 U 本位的组按线性近似。 */
  inverse: boolean;
  /** 按各笔开仓价折出的总币量。 */
  coinsAtEntry: number;
  /** 币量加权的开仓均价。 */
  avgEntry: number;
  /** 镜像止盈已落袋利润：线性用 USD，反向用币。 */
  mirrorUsd: number;
  mirrorCoin: number;
}

const usable = (value: number) => Number.isFinite(value) && value > 0;

export function positionBreakevenPrice(input: PositionBreakevenInput): number | null {
  const { side, inverse, coinsAtEntry, avgEntry } = input;
  if (!usable(coinsAtEntry) || !usable(avgEntry)) return null;
  const profit = inverse ? input.mirrorCoin : input.mirrorUsd;
  if (!Number.isFinite(profit) || profit <= 0) return avgEntry;
  if (inverse) {
    const notionalUsd = coinsAtEntry * avgEntry;
    const coins = side === 'SHORT' ? coinsAtEntry - profit : coinsAtEntry + profit;
    return usable(coins) ? notionalUsd / coins : null;
  }
  const line = side === 'SHORT' ? avgEntry + profit / coinsAtEntry : avgEntry - profit / coinsAtEntry;
  return usable(line) ? line : null;
}
