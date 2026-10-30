import type {LibraryPayload} from '../libraryTransfer';
import {STATE_DEF,definitionKey} from '@/lib/deepDig/features';
export function payload(at=100,pct=10,threshold=.5):LibraryPayload{
 const snapshot={featureId:'state',definitionKey:definitionKey(STATE_DEF),interval:'5m',statistic:'state',scale:1,direction:'>',threshold:.7,average:.8};
 const source={id:'signal-id',symbol:'TESTUSDT',timeMs:1000000,timeLabel:'2026-01-01',fallbackZone:1,exchange:'binance',market:'crypto',fish:snapshot};
 const plan={id:'plan-id',label:'状态 S',metric:'state',snapshot,rule:{direction:'<',threshold}};
 const result={key:'result-id',sampleId:'sample',groupId:'plan-id',evaluatedAt:at,status:'closed',entryTime:1300000,entryPrice:100,endTime:2000000,endPrice:100+pct,returnPct:pct,mirrorFill:{time:1600000,price:105,sellFraction:.5}};
 const signature=JSON.stringify([snapshot.definitionKey,threshold,'全部其他参数']);
 return {
  mining:{version:1,runs:[{id:'run',signature:'mining-signature',rules:[{id:'rule',featureId:'state',statistic:'state',threshold:'.7'}],startMs:1000000,stepMs:43200000,firstAt:at,updatedAt:at}],anchors:[{id:'anchor',runId:'run',anchorMs:1300000,scannedAt:at,updatedAt:at,found:1,added:1,recordIds:['mined'],attempts:1}],records:[{id:'mined',runId:'run',anchorMs:1300000,catchKey:'catch',signal:source as any,firstSavedAt:1,updatedAt:at}]},
  filter:{version:1,settings:[{id:'filter',signature:'filter-sig',filters:[{id:'f',label:'S',metric:'state',snapshot,direction:'>',threshold:.7,enabled:true}],plans:[]}],records:[{id:'filtered',settingId:'filter',source,enteredAt:1300000,basis:'capture',readings:[{key:'reading',value:0,at:1000000}],status:{state:'pass',detail:'符合'},firstSavedAt:1,updatedAt:at}],rounds:[{id:'f-round',startedAt:1,updatedAt:at,state:'complete',recordIds:['filtered']},{id:'f-round-2',startedAt:2,updatedAt:at,state:'complete',base:'f-round',added:[],removed:[]}]},
  monitor:{version:1,importedLegacy:true,settings:[{id:'setting',signature,plan:plan as any,detectors:[],observeHours:168,entryMode:'capture',filtersKnown:true,detectorsKnown:true,notional:1000,leverage:1}],records:[{id:'monitored',settingId:'setting',source:source as any,enteredAt:1300000,basis:'capture',filterStatus:{state:'pass',detail:'符合'},readings:[],result:result as any,firstSavedAt:1,updatedAt:at}],rounds:[{id:'m-round',startedAt:1,updatedAt:at,state:'complete',recordIds:['monitored']}]},
  observations:{entryReadings:[{key:'entry',value:0,evaluatedAt:at,entryTime:1300000,mode:'closed',metric:'state'}],postExitReadings:[{key:'post',evaluatedAt:at,exitTime:2000000,exitPrice:110,startMs:2060000,excludedExitMinute:true,windows:[{hours:.5,status:'ready',peakPct:3,drawdown2Pct:1}]}]},
 } as unknown as LibraryPayload;
}
