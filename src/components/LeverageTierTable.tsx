import { maxPositionAtLeverage, tierIndexFor, formatTierAmount, type ResolvedSymbolTiers } from '@/lib/leverageTiers';

/**
 * 一个合约的币安杠杆分层表（下单面板「杠杆分层」浮层）。
 *
 * 每一档：持仓价值区间（floor, cap]、这一档允许的最高杠杆、维持保证金率、维持保证金速算额；
 * 单位与快照日期写在表头——合成币本位借的是 U 本位分层，按 USD 面值比，也写在这里。
 */
interface Props {
  resolved: ResolvedSymbolTiers;
  /** 当前杠杆：标出它能用到哪一档。 */
  leverage: number;
  /** 下单之后的敞口（档位单位）：标出它落在哪一档；算不出时不标。 */
  exposure: number | null;
}

const isQuoteUnit = (unit: string) => unit === 'USDT' || unit === 'USD';

function amountText(amount: number, unit: string): string {
  return amount.toLocaleString('en-US', { maximumFractionDigits: isQuoteUnit(unit) ? 2 : 8 });
}

function rateText(rate: number): string {
  return `${Number((rate * 100).toFixed(3))}%`;
}

export function LeverageTierTable({ resolved, leverage, exposure }: Props) {
  const { tiers, unit } = resolved;
  const cap = maxPositionAtLeverage(tiers, leverage);
  const lastAllowed = tiers.reduce((last, tier, i) => (tier.maxLeverage >= leverage ? i : last), -1);
  // 没有持仓、挂单和输入时不标——空仓不「落在」任何一档。
  const exposureIndex = exposure != null && Number.isFinite(exposure) && exposure > 0 ? tierIndexFor(tiers, exposure) : -1;
  const measureHint = resolved.measure === 'coin'
    ? `持仓价值 = 张数 × 面值 ÷ 标记价，以 ${unit} 计`
    : resolved.measure === 'usd-face'
      ? '持仓价值 = 张数 × 面值，以 USD 计'
      : '持仓价值 = 数量 × 标记价，以 USDT 计';

  return (
    <div className="space-y-2 text-[11px]" data-testid="leverage-tier-table">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">
          杠杆分层 · {resolved.binanceSymbol ?? resolved.appSymbol}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground" data-testid="leverage-tier-snapshot">
          快照 {resolved.snapshotDate}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        当前 {leverage}x 最高可持有头寸：
        <span className="font-mono text-foreground">{formatTierAmount(cap, unit)}</span>
        {exposure != null && Number.isFinite(exposure) && exposure > 0 && (
          <> · 持仓和当前委托（含本单）<span className="font-mono text-foreground">{formatTierAmount(exposure, unit)}</span></>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground" data-testid="leverage-tier-unit">
        金额单位：{unit}（持仓价值与速算额）
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono tabular-nums text-[10px]">
          <thead>
            <tr className="whitespace-nowrap text-left text-muted-foreground">
              <th className="py-1 pr-2 font-normal">档</th>
              <th className="py-1 pr-2 font-normal">持仓价值</th>
              <th className="py-1 pr-2 text-right font-normal">最高杠杆</th>
              <th className="py-1 pr-2 text-right font-normal">维持保证金率</th>
              <th className="py-1 text-right font-normal">速算额</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, i) => (
              <tr
                key={tier.bracket}
                data-testid="leverage-tier-row"
                data-exposure-tier={i === exposureIndex ? 'true' : undefined}
                className={`border-t border-border/60 ${
                  i === exposureIndex ? 'bg-primary/10 text-foreground' : i <= lastAllowed ? 'text-foreground/90' : 'text-muted-foreground/70'
                }`}
              >
                <td className="py-1 pr-2">{tier.bracket}</td>
                <td className="py-1 pr-2 whitespace-nowrap">{amountText(tier.floor, unit)}–{amountText(tier.cap, unit)}</td>
                <td className="py-1 pr-2 text-right">{tier.maxLeverage}x</td>
                <td className="py-1 pr-2 text-right">{rateText(tier.maintenanceMarginRate)}</td>
                <td className="py-1 text-right">{amountText(tier.maintenanceAmount, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
        <li>· {measureHint}；双向持仓多空相加，持仓和当前委托合计不得超过当前杠杆那一档的上限。</li>
        <li>· 维持保证金 = 持仓价值 × 维持保证金率 − 速算额，与所选杠杆无关。</li>
        {resolved.note && <li data-testid="leverage-tier-note" className="text-amber-500">· {resolved.note}</li>}
        <li>· 分层取自币安公开数据快照（{resolved.snapshotDate}），不是历史分层：回放更早的日期也按这份分层。</li>
      </ul>
    </div>
  );
}
