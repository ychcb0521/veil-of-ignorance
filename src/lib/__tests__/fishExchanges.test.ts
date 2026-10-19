import { describe, it, expect, vi } from 'vitest';
import { fishTransport, FishAdapter, joinFishTaker, parseOkxCandle, parseGateCandle, parseOkxTrade, parseGateTrade, parseBitgetCandle, parseBitgetTrade, type FishDataAdapter } from '@/lib/fish/adapters';
import { fishBase, selectFishMarkets, type FishExchange, type FishMarket } from '@/lib/fish/exchanges';
import { FISH_STEP, FishError, FishScanner, calculateFishReadings } from '@/lib/fishScanner';
import { mergeSignals, signalDedupKey, signalChartSymbol, type TradeSignal } from '@/lib/signalLibrary';
import { parseBinanceKlineRow, type ResearchBar } from '@/lib/deepRsa/window';
import { FishWeightBudget, FishRequestPool } from '@/lib/fish/shared';
import { okxPublicUrl, handleFishProxy } from '../../../supabase/functions/fish-market-proxy/handler';

const cut=10000*FISH_STEP;
const abort=new AbortController().signal;
function fixture() {
  let price=100,seed=123;
  const bars:ResearchBar[]=Array.from({length:2001},(_,i)=>{
    seed=(seed*1664525+1013904223)>>>0;price+=((seed%9)-4)/128;
    return {openTime:cut-(2000-i)*FISH_STEP,open:price,high:price+0.125,low:price-0.125,close:price,volume:128,quoteVolume:128*price,takerBuyQuoteVolume:(i%3?96:32)*price,takerBuyVolume:i%3?96:32};
  });
  const okx=bars.map(b=>[String(b.openTime),String(b.open),String(b.high),String(b.low),String(b.close),String(b.volume/0.125),String(b.volume),String(b.quoteVolume),b.openTime===cut?'0':'1']);
  const gate=bars.map(b=>({t:b.openTime/1000,o:String(b.open),h:String(b.high),l:String(b.low),c:String(b.close),v:String(b.volume/0.125),sum:String(b.quoteVolume)}));
  const trades=bars.flatMap((b,i)=>[
    {id:String(2*i+1),timeMs:b.openTime+1,buy:true,volume:b.takerBuyVolume!,quote:b.takerBuyQuoteVolume!},
    {id:String(2*i+2),timeMs:b.openTime+FISH_STEP-0.5,buy:false,volume:b.volume-b.takerBuyVolume!,quote:b.quoteVolume!-b.takerBuyQuoteVolume!},
  ]);
  return {bars,okx,gate,trades};
}
function market(exchange:FishExchange,base='BTC'):FishMarket {return {symbol:base+'USDT',base,multiplier:0.125,instrument:exchange==='okx'?base+'-USDT-SWAP':exchange==='gate'?base+'_USDT':base+'USDT'};}
function adapterFixture(exchange:'okx'|'gate'|'bitget', omitTrade=false) {
  const f=fixture();const calls:string[]=[];
  const request=vi.fn(async(path:string)=>{
    calls.push(path);const u=new URL(path,'https://example.test/');
    if(path.startsWith('public/instruments'))return {code:'0',data:[{instId:'BTC-USDT-SWAP',ctType:'linear',settleCcy:'USDT',state:'live',ctVal:'0.125',ctValCcy:'BTC',ctMult:'1'}]};
    if(path.startsWith('contracts?productType='))return {code:'00000',data:[{symbol:'BTCUSDT',baseCoin:'BTC',quoteCoin:'USDT',symbolStatus:'normal',symbolType:'perpetual'}]};
    if(path==='contracts')return [{name:'BTC_USDT',type:'direct',status:'trading',in_delisting:false,quanto_multiplier:'0.125'}];
    if(path.startsWith('market/history-candles')){
      const after=Number(u.searchParams.get('after'));
      // Deliberate page-boundary overlap and forming candle: adapter must deduplicate/filter.
      return {code:'0',data:f.okx.filter(r=>Number(r[0])<=after).reverse().slice(0,100)};
    }
    if(path.startsWith('history-candles')){const end=Number(u.searchParams.get('endTime'));return {code:'00000',data:f.bars.filter(b=>b.openTime<=end).slice(-200).map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.quoteVolume])};}
    if(path.startsWith('candlesticks'))return [...f.gate,f.gate[0]];
    let trades=f.trades.filter(t=>!omitTrade||t.id!=='2000').slice().reverse();
    if(exchange==='okx'){
      const after=u.searchParams.get('after')!;
      trades=trades.filter(t=>u.searchParams.get('type')==='2'?t.timeMs<Number(after):BigInt(t.id)<BigInt(after));
      return {code:'0',data:trades.slice(0,100).map(t=>({tradeId:t.id,ts:String(t.timeMs),side:t.buy?'buy':'sell',sz:String(t.volume/0.125),px:String(t.quote/t.volume)}))};
    }
    if(exchange==='bitget'){const id=u.searchParams.get('idLessThan');return {code:'00000',data:trades.filter(t=>t.timeMs>=Number(u.searchParams.get('startTime'))&&t.timeMs<=Number(u.searchParams.get('endTime'))&&(!id||BigInt(t.id)<BigInt(id))).slice(0,1000).map(t=>({tradeId:t.id,ts:String(t.timeMs),side:t.buy?'Buy':'Sell',size:String(t.volume),price:String(t.quote/t.volume)}))};}
    const from=Number(u.searchParams.get('from'))*1000,to=Number(u.searchParams.get('to'))*1000;
    return trades.filter(t=>t.timeMs>=from&&t.timeMs<=to).slice(Number(u.searchParams.get('offset')),Number(u.searchParams.get('offset'))+1000).map(t=>({id:Number(t.id),create_time:t.timeMs/1000,size:String((t.buy?1:-1)*t.volume/0.125),price:String(t.quote/t.volume)}));
  });
  return {f,calls,adapter:new FishAdapter(exchange,request)};
}

describe('交易所适配与金额口径',()=>{
  for(const exchange of ['okx','bitget','gate'] as const)it(`${exchange}: 2000根翻页、去重、未收盘排除、面值换算、A逐位等同币安路径`,async()=>{
    const {adapter,f,calls}=adapterFixture(exchange);await adapter.list(abort);const m=adapter.btc();
    const prices=await adapter.candles(m,cut,abort);expect(prices).toHaveLength(2000);expect(prices[1999].openTime).toBe(cut-FISH_STEP);
    const filled=await adapter.taker(m,prices,abort);
    expect(filled).toEqual(f.bars.slice(0,2000));
    const normalized=filled.map(b=>({...b,refClose:b.close*500}));
    const native=f.bars.slice(0,2000).map(b=>({...parseBinanceKlineRow([b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+FISH_STEP-1,b.quoteVolume,2,b.takerBuyVolume,b.takerBuyQuoteVolume,0])!,refClose:b.close*500}));
    const a=calculateFishReadings(normalized),expected=calculateFishReadings(native);
    for(let i=1454;i<2000;i++){expect(Number.isFinite(a.average[i])).toBe(true);expect(a.average[i]).toBe(expected.average[i]);expect(a.cbi2[i]).toBe(expected.cbi2[i]);}
    const before=calls.length;await adapter.taker(m,await adapter.candles(m,cut,abort),abort);expect(calls).toHaveLength(before);
    f.okx[2000][8]='1';
    const advanced=await adapter.taker(m,await adapter.candles(m,cut+FISH_STEP,abort),abort);
    expect(advanced).toEqual(f.bars.slice(1,2001));
    expect(calls.length-before).toBeLessThanOrEqual(2);
  });
  for(const exchange of ['okx','bitget','gate'] as const)it(`${exchange}: 主动成交缺一笔则整币跳过，不以0或收盘价估计补齐`,async()=>{
    const {adapter}=adapterFixture(exchange,true);await adapter.list(abort);const m=adapter.btc();await expect(adapter.taker(m,await adapter.candles(m,cut,abort),abort)).rejects.toMatchObject({kind:'readings'});
  });
  it('末秒小数成交仍属于本根；张数乘合约面值再乘实际成交价',()=>{
    const f=fixture(),m=0.125;
    expect(parseOkxCandle(f.okx[2000],m)).toBeNull();expect(parseGateCandle(f.gate[0],m).volume).toBe(128);
    expect(parseGateTrade({id:1,create_time:100.999,size:'-3.5',price:'12'},m)).toMatchObject({timeMs:100999,buy:false,volume:0.4375,quote:5.25});
    expect(parseBitgetCandle([100,10,11,9,10,128,1280]).volume).toBe(128);
    expect(parseBitgetTrade({tradeId:'3',ts:'100',side:'Buy',size:'0.125',price:'12'}).quote).toBe(1.5);
    expect(parseOkxTrade({tradeId:'2',ts:'100',side:'buy',sz:'3.5',px:'12'},m).quote).toBe(5.25);
    expect(()=>joinFishTaker(f.bars.slice(0,2000),f.trades.filter(t=>t.id!=='1000'))).toThrow(/不一致或缺根/);
  });
});

describe('交易所去重、优先级和独立BTC',()=>{
  it('旧币安键保持原样；各交易所互不覆盖；XBT和1000PEPE归为同一基础币，1INCH保留',()=>{
    const s:TradeSignal={id:'a',symbol:'PEPEUSDT',timeMs:1,timeLabel:'x',fallbackZone:''};
    expect(signalDedupKey(s)).toBe('PEPEUSDT@1');expect(signalDedupKey({...s,exchange:'binance'})).toBe('PEPEUSDT@1');
    expect(mergeSignals([s],[{...s,id:'b',exchange:'binance'},{...s,id:'c',exchange:'okx'},{...s,id:'d',exchange:'gate'}])).toHaveLength(3);
    const universes={binance:[market('binance','1000PEPE'),market('binance','BTC')],okx:[market('okx','PEPE'),market('okx','AAA')],gate:[market('gate','PEPE'),market('gate','AAA'),market('gate','BBB')]};
    expect(selectFishMarkets('gate',universes,false).map(m=>m.base)).toEqual(['BBB']);expect(selectFishMarkets('gate',universes,true)).toHaveLength(3);
    expect(fishBase('XBT')).toBe('BTC');expect(fishBase('1INCH')).toBe('1INCH');
    expect(signalChartSymbol({...s,exchange:'gate'})).toBeNull();expect(signalChartSymbol({...s,exchange:'gate',binanceSymbol:'1000PEPEUSDT'})).toBe('1000PEPEUSDT');
  });
  function fleet(broken?:FishExchange, banned?:FishExchange) {
    const seen:{exchange:FishExchange;refs:number[]}[]=[];
    const adapters:Partial<Record<FishExchange,FishDataAdapter>>={};
    for(const [index,e] of (['binance','okx','gate'] as const).entries()){
      const markets=[market(e),market(e,'AAA'),market(e,e==='binance'?'ONE':e==='okx'?'TWO':'THREE')];
      adapters[e]={exchange:e,list:async()=>markets,btc:()=>markets[0],candles:async(m,_cut,_signal,query)=>{
        if(e===broken&&m.base==='BTC')throw new FishError('BTC缺根','gap');
        const n=query?.count??2000,base=fixture().bars[0];return Array.from({length:n},(_,i)=>({...base,openTime:cut-(n-i)*FISH_STEP,close:(index+1)*100,open:(index+1)*100}));
      },taker:async(_m,b)=>{if(e===banned)throw new FishError('HTTP 418','banned');seen.push({exchange:e,refs:b.map(x=>x.refClose??0)});return b;}};
    }
    adapters.bitget={exchange:'bitget',list:async()=>[],btc:()=>market('bitget'),candles:async()=>[],taker:async(_m,b)=>b};
    const request=vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+1234}))) as unknown as typeof fetch;
    const refs:number[]=[];
    const scanner=new FishScanner(request,undefined,b=>{refs.push(b[0].refClose!);return {cbi2:Float64Array.from(b,()=>0.5),average:Float64Array.from(b,(_,i)=>i<1900?0.2:0.4)};},adapters);
    return {scanner,refs,request};
  }
  it('同一截止、独立BTC；默认基础币优先级，不依赖勾选；含重复币时分别入库',async()=>{
    const f=fleet(),signals:TradeSignal[]=[];const common={signal:abort,onProgress:()=>{},onSignal:(s:TradeSignal)=>signals.push(s)};
    const result=await f.scanner.scan({...common,exchanges:['binance','okx','gate']});
    expect(result.done).toBe(5);expect(new Set(signals.map(s=>s.id)).size).toBe(5);expect(new Set(f.refs)).toEqual(new Set([100,200,300]));
    expect(Object.values(result.venues!).every(p=>p.cutoffMs===cut)).toBe(true);
    const all:TradeSignal[]=[];await f.scanner.scan({...common,onSignal:s=>all.push(s),exchanges:['binance','okx','gate'],includeDuplicates:true});expect(all).toHaveLength(9);
    expect(mergeSignals([],all)).toHaveLength(9);expect(all.filter(s=>s.symbol==='AAAUSDT')).toHaveLength(3);
    expect(all.find(s=>s.exchange==='gate'&&s.symbol==='AAAUSDT')?.binanceSymbol).toBe('AAAUSDT');
    const only:TradeSignal[]=[];await f.scanner.scan({...common,onSignal:s=>only.push(s),exchanges:['gate']});expect(only.map(s=>s.symbol)).toEqual(['THREEUSDT']);
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it('引用BTC时某家参考缺根则整轮中止，不产生任何信号',async()=>{
    const f=fleet('okx'),signals:TradeSignal[]=[];const result=await f.scanner.scan({signal:abort,onProgress:()=>{},onSignal:s=>signals.push(s),exchanges:['binance','okx','gate']});
    expect(result.venues!.okx!.status).toBe('aborted');expect(result.venues!.okx!.error).toContain('BTC');expect(result.venues!.binance!.status).toBe('aborted');expect(result.venues!.gate!.status).toBe('aborted');expect(result.status).toBe('aborted');expect(signals).toHaveLength(0);
  });
  it('某家418只中止该家，取消则停止全部交易所',async()=>{
    const f=fleet(undefined,'okx');const result=await f.scanner.scan({signal:abort,onProgress:()=>{},onSignal:()=>{},exchanges:['binance','okx','gate'],includeDuplicates:true});
    expect(result.venues!.okx).toMatchObject({status:'aborted',error:'HTTP 418'});expect(result.venues!.gate!.status).toBe('complete');expect(result.venues!.binance!.status).toBe('complete');
    const controller=new AbortController();controller.abort();const cancelled=await fleet().scanner.scan({signal:controller.signal,onProgress:()=>{},onSignal:()=>{},exchanges:['binance','okx','gate']});expect(cancelled.status).toBe('cancelled');
  });

});

describe('OKX只读代理白名单',()=>{
  it('仅固定公开路径、USDT SWAP和已支持周期，不能访问账户、外域、任意查询或写入',async()=>{
    for(const path of ['https://evil.test/','../trade/order','market/history-candles?instId=BTC-USD-SWAP&bar=5m','market/history-candles?instId=BTC-USDT-SWAP&bar=7m','public/instruments?instType=SWAP&url=https://evil.test','public/instruments?instType=SWAP&instType=SPOT'])expect(()=>okxPublicUrl(path)).toThrow();
    const fetcher=vi.fn(async()=>new Response('{"code":"0","data":[]}'));
    const url='https://test/functions/v1/fish-market-proxy?'+new URLSearchParams({path:'market/history-trades?instId=BTC-USDT-SWAP&type=2&after=1000&limit=100'});
    expect((await handleFishProxy(new Request(url,{method:'POST'}),fetcher)).status).toBe(405);expect(fetcher).not.toHaveBeenCalled();
    const response=await handleFishProxy(new Request(url,{headers:{Authorization:'private'}}),fetcher);expect(response.status).toBe(200);expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL),expect.objectContaining({method:'GET',redirect:'error',headers:{Accept:'application/json'}}));
  });
});

describe('跨交易所并发与独立限速',()=>{
  it('总并发≤3，fetch保留globalThis接收者',async()=>{
    const pool=new FishRequestPool();let active=0,max=0;
    const fetcher=(async function(this:unknown){expect(this).toBe(globalThis);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,3));active--;return new Response('{}');}) as typeof fetch;
    const transports=(['binance','okx','bitget','gate'] as const).map(e=>fishTransport(e,fetcher,new FishWeightBudget(),pool));
    await Promise.all(Array.from({length:20},(_,i)=>transports[i%4]('contracts',1,abort)));expect(max).toBe(3);expect(active).toBe(0);
  });
  it('OKX优先直接读公开行情，仅网络/CORS失败才切只读代理，418不换路',async()=>{
    const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(new Response('{}'));
    const request=fishTransport('okx',fetcher,new FishWeightBudget());await request('public/instruments?instType=SWAP',1,abort);
    expect(String(fetcher.mock.calls[0][0])).toMatch(/^https:\/\/www.okx.com\/api\/v5\//);expect(String(fetcher.mock.calls[1][0])).toContain('/functions/v1/fish-market-proxy?');
    fetcher.mockResolvedValueOnce(new Response('{}'));await request('public/instruments?instType=SWAP',1,abort);expect(String(fetcher.mock.calls[2][0])).toContain('/functions/v1/fish-market-proxy?');
    const banned=vi.fn().mockResolvedValue(new Response('{}',{status:418}));await expect(fishTransport('okx',banned,new FishWeightBudget())('x',1,abort)).rejects.toMatchObject({kind:'banned'});expect(banned).toHaveBeenCalledTimes(1);
  });
  it('一家限速等待不占网络槽，不阻塞其它家；取消可退出所有等待',async()=>{
    const controller=new AbortController(),pool=new FishRequestPool();const slow=new FishWeightBudget();slow.pauseUntil(Date.now()+60000);
    const fetcher=vi.fn(async()=>new Response('{}'));
    const okx=fishTransport('okx',fetcher,slow,pool),gate=fishTransport('gate',fetcher,new FishWeightBudget(),pool);
    const pending=Array.from({length:3},()=>okx('x',1,controller.signal));
    try{expect(await Promise.race([gate('contracts',1,controller.signal),new Promise(r=>setTimeout(()=>r('blocked'),200))])).toEqual({});}
    finally{controller.abort();await Promise.allSettled(pending);}
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('每家滑动窗口预算互不扣减，达到文档预算后等待自己的窗口',async()=>{
    for(const [limit,window] of [[20,2000],[10,1000],[200,10000]]){
      let now=0;const sleeps:number[]=[];const budget=new FishWeightBudget(()=>now,async ms=>{sleeps.push(ms);now+=ms;},limit,window);
      const other=new FishWeightBudget(()=>now,async()=>{throw new Error('不应占用另一家预算');},1,window);
      for(let i=0;i<limit;i++)await budget.take(1,abort);await other.take(1,abort);expect(sleeps).toEqual([]);await budget.take(1,abort);expect(sleeps).toEqual([window]);
    }
  });
});
