import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QuietInfo } from '@/components/journal/QuietInfo';
import { formatAddSizingCoinQuantity } from '@/lib/campaignAddSizingCheck';
import { formatLegGeometricFactor, LEG_GEOMETRIC_FACTOR_HINT, LEG_THEORETICAL_FACTOR_HINT, type LegGeometricFactor, type LegTheoreticalGeometricFactor } from '@/lib/campaignLegGeometricFactor';
import { MIRROR_REDUCTION_FACTOR_HINT } from '@/lib/campaignMirrorReductionFactor';

/** Explain the already-computed actual-fill factor; opening this view never recalculates sizing. */
export function LegGeometricFactorDialog({ ordinal, factor, theoretical, reductionTheoretical = false, onClose }: {
  ordinal: string;
  factor: LegGeometricFactor;
  theoretical?: LegTheoreticalGeometricFactor;
  reductionTheoretical?: boolean;
  onClose: () => void;
}) {
  const ratio = factor.addCoins / factor.beforeCoins;
  const reduction = factor.kind === 'reduction';
  const isTheory = !!theoretical || reductionTheoretical;
  const coins = formatAddSizingCoinQuantity;
  const decimal = (value: number) => value.toFixed(12).replace(/\.?0+$/, '');
  const steps = reduction ? [
    ['① 减仓前合计币数', `Q前 = ${coins(factor.beforeCoins)} 币（主力 + 镜像）`],
    ['② 镜像实际减仓币数', `ΔQ减 = ${coins(factor.addCoins)} 币`],
    ['③ 减仓比例 αf', `αf = ΔQ减 ÷ Q前 = ${coins(factor.addCoins)} ÷ ${coins(factor.beforeCoins)} ≈ ${decimal(ratio)}（${(ratio * 100).toFixed(2)}%）`],
    ['④ 减仓后剩余币数', `Q后 = Q前 − ΔQ减 = ${coins(factor.beforeCoins)} − ${coins(factor.addCoins)} = ${coins(factor.beforeCoins - factor.addCoins)} 币`],
    ['⑤ 仓位保留因子', `1 − αf = Q后 ÷ Q前 = ${coins(factor.beforeCoins - factor.addCoins)} ÷ ${coins(factor.beforeCoins)} ≈ ${decimal(factor.multiple)} ≈ ${formatLegGeometricFactor(factor)}`],
    ...(isTheory ? [['⑥ 理论减仓口径', '理论累计公式也使用实际首次减仓比例，故此减仓因子与实际值相同。']] : []),
  ] : theoretical ? [
    ['① 当次实际持仓基数', `Q前 = ${coins(factor.beforeCoins)} 币；成本线 S前 = ${decimal(theoretical.costLine)}`],
    ['② 实际加仓价与支撑线', `T = ${decimal(theoretical.addPrice)}；K = ${decimal(theoretical.support)}`],
    ...(theoretical.firstAdd ? [['③ 首次覆盖预算调整', `G = ${coins(theoretical.bankedProfit)} U；K* = K ${theoretical.addPrice > theoretical.support ? '+' : '−'} G ÷ Q前 = ${decimal(theoretical.adjustedSupport)}`]] : [['③ 后续成本线口径', '使用当次实际持仓加权成本 S前，不使用扣除 G 的保本线。']]),
    ['④ 理论加仓比例', `α理论 = max(0, ${theoretical.addPrice > theoretical.support ? `${decimal(theoretical.adjustedSupport)} − ${decimal(theoretical.costLine)}` : `${decimal(theoretical.costLine)} − ${decimal(theoretical.adjustedSupport)}`}) ÷ |${decimal(theoretical.addPrice)} − ${decimal(theoretical.support)}| ≈ ${decimal(ratio)}（${(ratio * 100).toFixed(2)}%）`],
    ['⑤ 理论可加币数', `ΔQ理论 = Q前 × α理论 ≈ ${coins(factor.addCoins)} 币`],
    ['⑥ 仓位的几何复利（理论）', `1 + α理论 = 1 + ${decimal(ratio)} ≈ ${formatLegGeometricFactor(factor)}`],
  ] : [
    ['① 加仓前持币数', `Q前 = ${coins(factor.beforeCoins)} 币`],
    ['② 实际新增币数', `ΔQ = ${coins(factor.addCoins)} 币`],
    ['③ 加仓比例 α', `α = ΔQ ÷ Q前 = ${coins(factor.addCoins)} ÷ ${coins(factor.beforeCoins)} ≈ ${decimal(ratio)}（${(ratio * 100).toFixed(2)}%）`],
    ['④ 加仓后总币数', `Q后 = Q前 + ΔQ = ${coins(factor.beforeCoins)} + ${coins(factor.addCoins)} = ${coins(factor.beforeCoins + factor.addCoins)} 币`],
    ['⑤ 仓位的几何复利', `1 + α = Q后 ÷ Q前 = ${coins(factor.beforeCoins + factor.addCoins)} ÷ ${coins(factor.beforeCoins)} ≈ ${decimal(factor.multiple)} ≈ ${formatLegGeometricFactor(factor)}`],
  ];
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[94vh] overflow-y-auto gap-3 sm:max-w-[760px]" data-testid="leg-geometric-factor-detail-dialog">
        <DialogHeader>
          <DialogTitle className="pr-8">{reduction ? '镜像止盈 · 减仓因子' : `加仓${ordinal} · 仓位的几何复利`}{isTheory ? '（理论）' : ''}</DialogTitle>
          <DialogDescription className="sr-only">本次仓位变化的倍数与完整计算过程，区分实际成交与理论计算。</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-[#0ECB81]/25 bg-[#0ECB81]/[0.07] p-4">
          <div className="flex items-center gap-1 text-xs font-medium text-foreground/65">
            {reduction ? '仓位保留因子' : '仓位的几何复利'}{isTheory ? '（理论）' : ''} · {reduction ? '1−αf' : '1+α'}
            <QuietInfo label="仓位的几何复利"><p>{reduction ? MIRROR_REDUCTION_FACTOR_HINT : theoretical ? LEG_THEORETICAL_FACTOR_HINT : LEG_GEOMETRIC_FACTOR_HINT}</p></QuietInfo>
          </div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-[#0B8F70] dark:text-[#0ECB81]" data-testid="leg-geometric-factor-detail-value">{formatLegGeometricFactor(factor)}</div>
          <div className="mt-2 text-xs text-muted-foreground">{reduction ? '减仓后剩余币数 ÷ 减仓前合计币数' : theoretical ? '按价格与覆盖预算推算 · 不是实际成交倍数' : '加仓后总币数 ÷ 加仓前实际持币数'}</div>
        </div>
        <div className="space-y-2 text-xs leading-relaxed">
          <div className="font-semibold">计算过程</div>
          {steps.map(([label, value]) => (
            <div key={label} className="grid grid-cols-1 gap-1 rounded bg-muted/35 px-3 py-2 sm:grid-cols-3 sm:gap-3">
              <span className="text-muted-foreground">{label}</span>
              <span className="min-w-0 break-words font-mono tabular-nums sm:col-span-2 sm:text-right">{value}</span>
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">按完整精度计算，上述代入值与结果仅为四舍五入显示。{reduction ? MIRROR_REDUCTION_FACTOR_HINT : theoretical ? LEG_THEORETICAL_FACTOR_HINT : 'Q前已扣除本次加仓前实际平掉的币数，不含反方向对冲仓位；本次倍数不是资金收益率，也不是允许加仓上限。'}</p>
      </DialogContent>
    </Dialog>
  );
}
