import {useState} from 'react';
import {FishBoxStopInfo} from './FishBoxStopInfo';
import {FishQualityHoldingVetoEditor} from './FishQualityHoldingVetoEditor';
import {mirrorHardStopStage} from '@/lib/fish/qualityMirrorHardStopStages';
import {PAYOFF_STOP_KIND,ADDITION_PROFIT_KIND} from '@/lib/fish/qualityVeto';
import {PAYOFF_STOP_DEFAULT_R,type HoldingVetoDraft} from '@/lib/fish/qualityFilters';

export function FishQualityHardStopStagesEditor({draft,setDraft,readOnly=false}:{readOnly?:boolean;draft:HoldingVetoDraft[];setDraft:(draft:HoldingVetoDraft[])=>void}){
 const [message,setMessage]=useState('');
 const phase=(d:HoldingVetoDraft)=>d.mirrorStage?.stage??(d.activation?'after':'legacy');
 const rows=(scope:'before'|'after'|'legacy')=>draft.filter(d=>phase(d)===scope);
 const scoped=(d:HoldingVetoDraft,scope:'before'|'after'):HoldingVetoDraft=>d.activation||d.mirrorStage?d:{...d,mirrorStage:mirrorHardStopStage(scope)};
 const update=(scope:'before'|'after'|'legacy',next:HoldingVetoDraft[])=>{
  if(readOnly)return;const normalized=next.map(d=>scope==='legacy'?d:scoped(d,scope)),values=normalized.filter(d=>phase(d)===scope),moved=normalized.filter(d=>phase(d)!==scope);let inserted=false;
  const result=draft.flatMap(d=>{if(phase(d)!==scope)return [d];if(inserted)return [];inserted=true;return values;});
  setDraft([...(inserted?result:[...result,...values]),...moved]);
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
  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
   以镜像减仓成交为界
   <FishBoxStopInfo label="阶段生效说明">
    <p>减仓成交后，镜像前条件结束，镜像后条件开始观察。全程条件在两个阶段都有效。</p>
    <p>指标预热、买入价和持仓峰值沿用各自的计算规则。镜像后条件只检查启动后的触价和断裂。</p>
   </FishBoxStopInfo>
  </div>
  {(['before','after'] as const).map(scope=>{
   const conditions=rows(scope);
   return <section key={scope} className="space-y-2 border-t border-border/60 pt-2" data-testid={'quality-hard-stop-'+scope}>
    <div className="flex flex-wrap items-center gap-2">
     <h5 className="text-xs font-medium">{scope==='before'?'镜像减仓前':'镜像减仓后'}</h5>
     <span className="text-[11px] text-muted-foreground" data-testid={scope==='before'&&!conditions.length?'quality-hard-stop-before-skipped':undefined}>
      {conditions.length?`已启用 ${conditions.filter(d=>d.enabled).length} / ${conditions.length}`:'未设置'}
     </span>
     {scope==='before'&&conditions.length>0&&!readOnly&&<button type="button" aria-label="跳过本阶段，不填写" onClick={()=>update('before',[])} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">清空前段条件</button>}
    </div>
    <FishQualityHoldingVetoEditor compact hardStopPanel readOnly={readOnly} mirrorPhase={scope} labelPrefix={scope==='before'?'镜像前 ':'镜像后 '} draft={conditions} setDraft={next=>update(scope,next)}/>
   </section>;
  })}
  {!!rows('legacy').length&&<details className="border-t border-border/60 pt-2" open={rows('legacy').some(d=>d.enabled)} data-testid="quality-hard-stop-legacy">
   <summary className="cursor-pointer text-xs font-medium">全程条件 <span className="ml-1 text-[11px] font-normal text-muted-foreground">已启用 {rows('legacy').filter(d=>d.enabled).length} / {rows('legacy').length}</span></summary>
   <FishQualityHoldingVetoEditor hardStopPanel readOnly={readOnly} draft={rows('legacy')} setDraft={next=>update('legacy',next)}/>
   {!readOnly&&<button type="button" aria-label="将原有全程条件移入镜像前阶段" onClick={moveLegacy} className="mt-2 text-[11px] text-muted-foreground hover:text-foreground">移入镜像减仓前</button>}
  </details>}
  {message&&<p role="status" className="text-[11px] text-primary">{message}</p>}
 </fieldset>;
}
