import {expect,it} from 'vitest';
import {recordEntryEvidence,recordEntryStop,entryProcessText,type EntryExclusionProcess} from '../preEntryExclusionProcess';
import {decideThreeStageV6} from '../preEntryThreeStageScan';
const T=Date.UTC(2026,10,8),M=60000;
it('merges consecutive observations of one veto, retains changing readings and closes it only when it clears',()=>{
 let p:EntryExclusionProcess={version:1,startedAt:T,entries:[]};
 const blocked=(at:number,value:number)=>({...decideThreeStageV6(at,{status:'pass'},{status:'blocked',reason:`动态回撤：${value}% ≥ 20%`},{}),readings:[{id:'r',label:'读数',at,value,met:false}]});
 p=recordEntryEvidence(p,blocked(T+M,21));const before=structuredClone(p);
 p=recordEntryEvidence(p,blocked(T+2*M,22));
 expect(before.entries.find(e=>e.stage==='exclusion')?.count).toBe(1);
 expect(p.entries.find(e=>e.stage==='exclusion')).toMatchObject({from:T+M,through:T+2*M,count:2,reason:'动态回撤：21% ≥ 20%',lastReason:'动态回撤：22% ≥ 20%',readings:[{value:21}],lastReadings:[{value:22}]});
 p=recordEntryEvidence(p,decideThreeStageV6(T+3*M,{status:'pass'},{status:'pass'},{}));
 expect(p.entries.find(e=>e.stage==='exclusion')).toMatchObject({endedAt:T+3*M,nextStatus:'pass'});
 expect(entryProcessText(p)).toContain('解除');
});
it('logs a changed cause as a switch rather than declaring that exclusion is clear',()=>{
 let p:EntryExclusionProcess={version:1,startedAt:T,entries:[]};
 for(const [i,reason]of ['条件甲未满足','条件乙未满足'].entries())p=recordEntryEvidence(p,decideThreeStageV6(T+(i+1)*M,{status:'blocked',reason},{status:'pass'},{}));
 const first=p.entries.find(e=>e.stage==='necessary')!;
 expect(first).toMatchObject({endedAt:T+2*M,nextStatus:'blocked'});expect(entryProcessText(p)).toContain('原因切换');
 p=recordEntryStop(p,'unmatched',T+48*3600000,'达到本轮时限，未满足');
 expect(p.entries.at(-1)).toMatchObject({kind:'unmatched',from:T+48*3600000});
 expect(recordEntryStop(p,'unmatched',T+48*3600000,'达到本轮时限，未满足')).toBe(p);
});
