import type { TradeCampaign } from '@/types/journal';
import { chartFeatureDef } from '@/lib/featureSource';
import { definitionKey } from '@/lib/deepDig/features';
import { formatUTC8 } from '@/lib/timeFormat';

export function QualitySellEvidence({ evidence }: { evidence: NonNullable<TradeCampaign['comparison']>['sellEvidence'] }) {
  if (!evidence) return null;
  const current = chartFeatureDef(evidence.featureId);
  const differs = !!current && definitionKey({ ...current, interval: evidence.interval as '5m' }) !== evidence.definitionKey;
  return <section className="rounded border border-border bg-card px-3 py-2 text-[11px] space-y-1.5" data-testid="quality-sell-evidence">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <b className="font-medium">卖出依据</b>
      <span>{evidence.source === 'account' ? '运行时账号公式' : '历史公式快照'} · {evidence.version}</span>
      <span>{evidence.interval} 收盘 · hl {evidence.halfLifeHours}h · avgh {evidence.avgHours}h</span>
      <span className="font-mono">{evidence.metric} {evidence.direction} {evidence.threshold}</span>
      {evidence.reading != null && <span className="font-mono">触发读数 {evidence.reading.toPrecision(9)}</span>}
      {evidence.confirmedAt != null && <span>确认 / 成交时刻 {formatUTC8(evidence.confirmedAt)}</span>}
    </div>
    <p className="text-muted-foreground">首次满足条件的已收盘指标触发，按紧接该收盘时刻的 1 分钟 K 线开盘价卖出；不使用未收盘读数。</p>
    {differs && <p role="status" className="text-amber-700 dark:text-amber-400">本战役公式与当前账号公式不同。下方通用指标图使用当前账号设置，不能用其读数核对这份历史结果；请回鱼质量重新运行，生成当前公式的比较结果。</p>}
    <details><summary className="cursor-pointer text-muted-foreground">查看本次实际卖出公式</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">{evidence.formula}</pre></details>
  </section>;
}
