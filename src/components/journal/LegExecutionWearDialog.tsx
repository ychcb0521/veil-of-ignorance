/**
 * Legs「磨损」点开后的计算过程【用户要求】2026-10-15：「点开 legs 中磨损的那个数值之后，可以显示计算过程，
 * 具体的你可以参考它旁边的『加仓校验』」。与加仓校验同一套框：顶部是核心读数（与盈亏比同一单位 R），
 * 下面逐项写公式与代入的每一个数，最后 ÷ L₀。
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  EXECUTION_WEAR_COMPONENT_LABEL,
  EXECUTION_WEAR_COMPONENT_RULES,
  executionWearInR,
  formatExecutionWearR,
  formatExecutionWearUsd,
  type ExecutionWearComponent,
  type LegExecutionWear,
} from '@/lib/campaignExecutionWear';
import { formatAddSizingCoinQuantity } from '@/lib/campaignAddSizingCheck';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type { LegRole, TradeJournal } from '@/types/journal';

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(6);
}

const toneOf = (value: number | null) => {
  const rounded = value == null ? 0 : Number(value.toFixed(2));
  if (rounded < 0) return { text: 'text-[#F6465D]', border: 'border-[#F6465D]/30', bg: 'bg-[#F6465D]/[0.07]' };
  if (rounded > 0) return { text: 'text-[#0ECB81]', border: 'border-[#0ECB81]/30', bg: 'bg-[#0ECB81]/[0.07]' };
  return { text: 'text-foreground/80', border: 'border-border', bg: 'bg-muted/40' };
};

export function LegExecutionWearDialog({
  leg,
  wear,
  initialExpectedMaxLoss,
  onClose,
}: {
  leg: TradeJournal;
  wear: LegExecutionWear;
  initialExpectedMaxLoss: number | null;
  onClose: () => void;
}) {
  const L0 = initialExpectedMaxLoss != null && initialExpectedMaxLoss > 0 ? initialExpectedMaxLoss : null;
  const totalR = executionWearInR(wear.total, L0);
  const tone = toneOf(totalR ?? wear.total);
  const roleLabel = leg.leg_role ? LEG_ROLE_LABELS[leg.leg_role as LegRole] ?? leg.leg_role : '这条腿';
  const detail = wear.detail;
  const toR = (usd: number | null) => (usd == null || L0 == null ? '—' : formatExecutionWearR(usd / L0));
  /** 一项：公式、代入、金额 → ÷ L₀ → R。 */
  const Step = ({ part, formula, worked }: { part: ExecutionWearComponent; formula: string; worked: string }) => {
    const usd = wear[part];
    return (
      <div className="space-y-1 border-t border-border/60 pt-3 first:border-t-0 first:pt-0" data-testid={`leg-wear-step-${part}`}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-xs font-medium text-foreground">{EXECUTION_WEAR_COMPONENT_LABEL[part]}</div>
          <div className={`font-mono text-sm tabular-nums ${toneOf(usd).text}`}>{toR(usd)}</div>
        </div>
        <div className="font-mono text-[11px] text-foreground/70">{formula}</div>
        <div className="rounded border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-foreground/85 break-words">
          {worked}
          {usd != null && <><br />= {formatExecutionWearUsd(usd)} U{L0 != null && <> ÷ L₀ {L0.toFixed(2)} U = {toR(usd)}</>}</>}
        </div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">{EXECUTION_WEAR_COMPONENT_RULES[part]}</div>
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[94vh] overflow-y-auto gap-3 sm:max-w-[680px]" data-testid="leg-wear-detail-dialog">
        <DialogHeader>
          <DialogTitle>{roleLabel} · L_磨损计算</DialogTitle>
          <DialogDescription className="sr-only">这条腿贡献的 L_磨损与完整计算过程。</DialogDescription>
        </DialogHeader>

        <div className={`rounded-lg border ${tone.border} ${tone.bg} p-4`}>
          <div className={`text-xs font-medium ${tone.text}`}>
            {detail?.kind === 'midHedge' ? '第一部分 · 中途对冲' : detail?.kind === 'finalHedge' ? '第二部分 · 最终对冲磨损' : 'L_磨损'}
          </div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone.text}`} data-testid="leg-wear-detail-r">
            {formatExecutionWearR(totalR)}
          </div>
          <div className="mt-1 text-sm tabular-nums text-foreground/70" data-testid="leg-wear-detail-usd">
            = {formatExecutionWearUsd(wear.total)} U ÷ L₀ {L0 == null ? '—' : `${L0.toFixed(2)} U`}（与盈亏比同一单位）
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          {detail?.kind === 'midHedge' && (
            <Step part="hedge" formula="中途对冲 = 本腿已实现盈亏" worked={`本腿已实现盈亏 = ${formatExecutionWearUsd(detail.pnl)} U`} />
          )}
          {detail?.kind === 'finalHedge' && (
            <>
              {wear.exit != null && (
                <Step
                  part="exit"
                  formula={`多空平仓价差 = 对冲币数 ×（多单最终平仓价 − 空单平仓价）${detail.entry != null && Math.abs(detail.entry - detail.finalExitPrice) > 1e-12 ? ' + 对冲币数 ×（开仓价 − F）' : ''}`}
                  worked={`${formatAddSizingCoinQuantity(detail.coins)} ×（${fmtPrice(detail.longExit)} − ${fmtPrice(detail.shortExit)}）`
                    + (detail.entry != null && Math.abs(detail.entry - detail.finalExitPrice) > 1e-12
                      ? ` + ${formatAddSizingCoinQuantity(detail.coins)} ×（${fmtPrice(detail.entry)} − ${fmtPrice(detail.finalExitPrice)}）` : '')}
                />
              )}
              {wear.slippage != null && (
                <Step
                  part="slippage"
                  formula="对冲委托/成交差 = 对冲币数 ×（开仓价 − 委托价）"
                  worked={`${formatAddSizingCoinQuantity(detail.coins)} ×（${fmtPrice(detail.fillPrice)} − ${fmtPrice(detail.orderPrice)}）`}
                />
              )}
              {wear.sizing != null && detail.sizingOwner && (
                <Step
                  part="sizing"
                  formula="对冲数量差 =（理论对冲币数 − 实际对冲币数）×（多单最终平仓价 − F）"
                  worked={`（${formatAddSizingCoinQuantity(detail.longCoins)} − ${formatAddSizingCoinQuantity(detail.hedgeCoinsTotal)}）×（${fmtPrice(detail.longExit)} − ${fmtPrice(detail.finalExitPrice)}）`}
                />
              )}
              <div className="border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground" data-testid="leg-wear-detail-basis">
                F = {fmtPrice(detail.finalExitPrice)}（最早那张最终对冲空单的开仓价，与相对涨幅同一个 F）；
                多单最终平仓价 = {fmtPrice(detail.longExit)}（锁仓之后平掉的多单 {formatAddSizingCoinQuantity(detail.longCoins)} 币，按币数加权）；
                理论对冲币数 = 锁仓时手里的多单币数 {formatAddSizingCoinQuantity(detail.longCoins)}，实际对冲币数 = 全部最终对冲单 {formatAddSizingCoinQuantity(detail.hedgeCoinsTotal)} 币。
                {!detail.sizingOwner && ' 对冲数量差只记在最早那张最终对冲单那一行。'}
                {wear.slippage == null && ' 读不到这张对冲单的委托价，委托/成交差不计。'}
              </div>
            </>
          )}
          {!detail && <div className="text-xs text-muted-foreground">这条腿的 L_磨损读不到计算依据。</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
