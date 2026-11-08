import {definitionKey} from '@/lib/deepDig/features';
import {importQualityLibrary,newQualityStudy,qualityDisplayRows,type QualityGroup} from '../quality';
import {freezeQualityPlan} from '../qualityPlanVersions';
import type {PreEntryLibrary} from '../preEntryMonitor';

export const SIGNAL_AT=Date.parse('2026-04-12T00:26:00+08:00');
export const MATCHED_AT=Date.parse('2026-04-13T19:40:00+08:00');
export function firstMatchFixture(){
 const definition={id:'first-match-test',name:'测试',short:'T',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'5m' as const,halfLifeHours:3,avgHours:12};
 const plan:QualityGroup=freezeQualityPlan({id:'hold',label:'持仓方案',metric:'raw',snapshot:{featureId:definition.id,definitionKey:definitionKey(definition),statistic:'raw',interval:'5m',scale:1,threshold:1,average:1,cbi2:1,startAverage:1,previousAverage:1,cutoffMs:SIGNAL_AT},rule:{metric:'raw',direction:'<',threshold:-1}});
 const study=importQualityLibrary(newQualityStudy(SIGNAL_AT),[{id:'uai-signal',symbol:'UAIUSDT',timeMs:SIGNAL_AT,timeLabel:'',fallbackZone:'',exchange:'binance'}]);
 study.sellPlans=[plan];study.sellPlansConfigured=true;study.independentFilters=true;
 study.selectedRowIds=qualityDisplayRows(study).map(r=>r.id);
 const library:PreEntryLibrary={version:1,rounds:[{id:'screen',startedAt:SIGNAL_AT,updatedAt:MATCHED_AT,state:'complete',filters:[],hours:48}],records:[{id:'uai-match',roundId:'screen',sample:structuredClone(study.samples[0]),status:'matched',startTime:SIGNAL_AT,cursor:MATCHED_AT,matchedAt:MATCHED_AT,readings:[],updatedAt:MATCHED_AT}]};
 return {study,library,plan};
}
