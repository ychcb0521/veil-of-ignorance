import {newQualityStudy,importQualityLibrary,qualityRunSamples,qualityResultKey,qualityDisplayRows} from '../quality';
import {enableQualityComparison} from '../qualityComparison';
import {beginQualityMonitorRound,captureQualityMonitorResult,finishQualityMonitorRound} from '../qualityMonitorLibrary';
import {qualityEntryKey,qualityEntryParts} from '../qualityEntry';
export const ARCHIVE_T=Date.UTC(2026,9,30,6);
export function monitorArchiveFixture(){
 const T=ARCHIVE_T;let s=enableQualityComparison(importQualityLibrary(newQualityStudy(T),['AAAUSDT','BBBUSDT'].map((symbol,i)=>({id:symbol,symbol,timeMs:T+i*60000,timeLabel:'2026-10-30 14:00:00',fallbackZone:''}))));
 s.sellPlans=s.sellPlans!.slice(0,2);s.selectedRowIds=qualityDisplayRows(s).map(r=>r.id);
 const begun=beginQualityMonitorRound(s,s,T+1);s=begun.study;
 for(const row of qualityRunSamples(s))for(const plan of s.sellPlans!){const result={key:qualityResultKey(row,plan,s.observeHours),sampleId:row.id,groupId:plan.id,evaluatedAt:T+3600000,status:'closed' as const,complete:true,entryTime:row.enteredAt!,entryPrice:100,endTime:T+3600000,endPrice:110,returnPct:10,pnl:10,heldHours:1,adversePct:-4,peakPct:20};s=captureQualityMonitorResult({...s,results:[...s.results,result]},begun.capture,result,T+3600000);const part=qualityEntryParts(plan)[0],key=qualityEntryKey(row.source,result,plan,part)!;s.entryReadings=[...(s.entryReadings??[]),{key,evaluatedAt:T+3600000,entryTime:row.enteredAt!,mode:'closed',metric:part.metric,value:.8,at:row.enteredAt!}];}
 return finishQualityMonitorRound(s,begun.capture,'complete',T+3600001);
}
