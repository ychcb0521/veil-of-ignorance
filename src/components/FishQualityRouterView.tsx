import { useState } from 'react';
import type { QualityGroup } from '@/lib/fish/quality';
import { qualityPlanTemplateSummary } from '@/lib/fish/qualityPlanTemplates';
import { FishQualityMonitorSettingsView } from './FishQualityMonitorSettingsView';
export function FishQualityRouterView({plan}:{plan:QualityGroup}) {
 const [branch,setBranch]=useState<'structure'|'attack'>('structure');
 if(!plan.router)return null;
 const r=plan.router;
 return <section className="space-y-3 rounded border border-primary/25 bg-primary/5 p-3 text-[11px]" data-testid="quality-router-view">
  <p className="font-medium">条件分支 · 结构为底，强势进攻</p>
  <p>前两次按结构分支加仓。第二次成交时，读取此前已收盘的 5 分钟状态 S：大于 {r.threshold}，从第三次起使用进攻分支；否则本场保持结构分支。只选择一次。</p>
  <p className="text-muted-foreground">整套参数与版本已冻结，可复制、改名或删除；分支内容在此只读查看，避免普通表单覆盖条件分支。保存模板不会启动运行。</p>
  <div role="tablist" aria-label="查看条件分支" className="flex gap-2">{(['structure','attack'] as const).map(b=><button type="button" role="tab" aria-selected={b===branch} key={b} onClick={()=>setBranch(b)} className={`rounded px-2 py-1 ${branch===b?'bg-primary text-primary-foreground':'bg-muted'}`}>{b==='structure'?'结构分支':'进攻分支'}</button>)}</div>
  <p>{qualityPlanTemplateSummary(r[branch])}</p>
  <FishQualityMonitorSettingsView key={branch} plan={r[branch]}/>
 </section>;
}
