import { describe,it,expect,vi } from 'vitest';
import { FishAdapter,fishTransport,type FishDataAdapter } from '@/lib/fish/adapters';
import { FishScanner } from '@/lib/fishScanner';
import { FishWeightBudget,FishError,FISH_BARS,FISH_STEP,validateFishBars } from '@/lib/fish/shared';
import { fishRetentionReason,monthsBefore } from '@/lib/fish/retention';
import type { FishMarket,FishExchange } from '@/lib/fish/exchanges';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { handleFishProxy } from '../../../supabase/functions/fish-market-proxy/handler';
const signal=new AbortController().signal,cut=Date.UTC(2026,9,19,3),from=cut-FISH_BARS*FISH_STEP;
const market:FishMarket={symbol:'BTCUSDT',instrument:'BTC_USDT',base:'BTC',multiplier:1};
const makeBars=(n=2000,end=cut):ResearchBar[]=>Array.from({length:n},(_,i)=>({openTime:end-(n-i)*FISH_STEP,open:100,high:101,low:99,close:100,volume:1,quoteVolume:100,takerBuyVolume:0.6,takerBuyQuoteVolume:60}));
const response=(body:unknown={},status=200)=>new Response(JSON.stringify(body),{status});

describe('Gate右端含端点与成交分页',()=>{
  it('实际闭区间返回恰好2000根；缓存前移只补1根，from=to合法，不请求形成中的根',async()=>{
    const requested:URL[]=[],adapter=new FishAdapter('gate',async path=>{
      const u=new URL(path,'https://test/');requested.push(u);const a=Number(u.searchParams.get('from'))*1000,b=Number(u.searchParams.get('to'))*1000;
      const count=(b-a)/FISH_STEP+1;expect(count).toBeLessThanOrEqual(2000);
      return Array.from({length:count},(_,i)=>({t:(a+i*FISH_STEP)/1000,o:'100',h:'101',l:'99',c:'100',v:'1',sum:'100'}));
    });
    const bars=await adapter.candles(market,cut,signal);expect(bars).toHaveLength(2000);expect(requested[0].searchParams.get('to')).toBe(String((from+999*FISH_STEP)/1000));expect(requested[1].searchParams.get('to')).toBe(String((cut-FISH_STEP)/1000));
    await adapter.candles(market,cut,signal);expect(requested).toHaveLength(2);
    const advanced=await adapter.candles(market,cut+FISH_STEP,signal);expect(advanced.map(b=>b.openTime)).toEqual(makeBars(2000,cut+FISH_STEP).map(b=>b.openTime));
    expect(requested[2].searchParams.get('from')).toBe(String(cut/1000));expect(requested[2].searchParams.get('to')).toBe(String(cut/1000));
  });
  it('历史补取与尾部补取拼接无重无漏，每段根数不超过2000',async()=>{
    const adapter=new FishAdapter('gate',async path=>{const u=new URL(path,'https://test/'),a=Number(u.searchParams.get('from'))*1000,b=Number(u.searchParams.get('to'))*1000;expect((b-a)/FISH_STEP+1).toBeLessThanOrEqual(2000);return Array.from({length:(b-a)/FISH_STEP+1},(_,i)=>({t:(a+i*FISH_STEP)/1000,o:'100',h:'101',l:'99',c:'100',v:'1',sum:'100'}));});
    await adapter.candles(market,cut,signal);const past=await adapter.candles(market,cut-2*FISH_STEP,signal);validateFishBars(past,cut-2*FISH_STEP);expect(new Set(past.map(b=>b.openTime)).size).toBe(2000);
  });
  it('trades右端仍传完整边界再按毫秒排除右端；保留最后1秒内成交；offset页之间无丢失重复',async()=>{
    const bars=makeBars(),trades=bars.map((b,i)=>({id:i+1,create_time:(b.openTime+FISH_STEP-0.5)/1000,size:'1',price:'100'})).reverse();
    trades.unshift({id:2001,create_time:cut/1000,size:'1',price:'100'});
    const offsets:number[]=[];const adapter=new FishAdapter('gate',async path=>{const u=new URL(path,'https://test/');expect(Number(u.searchParams.get('to'))*1000).toBe(cut);const offset=Number(u.searchParams.get('offset'));offsets.push(offset);return trades.slice(offset,offset+1000);});
    const result=await adapter.taker(market,bars.map(({takerBuyQuoteVolume:_,...b})=>b),signal);
    expect(offsets).toEqual([0,1000,2000]);expect(result.every(b=>b.takerBuyQuoteVolume===100)).toBe(true);
  });
});
describe('只读代理回退与中文诊断',()=>{
  for(const exchange of ['okx','gate','bitget'] as const)it(`${exchange}：TypeError仅尝试一次代理，然后保持代理；代理仍跨域不循环重试`,async()=>{
    const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async()=>response());
    const request=fishTransport(exchange,fetcher,new FishWeightBudget());await request('contracts',1,signal);await request('contracts',1,signal);
    expect(fetcher).toHaveBeenCalledTimes(3);expect(String(fetcher.mock.calls[0][0])).not.toContain('/functions/');
    for(const call of fetcher.mock.calls.slice(1)){const u=new URL(String(call[0]));expect(u.pathname).toContain('fish-market-proxy');expect(u.searchParams.get('exchange')).toBe(exchange);}
    const blocked=vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));await expect(fishTransport(exchange,blocked,new FishWeightBudget())('contracts',1,signal)).rejects.toThrow(/浏览器拦截（网络 \/ 跨域）/);expect(blocked).toHaveBeenCalledTimes(2);
  });
  for(const exchange of ['okx','gate','bitget'] as const)for(const status of [418,429])it(`${exchange}：HTTP ${status}不借代理换路，保留路径和状态`,async()=>{
    const fetcher=vi.fn(async()=>response({},status));await expect(fishTransport(exchange,fetcher,new FishWeightBudget())('contracts',1,signal)).rejects.toMatchObject({kind:status===418?'banned':'failed',detail:{path:'contracts',status}});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('代理给出真实HTTP400，历史范围错误用中文，不显示Failed to fetch',async()=>{
    const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(response({label:'INVALID_PARAM_VALUE',message:'Candlestick too long ago. Maximum 10000 points recently are allowed'},400));
    await expect(fishTransport('gate',fetcher,new FishWeightBudget())('candlesticks?contract=BTC_USDT',1,signal)).rejects.toThrow(/Gate · candlesticks.*HTTP 400：历史K线超过最近10000根/);
  });
});
describe('保留期与上市历史',()=>{
  it('OKX用3个日历月，Bitget用90天；窗口第一根恰好在保留边界允许，早1毫秒则拒绝',()=>{
    const now=Date.UTC(2026,9,19,3),window=2000*FISH_STEP;
    for(const e of ['okx','bitget'] as const){const oldest=e==='okx'?monthsBefore(now,3):now-90*86400000;expect(fishRetentionReason(e,oldest+window,now)).toBeUndefined();expect(fishRetentionReason(e,oldest+window-1,now)).toContain('历史成交只保留');}
    expect(monthsBefore(Date.UTC(2026,4,31,5),3)).toBe(Date.UTC(2026,1,28,5));
    expect(monthsBefore(Date.UTC(2024,4,31),3)).toBe(Date.UTC(2024,1,29));
  });
  it('Gate逐笔没有杜撰固定天数，按已实测的10000根K线预检；边界与币安不受影响',()=>{
    const now=cut+123456,oldest=cut-10000*FISH_STEP;
    expect(fishRetentionReason('gate',oldest+2000*FISH_STEP,now)).toBeUndefined();expect(fishRetentionReason('gate',oldest+2000*FISH_STEP-1,now)).toContain('历史K线');expect(fishRetentionReason('binance',1,now)).toBeUndefined();
  });
  it('现场旧时间：三家整家跳过，不发BTC或其它逐币请求，也不污染读数不全计数',async()=>{
    const adapters:Partial<Record<FishExchange,FishDataAdapter>>={};
    for(const exchange of ['binance','okx','bitget','gate'] as const)adapters[exchange]={exchange,list:vi.fn(async()=>[market]),btc:()=>market,candles:vi.fn(async()=>makeBars()),taker:vi.fn(async(_m,b)=>b)};
    const request=vi.fn(async()=>response({serverTime:cut}));const scanner=new FishScanner(request as typeof fetch,undefined,undefined,adapters);
    const p=await scanner.scan({anchorMs:Date.UTC(2026,4,26,8,55),exchanges:['okx','bitget','gate'],signal,onProgress:()=>{},onSignal:()=>{throw Error('不应入库');}});
    for(const exchange of ['okx','bitget','gate'] as const){expect(p.venues![exchange]!.status).toBe('skipped');expect(adapters[exchange]!.candles).not.toHaveBeenCalled();expect(adapters[exchange]!.taker).not.toHaveBeenCalled();}
    expect(p.counts.readings).toBe(0);expect(p.counts.failed).toBe(0);expect(p.done).toBe(0);
  });
  it('前段缺失和全无数据算历史不足；中间/末尾缺根仍是缺口',()=>{
    const bars=makeBars();expect(()=>validateFishBars(bars.slice(4),cut)).toThrow(/未上市 \/ 历史不足/);
    for(const b of [[],bars.slice(4)]){try{validateFishBars(b,cut);throw Error('应失败');}catch(e){expect(e).toMatchObject({kind:'history'});}}
    for(const b of [bars.filter((_,i)=>i!==15),bars.slice(0,-1)]){try{validateFishBars(b,cut);throw Error('应失败');}catch(e){expect(e).toMatchObject({kind:'gap'});}}
  });
  it('读数不全与请求失败各保留前10个币的接口/校验原因；历史不足独立计数',async()=>{
    const markets=Array.from({length:28},(_,i)=>({...market,symbol:`COIN${i}USDT`,instrument:`COIN${i}_USDT`,base:`COIN${i}`}));
    const adapter:FishDataAdapter={exchange:'gate',list:async()=>markets,btc:()=>market,candles:async(m,_cut,_signal,query)=>{if(m===market)return makeBars(query?.count);if(m===markets[27])throw new FishError('当时没有K线','history');return makeBars(query?.count);},taker:async m=>{if(markets.indexOf(m)%2)throw new FishError('B+S与Q不一致 @ 测试根','readings');throw new FishError('Gate · trades · HTTP 500','failed');}};
    const scanner=new FishScanner((async()=>response({serverTime:cut})) as typeof fetch,undefined,undefined,{gate:adapter});
    const p=await scanner.scan({exchanges:['gate'],includeDuplicates:true,signal,onProgress:()=>{},onSignal:()=>{}});
    const gate=p.venues!.gate!;expect(gate.history).toBe(1);expect(gate.counts.gap).toBe(0);expect(gate.failures!.readings).toHaveLength(10);expect(gate.failures!.failed).toHaveLength(10);expect(gate.failures!.failed[0].reason).toContain('trades');expect(gate.failures!.readings[0].reason).toContain('B+S与Q');
  });
});
describe('只读代理行为',()=>{
  it('拒绝非法参数且不发请求；上游400/418/429保留状态、CORS和Retry-After',async()=>{
    const fetcher=vi.fn(async()=>response());
    for(const exchange of ['binance','evil']){expect((await handleFishProxy(new Request(`https://test/?exchange=${exchange}&path=contracts`),fetcher)).status).toBe(400);}expect(fetcher).not.toHaveBeenCalled();
    for(const status of [400,418,429]){const upstream=vi.fn(async()=>new Response('{"error":"上游错误"}',{status,headers:{'Retry-After':'90'}}));const r=await handleFishProxy(new Request('https://test/?exchange=gate&path=contracts',{headers:{Authorization:'private',Cookie:'private'}}),upstream);expect(r.status).toBe(status);expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');expect(r.headers.get('Retry-After')).toBe('90');expect(upstream).toHaveBeenCalledWith(expect.any(URL),expect.objectContaining({headers:{Accept:'application/json'},redirect:'error'}));}
  });
});
