import { useEffect, useRef, useState } from 'react';
import type { TradeCampaign } from '@/types/journal';
import { qualityAdditionFills, qualityAdditionRoundLimit } from '@/lib/fish/qualityAddition';
import { HOLDING_LEDGER_ADDITION_VERSION } from '@/lib/fish/qualityHoldingLedger';
import type { ImpulseWindow } from '@/lib/fish/qualityAdditionStructure';
import { formatUTC8 } from '@/lib/timeFormat';

/** Historical market reconstruction is separate from the immutable execution log. */
export function ArchivedImpulseWindows({campaign}:{campaign:TradeCampaign}) {
  const comparison=campaign.comparison, instant=comparison?.instant, evidence=comparison?.sellEvidence;
  const rule=evidence?.addition, entry=Date.parse(campaign.opened_at), exit=evidence?.executedAt;
  const [windows,setWindows]=useState<ImpulseWindow[]>(), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const pending=useRef<AbortController>();
  useEffect(()=>()=>pending.current?.abort(),[]);
  if(!instant||!rule?.enabled||exit==null||!Number.isFinite(entry))return null;
  const firstEligible=rule.positionVersion===HOLDING_LEDGER_ADDITION_VERSION?entry:evidence.mirrorFill?.at;
  if(firstEligible==null)return null;
  const rounds=rule.rounds??[rule], alternatives=rule.alternativeRounds??[];
  if(![...rounds,...alternatives].some(r=>r.impulse1115Position))return null;
  const until=Math.min(exit,evidence.impulseTimingAuditFrom??exit);
  if(until<=firstEligible)return null;
  const fills=qualityAdditionFills(evidence);
  const observed=instant.timing?.observedAt;
  const canReconstruct=!instant.switches?.length&&!comparison.monitorPlan?.router&&!comparison.monitorPlan?.initialization&&!evidence.boxMarketRepair;
  async function read(){
    if(pending.current&&!pending.current.signal.aborted)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try{
      const {FishScanner}=await import('@/lib/fishScanner');
      const rows=await new FishScanner().readInstantImpulseWindows(instant!.source,entry,until,controller.signal);
      if(!controller.signal.aborted)setWindows(rows);
    }catch(cause){
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'行情读取失败');
    }finally{if(!controller.signal.aborted){pending.current=undefined;setBusy(false);}}
  }
  const rows=windows?.flatMap(w=>{
    const round=fills.filter(f=>f.at<w.at).length+1;
    if(round>qualityAdditionRoundLimit(rule))return [];
    const main=rule.rounds?rule.rounds[round-1]:rule;
    if(!main?.impulse1115Position&&!(round>=(rule.attackFromRound??1)&&alternatives[round-1]?.impulse1115Position))return [];
    const fill=fills.find(f=>f.at===w.at);
    let outcome=observed!=null&&observed>=w.freshUntil?'记录卖出时已过有效期':'旧记录缺少当次检查时间';
    if(rule.positionVersion!==HOLDING_LEDGER_ADDITION_VERSION&&(!evidence.mirrorFill||w.at<=evidence.mirrorFill.at))outcome='尚未经过镜像成交分钟';
    if(fill)outcome+=' · 同刻已成交：'+fill.label;
    return [<li key={w.at}>{formatUTC8(w.at)} · 第 {round} 次 · 线价 {w.price} · 截止 {formatUTC8(w.freshUntil)}（不含） · {outcome}</li>];
  });
  return <div className="space-y-1 text-muted-foreground">
    <p>旧版在检查急拉线有效期时跳过的机会没有逐条存档。</p>
    {canReconstruct&&windows===undefined&&<button type="button" className="text-primary" disabled={busy} onClick={()=>void read()}>{busy?'核对行情中…':'查看历史急拉线时点'}</button>}
    {error&&<p role="alert">{error}</p>}
    {windows&&<><p>按历史行情复核首次急拉。{observed!=null&&`卖出观察时间 ${formatUTC8(observed)}。`}逐次轮询时间未存档。</p>
      {rows?.length?<ul className="max-h-64 overflow-y-auto">{rows}</ul>:<p>该时段未找到已启用轮次的首次急拉。</p>}</>}
  </div>;
}
