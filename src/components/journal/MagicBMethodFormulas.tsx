import type { ReactNode } from 'react';
import { EFFECTIVE_PRICE_CHANGE_FORMULA, EFFECTIVE_PRICE_CHANGE_RULE, MAGIC_B_FORMULA, MAGIC_B_THEORETICAL_FORMULA } from '@/lib/campaignGeometricMetrics';

/** 【用户要求】神奇的 b 的说明只留几何公式与理论对照，不再列原盈亏比（它在「盈亏比」一项里）。 */
export function MagicBMethodFormulas({ geometricWorked, theoreticalWorked }: {
  geometricWorked?: ReactNode;
  theoreticalWorked?: ReactNode;
}) {
  return <div className="space-y-2">
    <div className="space-y-1.5 rounded border border-border/60 bg-muted/40 p-2.5">
      <div className="text-[10px] font-medium text-foreground/85">算法二 · 几何公式<span className="ml-2 text-muted-foreground">当前指标</span></div>
      <p className="font-mono break-words">{MAGIC_B_FORMULA}</p>
      <p className="font-mono break-words">{EFFECTIVE_PRICE_CHANGE_FORMULA}</p>
      <p className="text-[10px]">{EFFECTIVE_PRICE_CHANGE_RULE}</p>
      {geometricWorked}
    </div>
    <div className="space-y-1.5 rounded border border-border/60 bg-muted/40 p-2.5">
      <div className="text-[10px] font-medium text-foreground/85">方法三 · 神奇的 b（理论）<span className="ml-2 text-muted-foreground">理论对照</span></div>
      <p className="font-mono break-words">{MAGIC_B_THEORETICAL_FORMULA}</p>
      {theoreticalWorked}
      <p className="text-[10px]">使用理论可加仓比例累积的仓位倍数；相对涨幅按公式比值计算，例如 2.00× 参与计算为 2。与方法二共用同一相对涨幅，不替换当前指标。</p>
    </div>
    <p className="text-[10px]">神奇的 b 使用算法二；方法三仅作理论对照。按完整精度计算，展示值四舍五入。</p>
  </div>;
}
