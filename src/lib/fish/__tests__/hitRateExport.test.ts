import {expect,it} from 'vitest';
import {buildFishHitRateSheets} from '@/lib/fish/hitRateExport';
import type {FishHitRateWindow} from '@/lib/fish/hitRate';
import type {TradeSignal} from '@/lib/signalLibrary';

const at=Date.UTC(2026,10,12,3), minute=60_000;
const signal=(symbol:string,timeMs=at):TradeSignal=>({id:symbol,symbol,timeMs,timeLabel:'',fallbackZone:''});
const sample=signal('SAMPLEUSDT'),miss=signal('MISSUSDT'),unknown=signal('UNKNOWNUSDT'),market=signal('MARKETUSDT',at-minute);
const hit={...signal('SAMPLEUSDT',at-2*minute),fish:{featureShort:'S',cutoffMs:at,threshold:.5,average:.7,cbi2:0,startAverage:0,previousAverage:0}};
const threshold={algorithm:'状态 S',statistic:'avg_state_2',direction:'>' as const,unit:'原值',threshold:.5,cutoffMs:at+minute,cutoffReading:.4521,maximum:{value:.49,timeMs:at}};
const candle={openTime:at-5*minute,open:10,high:12,low:2,close:11};
const window:FishHitRateWindow={startMs:at-3*minute,anchorMs:at+minute,hits:[hit,market],rows:[
  {sample,status:'hit',hit},{sample:miss,status:'miss',rejections:[{kind:'thin',label:'成交额未达门槛'}],
    thresholds:[threshold],outside:[{...threshold,startMs:at-4*minute}],
    turnover:[{symbol:miss.symbol,exchange:'binance',stage:'cutoff',at:at+minute,checks:[{hours:1,value:1234.56789,min:2000,ok:false}],algorithms:['状态 S']}],
    wick:{symbol:miss.symbol,exchange:'binance',cutoffMs:at+minute,rule:{enabled:true,hours:1,atrMultiple:3},...candle,drop:8,atr:2,candles:[candle]}},
  {sample:unknown,status:'unverified',reason:'K 线缺段'},
]};
it('exports every sample and each evidence type with numeric cells, excluding unverified samples from the hit rate',()=>{
  const tabs=buildFishHitRateSheets({mode:'market',samples:[sample,miss,unknown],windows:[window],window:{beforeHours:.05,afterHours:1/60},startedAt:at,outcome:'测试结束'});
  const tab=(name:string)=>tabs.find(t=>t.name===name)!;
  const cell=(name:string,column:string,row=0)=>{const t=tab(name);return t.rows[row][t.columns.findIndex(c=>c.header===column)];};
  expect(Object.fromEntries(tab('运行摘要').rows.map(([key,value])=>[String(key),value]))).toMatchObject({'命中率（%）':50,'已判定样本数':2,'无法判定':1});
  expect(tab('样本结果').rows.map(row=>row[7])).toEqual(['命中','未命中','无法判定']);
  expect(cell('样本结果','相对样本（分钟）')).toBe(-2);
  expect(cell('算法门槛','窗口内最大值')).toBe(.49);
  expect(cell('算法门槛','截止读数')).toBe(.4521);
  expect(cell('信号起点超窗','相对边界（分钟）')).toBe(-1);
  expect(cell('成交额门槛','实际成交额（USDT）')).toBe(1234.56789);
  expect(cell('插针过滤','跌幅门槛')).toBe(6);
  expect(cell('插针附近K线','触发')).toBe('是');
  expect(tab('全市场命中').rows.map(row=>[row[0],row[3]])).toEqual([[sample.symbol,'本窗样本'],[market.symbol,'样本外']]);
});
