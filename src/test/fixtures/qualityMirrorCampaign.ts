import {newQualityStudy,importQualityLibrary,qualityComparisonRows,type QualityResult} from '@/lib/fish/quality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {buildQualityCampaignData} from '@/lib/fish/qualityCampaigns';
export const QUALITY_MIRROR_FIXTURE_TIME=Date.UTC(2026,9,29);
export function qualityMirrorCampaignFixture(){
 const T=QUALITY_MIRROR_FIXTURE_TIME,M=60000;
 const study=enableQualityComparison(importQualityLibrary(newQualityStudy(T),[{id:'fixture',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''}]));
 const sample=qualityComparisonRows(study)[0],plan={...study.sellPlans![0],mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...defaultQualityAddition(),enabled:true}};
 const addition={at:T+2*M,price:110,notional:220,quantity:2,scanFrom:T,reading:1,threshold:.5,direction:'>' as const,metric:'raw',label:'探测',barOpenTime:T+M,sizing:{support:107,previousSupport:100,atr:2,atrAt:T,coinsBefore:.5,realAverageBefore:100,baseCoins:7/6,mirrorCoins:5/6,mirrorUsed:2.5}};
 const result:QualityResult={key:'mirror-fixture',sampleId:sample.id,groupId:plan.id,status:'closed',entryTime:T,entryPrice:100,endTime:T+10*M,endPrice:120,evaluatedAt:T+10*M,
  mirrorFill:{at:T+M,price:105,fraction:.5,gainPct:5,atOpen:false},additionFill:addition,additionFills:[addition],initialNotional:100,totalInvested:320,averageEntryPrice:108,remainingQuantity:0,remainingCost:0,
  pnl:32.5,returnPct:32.5/320*100,mirrorRealizedPnl:2.5,remainingPnl:30,realizedPnl:32.5,reason:'算法达标，全部卖出',exitReading:.4};
 return buildQualityCampaignData('fixture',{sample,plan,result,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell');
}
