// 【用户要求】2026-10-20「检查历史信号库中所有信号在当时信号出现时的成交量，汇总看区间范围，用 USDT」（口径：信号前 24 小时成交额）
import {it,expect,vi,beforeEach} from 'vitest';
import {TURNOVER_WINDOWS,collectSignalTurnover,turnoverFromBars,summarizeTurnover,bucketTurnover,formatUsdtCn,signalTurnoverCsv,readSignalTurnover,rateTurnoverRows,turnoverRatingSummary,TURNOVER_STEP,TURNOVER_WINDOW_MS} from '@/lib/signalTurnover';
import {FishScanner} from '@/lib/fishScanner';
import {FishError} from '@/lib/fish/shared';
import type {FishDataAdapter} from '@/lib/fish/adapters';
import type {TradeSignal} from '@/lib/signalLibrary';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishSampleRow} from '@/lib/fish/suggestions';
const bar=(t:number,q:number|null):ResearchBar=>({openTime:t,open:1,high:1,low:1,close:1,volume:1,quoteVolume:q as number,takerBuyVolume:null});
const sig=(symbol:string,timeMs:number,extra:Partial<TradeSignal>={}):TradeSignal=>({id:symbol+timeMs,symbol,timeMs,timeLabel:'',fallbackZone:'',...extra});
beforeEach(()=>localStorage.clear());
it('各时长 = 截止那根 5m 之前 N 小时的成交额之和（同一批 K 线）；上市不足按上市以来计；没有 K 线 / 成交额缺失报原因',()=>{
 const cut=Date.UTC(2026,3,9,15,45);
 const full=Array.from({length:300},(_,i)=>bar(cut-(300-i)*TURNOVER_STEP,i));
 const sum=(h:number)=>full.filter(b=>b.openTime>=cut-h*3600000&&b.openTime<cut).reduce((s,b)=>s+b.quoteVolume!,0);
 const r=turnoverFromBars([...full,bar(cut,1e9)],cut);
 expect(r.hours).toBe(24);for(const h of TURNOVER_WINDOWS)expect(r.windows[h]).toBe(sum(h));
 expect(full.filter(b=>b.openTime>=cut-TURNOVER_WINDOW_MS&&b.openTime<cut)).toHaveLength(288);
 expect(r.windows[1]).toBe(full.slice(-12).reduce((s,b)=>s+b.quoteVolume!,0));
 const young=turnoverFromBars(full.slice(-24),cut);expect(young.hours).toBe(2);expect(young.windows[24]).toBe(young.windows[2]);expect(young.windows[1]).toBe(full.slice(-12).reduce((s,b)=>s+b.quoteVolume!,0));
 expect(()=>turnoverFromBars([],cut)).toThrow('没有 K 线');
 expect(()=>turnoverFromBars([bar(cut-TURNOVER_STEP,null)],cut)).toThrow('成交额读数不全');
});
it('分位数、分档与「万 / 亿」显示',()=>{
 const s=summarizeTurnover([5e6,1e6,3e7,2e8,9e5])!;
 expect(s).toMatchObject({n:5,min:9e5,max:2e8,p50:5e6});expect(s.mean).toBeCloseTo((5e6+1e6+3e7+2e8+9e5)/5);
 expect(bucketTurnover([5e4,3e5,9e5,1e6,5e6,3e7,2e8,1.5e9])).toEqual([1,1,1,1,1,1,0,1,0,1]);
 expect([formatUsdtCn(1234),formatUsdtCn(56_789_000),formatUsdtCn(3.456e8)]).toEqual(['1230','5680 万','3.46 亿']);
 expect(summarizeTurnover([])).toBeNull();
});
it('逐个取数：失败只记原因不影响其他；结果存本机、明细 CSV 一行一个信号',async()=>{
 const t=Date.UTC(2026,3,9,15,47),cut=Math.floor(t/TURNOVER_STEP)*TURNOVER_STEP;
 const load=vi.fn(async(row:FishSampleRow,_cut:number,_signal:AbortSignal)=>{if(row.symbol==='BADUSDT')throw new FishError('币安现在没有 BADUSDT 这个合约','skipped');const q=row.symbol==='AAAUSDT'?1000:10;return Array.from({length:288},(_,i)=>bar(cut-(288-i)*TURNOVER_STEP,q));});
 const progress:any[]=[];
 const r=await collectSignalTurnover({signals:[sig('AAAUSDT',t),sig('BBBUSDT',t),sig('BADUSDT',t),sig('bad',t)],signal:new AbortController().signal,onProgress:p=>progress.push(p)},load);
 expect(load.mock.calls.every(c=>c[1]===cut)).toBe(true);
 expect(r.stats[24]).toMatchObject({n:2,min:2880,max:288000});expect(r.stats[1]).toMatchObject({n:2,min:120,max:12000});expect(r.stats[6]).toMatchObject({min:720,max:72000});expect(r.partial[24]).toBe(0);expect(r.complete).toBe(true);expect(r.total).toBe(4);
 expect(r.rows.find(x=>x.symbol==='BADUSDT')?.reason).toContain('没有 BADUSDT');expect(r.rows.find(x=>x.symbol==='bad')?.reason).toBe('标的或时间无效');
 expect(progress.at(-1)).toMatchObject({status:'complete',done:4,total:4});
 expect(readSignalTurnover()?.fingerprint).toBe(r.fingerprint);
 const csv=signalTurnoverCsv(r).split('\n');expect(csv[0]).toBe('\uFEFF标的,交易所,信号时间(UTC+8),24h成交额(USDT),12h成交额(USDT),6h成交额(USDT),4h成交额(USDT),2h成交额(USDT),1h成交额(USDT),覆盖小时,说明,评分');expect(csv).toHaveLength(5);expect(csv.some(l=>l.startsWith('AAAUSDT,binance,')&&l.includes(',288000.00,144000.00,72000.00,48000.00,24000.00,12000.00,24,'))).toBe(true);
});
it('取消：只统计已取到的，标记未完成',async()=>{
 const t=Date.UTC(2026,3,9,15,47),cut=Math.floor(t/TURNOVER_STEP)*TURNOVER_STEP,c=new AbortController();let n=0;
 const r=await collectSignalTurnover({signals:Array.from({length:20},(_,i)=>sig(`C${i}USDT`,t)),signal:c.signal,onProgress:()=>{}},async()=>{if(++n===5)c.abort();return [bar(cut-TURNOVER_STEP,1)];});
 expect(r.complete).toBe(false);expect(r.rows.length).toBeLessThan(20);expect(r.stats[24]?.n).toBe(r.rows.length);expect(r.partial[1]).toBe(r.rows.length);
});
it('扫描器：按信号的交易所取 5m × 288 根（允许上市不足），其它家先查合约表',async()=>{
 const t=Date.UTC(2026,3,9,15,47),cut=Math.floor(t/TURNOVER_STEP)*TURNOVER_STEP;
 const make=(exchange:'binance'|'okx',q:number):FishDataAdapter=>({exchange,btc:()=>({symbol:'BTCUSDT',instrument:'BTC-USDT-SWAP',base:'BTC',multiplier:1}),taker:vi.fn() as any,list:vi.fn(async()=>[{symbol:'XXXUSDT',instrument:'XXX-USDT-SWAP',base:'XXX',multiplier:1}]),candles:vi.fn(async(_m,c,_s,query)=>Array.from({length:query!.count},(_,i)=>bar(c-(query!.count-i)*TURNOVER_STEP,q)))});
 const binance=make('binance',100),okx=make('okx',7);
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({serverTime:t+86400000}))) as unknown as typeof fetch;
 const r=await new FishScanner(fetcher,undefined,undefined,{binance,okx}).turnover({signals:[sig('AAAUSDT',t),sig('XXXUSDT',t,{exchange:'okx'})],signal:new AbortController().signal,onProgress:()=>{}});
 expect((binance.candles as any).mock.calls[0][1]).toBe(cut);expect((binance.candles as any).mock.calls[0][3]).toEqual({interval:'5m',count:288,allowPartial:true});
 expect((binance.candles as any).mock.calls[0][0].instrument).toBe('AAAUSDT');expect((okx.candles as any).mock.calls[0][0].instrument).toBe('XXX-USDT-SWAP');expect(okx.list).toHaveBeenCalledTimes(1);
 expect(r.rows.map(x=>[x.symbol,x.windows?.[24],x.windows?.[1]]).sort()).toEqual([['AAAUSDT',28800,1200],['XXXUSDT',2016,84]]);
});

const w=(v:number|null)=>v===null?null:{24:v,12:v/2,6:v/4,4:v/6,2:v/12,1:v/24};
it('评分从当前信号库关联：兼容旧缓存、区分交易所和市场、撤销评分不复活旧值',()=>{
 const t=1000;
 const signals=[sig('AAAUSDT',t,{quality:2}),sig('AAAUSDT',t,{exchange:'okx',quality:5}),sig('AAAUSDT',t,{market:'us_stock',underlying:'AAA',quality:4})];
 const rows=[{symbol:'AAAUSDT',timeMs:t,windows:w(0),hours:24,quality:1},{symbol:'AAAUSDT',exchange:'okx',timeMs:t,windows:w(20),hours:24},{symbol:'AAAUSDT',market:'us_stock',timeMs:t,windows:w(40),hours:24}];
 expect(rateTurnoverRows(rows,signals).map(r=>r.quality)).toEqual([2,5,4]);
 expect(rateTurnoverRows(rows,[...signals,sig('AAAUSDT',t,{market:'us_stock',underlying:'OTHER',quality:1})])[2].quality).toBeUndefined();
 expect(rateTurnoverRows([{...rows[2],underlying:'OTHER'}],[...signals,sig('AAAUSDT',t,{market:'us_stock',underlying:'OTHER',quality:1})])[0].quality).toBe(1);
 expect(rateTurnoverRows(rows,signals.map(s=>({...s,quality:undefined}))).map(r=>r.quality)).toEqual([undefined,undefined,undefined]);
 expect(rateTurnoverRows(rows,[]).map(r=>r.quality)).toEqual([undefined,undefined,undefined]);
 const none={24:null,12:null,6:null,4:null,2:null,1:null},zero={24:0,12:0,6:0,4:0,2:0,1:0};
 const result={version:2 as const,fingerprint:'',createdAt:0,total:3,rows,stats:none,partial:zero,complete:true};
 expect(signalTurnoverCsv(result,signals).split('\n').slice(1).map(l=>l.split(',').at(-1))).toEqual(['2','5','4']);
 expect(signalTurnoverCsv(result,[]).split('\n').slice(1).every(l=>l.endsWith(','))).toBe(true);
});
it('各评分档只计有效成交额，保留零值，中位数按档、按所选时长计算，未评分不混入',()=>{
 const row=(v:number|null,quality?:number)=>({symbol:'AAAUSDT',timeMs:1,windows:v===null?null:{24:v,12:v,6:v,4:v,2:v,1:v/10},quality,hours:24});
 const rows=[row(0,1),row(10,1),row(100,2),row(null,2),row(NaN,2),row(-1,2),row(500)];
 expect(turnoverRatingSummary(rows)).toEqual([{quality:1,count:2,median:5},{quality:2,count:1,median:100},{quality:3,count:0,median:null},{quality:4,count:0,median:null},{quality:5,count:0,median:null}]);
 expect(turnoverRatingSummary(rows,1)[1]).toEqual({quality:2,count:1,median:10});
});
