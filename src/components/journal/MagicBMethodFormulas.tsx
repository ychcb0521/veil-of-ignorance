import type { ReactNode } from 'react';
import { EFFECTIVE_PRICE_CHANGE_FORMULA, EFFECTIVE_PRICE_CHANGE_RULE, MAGIC_B_FORMULA, MAGIC_B_SETTLEMENT_FORMULA, MAGIC_B_THEORETICAL_FORMULA } from '@/lib/campaignGeometricMetrics';

/** Three methods stay visible together; the numerical indicator still uses actual geometry. */
export function MagicBMethodFormulas({ realizedPnl, initialRisk, geometricWorked, theoreticalWorked }: {
  realizedPnl?: number | null;
  initialRisk?: number | null;
  geometricWorked?: ReactNode;
  theoreticalWorked?: ReactNode;
}) {
  const showSettlement = realizedPnl !== undefined || initialRisk !== undefined;
  const settlementB = realizedPnl != null && initialRisk != null
    && Number.isFinite(realizedPnl) && Number.isFinite(initialRisk) && initialRisk > 0
    ? realizedPnl / initialRisk : null;
  const number = (value: number) => Number(value.toPrecision(12)).toString();
  return <div className="space-y-2">
    <div className="space-y-1.5 rounded border border-border/60 bg-muted/40 p-2.5">
      <div className="text-[10px] font-medium text-foreground/85">算法一 · 原盈亏比</div>
      <p className="font-mono break-words">{MAGIC_B_SETTLEMENT_FORMULA}</p>
      {showSettlement && <div data-testid="magic-b-direct-worked" className="font-mono tabular-nums break-words">
        {settlementB != null && Number.isFinite(settlementB)
          ? <>本场：{number(realizedPnl!)} U ÷ {number(initialRisk!)} U ≈ <span className="font-semibold">{settlementB.toFixed(8)}</span></>
          : '本场：—（缺少有效已实现净盈亏或初始风险金额）'}
      </div>}
      <p className="text-[10px]">L₀ 为交易开始时的最大预期亏损金额；盈利保留正号，亏损保留负号。</p>
    </div>
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
    <p className="text-[10px]">盈亏比及相关统计使用算法一；神奇的 b 使用算法二；方法三仅作理论对照。按完整精度计算，展示值四舍五入。</p>
  </div>;
}
