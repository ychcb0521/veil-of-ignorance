import { Layers3 } from 'lucide-react';
import { formatCounterfactualStamp } from '@/lib/counterfactualChangeSummary';
import { formatDeltaB, legDeltaB } from '@/lib/campaignLegPhases';
import { computeLegPriceChangePct, formatLegPriceChangePct } from '@/lib/legPriceChange';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type { CampaignCounterfactualManualLeg, CampaignCounterfactualResult, LegRole } from '@/types/journal';

interface Props {
  legs: CampaignCounterfactualManualLeg[];
  result: CampaignCounterfactualResult;
  title?: string;
}

const moneyTone = (value: number) => value > 0
  ? 'text-[#0ECB81]'
  : value < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';

const fmt = (value: number, digits = 2) => Number.isFinite(value)
  ? value.toLocaleString('en-US', { maximumFractionDigits: digits })
  : '—';

export function CounterfactualLegsTable({ legs, result, title = '反事实 Legs' }: Props) {
  const initialLoss = result.initial_expected_max_loss ?? null;
  const totalAbsPnl = result.legs_summary.reduce((sum, leg) => sum + Math.abs(leg.realized_pnl_usdt), 0);

  return (
    <section data-testid="counterfactual-result-legs" className="mt-3 rounded border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Layers3 className="h-4 w-4 text-muted-foreground" />
          {title}
        </div>
        <div className="text-[11px] text-muted-foreground">{legs.length} 条</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-[11px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">角色</th>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-right">贡献 / 盈亏</th>
              <th className="px-3 py-2 text-right">Δb</th>
              <th className="px-3 py-2 text-right">开仓价</th>
              <th className="px-3 py-2 text-right">平仓价</th>
              <th className="px-3 py-2 text-right">涨跌幅</th>
              <th className="px-3 py-2 text-right">币量 / 仓位</th>
              <th className="px-3 py-2 text-right">手续费</th>
              <th className="px-3 py-2 text-right">状态</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg, index) => {
              const summary = result.legs_summary[index]
                ?? result.legs_summary.find(item => item.leg_role === leg.leg_role);
              const pnl = summary?.realized_pnl_usdt ?? 0;
              const contribution = totalAbsPnl > 0 ? pnl / totalAbsPnl : null;
              const delta = legDeltaB(pnl, initialLoss);
              const change = computeLegPriceChangePct(
                leg.entry_price,
                leg.exit_price,
                leg.direction === 'short' ? 'short' : 'long',
              );
              const coinQuantity = leg.entry_price > 0 ? leg.size_usdt / leg.entry_price : null;
              const fees = (summary?.open_fee_usdt ?? 0) + (summary?.close_fee_usdt ?? 0);
              const pending = leg.filled === false || summary?.status === 'never_triggered';
              return (
                <tr key={leg.id} className="border-t border-border/60">
                  <td className="px-3 py-2.5">
                    <span className={`rounded px-2 py-0.5 ${leg.direction === 'long' ? 'bg-[#0ECB81]/10 text-[#0AA66A]' : 'bg-blue-500/10 text-blue-500/80'}`}>
                      {LEG_ROLE_LABELS[leg.leg_role as LegRole] ?? leg.leg_role}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono leading-5 text-foreground">
                    <div><span className="text-muted-foreground">开</span> {formatCounterfactualStamp(leg.open_time)}</div>
                    <div><span className="text-muted-foreground">平</span> {formatCounterfactualStamp(leg.close_time)}</div>
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono ${moneyTone(pnl)}`}>
                    <div>{contribution == null ? '—' : `${contribution > 0 ? '+' : ''}${(contribution * 100).toFixed(1)}%`}</div>
                    <div className="text-[10px] opacity-75">{pnl > 0 ? '+' : ''}{fmt(pnl)}</div>
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono ${moneyTone(delta ?? 0)}`}>{formatDeltaB(delta)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(leg.entry_price, 8)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(leg.exit_price, 8)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${moneyTone(change ?? 0)}`}>{formatLegPriceChangePct(change)}</td>
                  <td className="px-3 py-2.5 text-right font-mono leading-5">
                    <div>{coinQuantity == null ? '—' : fmt(coinQuantity, 8)}</div>
                    <div className="text-[10px] text-muted-foreground">{fmt(leg.size_usdt)} USD</div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(fees)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${pending ? 'bg-[#F0B90B]/10 text-[#B8860B]' : 'bg-muted text-muted-foreground'}`}>
                      {pending ? '挂单中' : '已成交'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {legs.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">该反事实分支没有 Legs 数据</td></tr>
            )}
          </tbody>
          {legs.length > 0 && (
            <tfoot className="border-t-2 border-border bg-muted/20 font-mono">
              <tr>
                <td className="px-3 py-2 font-sans font-medium">合计</td>
                <td />
                <td className={`px-3 py-2 text-right ${moneyTone(result.final_realized_pnl)}`}>
                  {result.final_realized_pnl > 0 ? '+' : ''}{fmt(result.final_realized_pnl)}
                </td>
                <td className={`px-3 py-2 text-right ${moneyTone(result.final_r_multiple)}`}>
                  {result.final_r_multiple > 0 ? '+' : ''}{result.final_r_multiple.toFixed(2)}
                </td>
                <td colSpan={4} />
                <td className="px-3 py-2 text-right text-muted-foreground">{fmt((result.open_fees_total ?? 0) + (result.fees_total ?? 0))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
