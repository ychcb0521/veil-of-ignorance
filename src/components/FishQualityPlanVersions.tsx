/**
 * 【用户要求】2026-11-02 版本保护：方案 / 模板保存时冻结的版本清单，逐项列出「哪一部分 · 是什么 · 版本 · 一句话逻辑」；
 * 与当前代码不同的项标红，说明从哪一版变成了哪一版。
 */
import type { QualityGroup } from '@/lib/fish/quality';
import { BOX_ALGORITHM_VERSIONS } from '@/lib/fish/boxAlgorithmVersions';
import { planVersionChanges, qualityPlanVersions } from '@/lib/fish/qualityPlanVersions';

export function PlanVersionList({ plan }: { plan: QualityGroup }) {
  const entries = plan.frozenVersions ?? qualityPlanVersions(plan), changes = planVersionChanges(plan), changed = new Set(changes.map(c => c.key));
  return <div className="space-y-1.5 text-[11px]" data-testid="plan-version-list">
    {changes.length > 0
      ? <p className="rounded bg-destructive/10 px-2 py-1 text-[10.5px] text-destructive">有 {changes.length} 项与当前代码的版本不同，不能按这份设置运行：{changes.map(c => `${c.part}「${c.name}」${c.from ?? '（无）'} → ${c.to ?? '（已不存在）'}`).join('；')}</p>
      : <p className="text-[10px] text-muted-foreground">{plan.frozenVersions ? '保存时冻结的版本，与当前代码一致' : '尚未冻结（按当前代码显示）'}</p>}
    <ul className="space-y-1">{entries.map(e => <li key={e.key} className={`rounded px-1.5 py-1 ${changed.has(e.key) ? 'bg-destructive/5' : ''}`} data-testid={`plan-version-${e.key}`}>
      <div className="flex items-baseline gap-2"><span className="w-28 shrink-0 text-muted-foreground">{e.part}</span><span className="min-w-0 flex-1 truncate" title={e.name}>{e.name}</span><span className={`shrink-0 font-mono text-[10px] ${changed.has(e.key) ? 'text-destructive' : 'text-primary'}`}>{e.version}</span></div>
      <p className="pl-[7.5rem] text-[10px] leading-snug text-muted-foreground">{e.summary}</p>
    </li>)}</ul>
  </div>;
}
/** 加仓设置「箱体算法」旁 ⓘ 里的版本说明：每个版本一条，逻辑逐条列出。 */
export function BoxAlgorithmVersionNotes() {
  return <div className="space-y-2.5 text-[11px]" data-testid="box-algorithm-versions">
    <p className="text-muted-foreground">保存方案或模板时会记下所用版本。改了算法逻辑一定开新版本号，旧版本保留不动；已存方案始终按原版本运行，版本对不上就停下提示。</p>
    {BOX_ALGORITHM_VERSIONS.map(v => <section key={v.id} className="space-y-0.5">
      <h6 className="font-medium">{v.label} <span className="font-mono text-[10px] text-muted-foreground">{v.id}</span> <span className="text-[10px] font-normal text-muted-foreground">· {v.since}</span></h6>
      <p className="text-muted-foreground">{v.summary}</p>
      <ul className="list-disc pl-4 text-[10.5px] text-muted-foreground">{v.rules.map(r => <li key={r}>{r}</li>)}</ul>
    </section>)}
  </div>;
}
