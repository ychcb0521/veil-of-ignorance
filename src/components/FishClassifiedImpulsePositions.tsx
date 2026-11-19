import {CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION,classifiedImpulsePositionLabel,type ClassifiedImpulsePosition} from '@/lib/fish/qualityClassifiedImpulsePosition';
import {Impulse1115ClassificationSettings} from './journal/deepDig/Impulse1115ClassificationSettings';

export type ClassifiedImpulsePositionDraft=Omit<ClassifiedImpulsePosition,'bufferAtr'|'minDistancePct'>&{bufferAtr:string;minDistancePct:string};
export function FishClassifiedImpulsePositions({positions,disabled,change}:{positions:ClassifiedImpulsePositionDraft[];disabled:boolean;change:(positions:ClassifiedImpulsePositionDraft[])=>void}){
 return <div className="space-y-2" data-testid="addition-classified-impulse-settings">{positions.map(p=>{
  const label=classifiedImpulsePositionLabel(p.mainClass),patch=(value:Partial<ClassifiedImpulsePositionDraft>)=>change(positions.map(x=>x.mainClass===p.mainClass?{...x,...value}:x));
  const fromLine=p.version===CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION,baseLabel=fromLine?`急拉线（${p.mainClass===1?'一类':'二类'}）`:'起涨低点';
  const input='h-7 min-w-0 shrink-0 rounded bg-muted/50 px-2 font-mono text-xs';
  return <fieldset key={p.mainClass} disabled={disabled} className="min-w-0 rounded border border-border/60 p-2 text-[11px]">
   <legend className="px-1 font-medium">{label}</legend>
   <p className="mb-2 text-muted-foreground">{p.mainClass===1?'延续未回踩／回踩守住并转强':'反弹减弱／刺穿收回／反抽失败／修复确认'}</p>
   <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
    <span>K＝{baseLabel} − N × ATR</span>
    <label className="flex flex-wrap items-center gap-1">N（手动设置）<input aria-label={label+' N（ATR 倍数）'} className={input} style={{width:`calc(${Math.max(4,p.bufferAtr.length)}ch + 4.5rem)`}} type="number" min="0" max="20" step="any" value={p.bufferAtr} onChange={e=>patch({bufferAtr:e.target.value})}/></label>
    <label className="flex flex-wrap items-center gap-1">K 最小距离<input aria-label={label+' K 最小距离'} className={input} style={{width:`calc(${Math.max(4,p.minDistancePct.length)}ch + 4.5rem)`}} type="number" min="0" max="50" step="any" placeholder="不限" value={p.minDistancePct} onChange={e=>patch({minDistancePct:e.target.value})}/>%</label>
   </div>
   {!fromLine&&<p className="mt-2 text-muted-foreground">原保存方案沿用起涨低点基准。<button type="button" className="ml-2 text-primary underline" onClick={()=>patch({version:CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION})}>改用急拉线公式</button></p>}
   <details className="mt-2"><summary className="cursor-pointer text-primary">分类判定参数</summary>
    <p className="my-2 text-muted-foreground">只认最新急拉线的已确认新状态；过渡和持续同状态不重复触发。K＝{baseLabel}−N×该线冻结 ATR，N 可手动设置，仍须通过方向、否决、定量和退出规则。</p>
    <Impulse1115ClassificationSettings value={p.definition.DBL5C_parameters} onChange={DBL5C_parameters=>patch({definition:{...p.definition,DBL5C_parameters}})}/>
    <p className="mt-1 break-all font-mono text-muted-foreground">{p.version}</p>
   </details>
  </fieldset>;
 })}</div>;
}
