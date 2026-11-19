import {useState} from 'react';
import {useFeatureDefinitions} from '@/hooks/useFeatureDefinitions';
import {FishQualityHoldingVetoEditor} from './FishQualityHoldingVetoEditor';
import {defaultBoxBreak,defaultBoxSecondExit,BOX_BREAK_CHOICE,BOX_SECOND_EXIT_CHOICE} from '@/lib/fish/qualityBoxStop';
import {DBL5_RETEST_GUARD_VERSION} from '@/lib/dbl5m';
import {mirrorHardStopStage} from '@/lib/fish/qualityMirrorHardStopStages';
import {PAYOFF_STOP_KIND,ADDITION_PROFIT_KIND} from '@/lib/fish/qualityVeto';
import {PAYOFF_STOP_DEFAULT_R,type HoldingVetoDraft} from '@/lib/fish/qualityFilters';

export function FishQualityHardStopStagesEditor({draft,setDraft,readOnly=false}:{readOnly?:boolean;draft:HoldingVetoDraft[];setDraft:(draft:HoldingVetoDraft[])=>void}){
 const defs=useFeatureDefinitions(),[message,setMessage]=useState('');
 const phase=(d:HoldingVetoDraft)=>d.mirrorStage?.stage??(d.activation?'after':'legacy');
 const rows=(scope:'before'|'after'|'legacy')=>draft.filter(d=>phase(d)===scope);
 const scoped=(d:HoldingVetoDraft,scope:'before'|'after'):HoldingVetoDraft=>d.activation||d.mirrorStage?d:{...d,mirrorStage:mirrorHardStopStage(scope)};
 const update=(scope:'before'|'after'|'legacy',next:HoldingVetoDraft[])=>{
  if(readOnly)return;const normalized=next.map(d=>scope==='legacy'?d:scoped(d,scope)),values=normalized.filter(d=>phase(d)===scope),moved=normalized.filter(d=>phase(d)!==scope);let inserted=false;
  const result=draft.flatMap(d=>{if(phase(d)!==scope)return [d];if(inserted)return [];inserted=true;return values;});
  setDraft([...(inserted?result:[...result,...values]),...moved]);
 };
 const add=(scope:'before'|'after')=>{
  const boxStop=scope==='before'?defaultBoxBreak(defs,DBL5_RETEST_GUARD_VERSION):defaultBoxSecondExit(defs,DBL5_RETEST_GUARD_VERSION);
  update(scope,[...rows(scope),{choice:scope==='before'?BOX_BREAK_CHOICE:BOX_SECOND_EXIT_CHOICE,direction:'<=',threshold:'0',enabled:false,boxStop,mirrorStage:mirrorHardStopStage(scope)}]);
 };
 const moveLegacy=()=>{
  if(readOnly)return;
  let moved=0,kept=0;
  const next=draft.map(d=>{
   if(phase(d)!=='legacy'||!d.enabled&&!d.saved&&!d.boxStop&&(!d.threshold.trim()||d.choice===PAYOFF_STOP_KIND&&d.threshold.trim()===PAYOFF_STOP_DEFAULT_R))return d;
   if(d.boxStop?.version==='holding-support-second-break-v1'||d.choice===PAYOFF_STOP_KIND||d.choice===ADDITION_PROFIT_KIND){kept++;return d;}
   moved++;return {...d,mirrorStage:mirrorHardStopStage('before')};
  });
  setDraft(next);setMessage(`已将 ${moved} 条原全程条件放入镜像前阶段，保存后生效。${kept?`另有 ${kept} 条跨持仓加仓锁或加仓止盈继续保留在原全程区，可按需改设镜像后。`:''}`);
 };
 return <fieldset disabled={readOnly} className="space-y-3" data-testid="quality-hard-stop-mirror-stages">
  <p className="text-[11px] text-muted-foreground">以本次镜像平衡减仓实际成交为分界，前后阶段分别保存条件。减仓后前段退出条件停止生效，后段重新开始观察；未成交时一直使用前段。原全程条件保留在下方，不会自动迁移。</p>
  <p className="text-[10.5px] text-muted-foreground">这里只改变条件的生效时段：公式预热、买入价和持仓峰值等计算基准沿用原定义；后段不追补启动前已经结束的触价或断裂。其他卖出、加仓卖出和原全程保护仍独立生效。</p>
  {(['before','after'] as const).map(scope=><section key={scope} className="space-y-2 rounded border border-border/60 p-3" data-testid={'quality-hard-stop-'+scope}>
   <h5 className="text-xs font-medium">{scope==='before'?'第一阶段 · 镜像平衡减仓策略之前':'第二阶段 · 镜像平衡减仓策略之后'} <span className="text-muted-foreground">（{rows(scope).filter(d=>d.enabled).length} 条启用）</span></h5>
   <p className="text-[10.5px] text-muted-foreground">{scope==='before'?'从持仓开始保护，可设置防守线第一次断裂即退出；镜像实际减仓后，本区不再触发退出。':'从镜像实际减仓后独立开始，可设置防守线第一次断裂只观察、第二次断裂退出。启动前的断裂和已结束的触价不追补。'}</p>
   <button type="button" onClick={()=>add(scope)} className="rounded border border-primary/30 px-2 py-1 text-[11px] text-primary">{scope==='before'?'添加防守线断裂即退出（镜像前）':'添加防守线首次观察、二次退出（镜像后）'}</button>
   <FishQualityHoldingVetoEditor compact mirrorPhase={scope} labelPrefix={scope==='before'?'镜像前 ':'镜像后 '} draft={rows(scope)} setDraft={next=>update(scope,next)}/>
  </section>)}
  {!!rows('legacy').length&&<details className="rounded border border-border/60 p-3" open={rows('legacy').some(d=>d.enabled)} data-testid="quality-hard-stop-legacy">
   <summary className="cursor-pointer text-xs font-medium">原有全程条件 · 保留原口径（{rows('legacy').filter(d=>d.enabled).length} 条启用）</summary>
   <p className="my-2 text-[10.5px] text-muted-foreground">这里的原条件在镜像前后都能独立触发；若需要前段保护在减仓后停止，请在当前工作副本中移入前段，再保存。已存模板不自动改写。</p>
   <button type="button" onClick={moveLegacy} className="mb-2 rounded border border-border px-2 py-1 text-[11px]">将原有全程条件移入镜像前阶段</button>
   <FishQualityHoldingVetoEditor draft={rows('legacy')} setDraft={next=>update('legacy',next)}/>
  </details>}
  {message&&<p role="status" className="text-[11px] text-primary">{message}</p>}
 </fieldset>;
}
