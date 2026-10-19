import {describe,it,expect,vi} from 'vitest';
import {binanceStockMarket,bitgetStockMarket} from '@/lib/fish/stockMetadata';
import {FishAdapter,fishTransport,type FishDataAdapter} from '@/lib/fish/adapters';
import {FishScanner} from '@/lib/fishScanner';
import {FishWeightBudget,FISH_STEP} from '@/lib/fish/shared';
import {selectFishMarkets,type FishMarket} from '@/lib/fish/exchanges';
import {mergeFishSignals} from '@/lib/fish/records';
import {parseSignalText,serializeSignals,mergeSignals,signalDedupKey,signalChartSymbol,type TradeSignal} from '@/lib/signalLibrary';
import {signalSample,compileGroups,previewGroups,sampleEventRows,classifySample,CBI2_DEF} from '@/lib/deepDig/features';
import {runInference} from '@/lib/deepDig/commands';
import {collectDeepDigRun} from '@/lib/deepDig/analysis';
import {buildCampaignGroupReport} from '@/lib/deepRsa/report';
import {preflightSignalJumpIssues} from '@/lib/signalJumpDiagnostics';
import {publicMarketUrl} from '../../../supabase/functions/fish-market-proxy/handler';
const signal=new AbortController().signal,cut=Date.UTC(2026,9,19,3);
const coin:TradeSignal={id:'coin',symbol:'COINUSDT',timeMs:Date.UTC(2026,9,19,2),timeLabel:'2026-10-19 10:00:00',fallbackZone:'1.2 ~ 3.4',quality:4};
const stock:TradeSignal={...coin,id:'stock',market:'us_stock',underlying:'COIN',exchange:'binance'};
const market=(us=false):FishMarket=>({symbol:'COINUSDT',instrument:us?'STOCKUSDT':'COINUSDT',base:'COIN',multiplier:1,...(us?{market:'us_stock' as const,underlying:'COIN'}:{})});
describe('美股元数据与身份',()=>{
 it('只看资产分类与地区字段：股票名字的加密币仍是币，币名字的美股仍是美股；RWA和海外股票不冒充美股',()=>{
  expect(binanceStockMarket({symbol:'AAPLUSDT',contractType:'PERPETUAL',underlyingType:'COIN'})).toBe('crypto');
  expect(binanceStockMarket({symbol:'BTCUSDT',contractType:'TRADIFI_PERPETUAL',underlyingType:'EQUITY'})).toBe('us_stock');
  for(const underlyingType of ['HK_EQUITY','CN_EQUITY','KR_EQUITY','PREMARKET','COMMODITY'])expect(binanceStockMarket({contractType:'TRADIFI_PERPETUAL',underlyingType})).toBeNull();
  expect(bitgetStockMarket({symbol:'AAPLUSDT',isRwa:'YES'},{instrumentType:'crypto',marketRegion:''})).toBe('crypto');
  expect(bitgetStockMarket({symbol:'BTCUSDT'},{instrumentType:'stock',marketRegion:'US',symbolType:'crypto'})).toBe('us_stock');
  expect(bitgetStockMarket({isRwa:'YES'})).toBeNull();expect(bitgetStockMarket({},{instrumentType:'stock',marketRegion:'HK'})).toBeNull();
 });
 it('适配器从真实分类字段取 underlying；OKX/Gate 未确认美股地区的股票不混入加密币',async()=>{
  const adapter=new FishAdapter('bitget',async path=>path.startsWith('instruments?')?{code:'00000',data:[{symbol:'BTCUSDT',instrumentType:'stock',marketRegion:'US',baseCoin:'AAPL'}]}:{code:'00000',data:[{symbol:'BTCUSDT',baseCoin:'AAPL',quoteCoin:'USDT',symbolStatus:'normal',symbolType:'perpetual',isRwa:'YES'}]});
  expect(await adapter.list(signal)).toEqual([{symbol:'BTCUSDT',instrument:'BTCUSDT',base:'AAPL',multiplier:1,market:'us_stock',underlying:'AAPL'}]);
  const gate=new FishAdapter('gate',async()=>[{name:'COIN_USDT',contract_type:'stocks',type:'direct',status:'trading',in_delisting:false,quanto_multiplier:'1'}]);expect(await gate.list(signal)).toEqual([]);
  const okx=new FishAdapter('okx',async()=>({code:'0',data:[{instId:'COIN-USDT-SWAP',instCategory:'3',settleCcy:'USDT',ctType:'linear',state:'live',ctValCcy:'COIN',ctVal:'1'}]}));expect(await okx.list(signal)).toEqual([]);
 });
 it('同名股票与币及不同交易所各自保留；原币安键不变；鱼也不互相覆盖',()=>{
  const second={...stock,id:'bitget',exchange:'bitget' as const};
  expect(signalDedupKey(coin)).toBe(`COINUSDT@${coin.timeMs}`);expect(signalDedupKey(stock)).toBe(`us:binance:COIN@${coin.timeMs}`);
  expect(mergeSignals([coin],[stock,second,{...coin,id:'duplicate'}])).toHaveLength(3);
  const fish=mergeFishSignals([coin],[stock,second]);expect(fish).toHaveLength(3);expect(new Set(fish.map(s=>s.id)).size).toBe(3);expect(mergeFishSignals(fish,[stock,second])).toHaveLength(3);
  expect(signalChartSymbol({...stock,binanceSymbol:'COINUSDT'})).toBeNull();
 });
 it('美股仅在美股内部按标的代码排重，开含重复币可分别扫；不剥离股票数字前缀',()=>{
  const us=market(true),crypto=market();expect(selectFishMarkets('bitget',{binance:[crypto],bitget:[us]},false)).toEqual([us]);
  expect(selectFishMarkets('bitget',{binance:[us],bitget:[crypto,{...us,instrument:'other'}]},false)).toEqual([crypto]);
  expect(selectFishMarkets('bitget',{binance:[us],bitget:[us]},true)).toEqual([us]);
 });
 it('导出导入互逆：保留市场、交易所、真实代码及兜底区；手工行内和区块标记都支持',()=>{
  const different={...stock,id:'alias',symbol:'COINSTOCKUSDT',underlying:'COIN',exchange:'bitget' as const};
  const text=serializeSignals([coin,different]);expect(text.split('\n').some(line=>line.endsWith('[美股]'))).toBe(true);const parsed=parseSignalText(text);expect(parsed.errors).toEqual([]);expect(parsed.signals).toHaveLength(2);
  expect(parsed.signals.find(s=>s.market==='us_stock')).toMatchObject({symbol:different.symbol,underlying:'COIN',exchange:'bitget',fallbackZone:stock.fallbackZone,timeMs:stock.timeMs});
  const manual=parseSignalText('COIN, 2026-10-19 10:00:00, 1.2 ~ 3.4 [美股]\nCOIN, 2026-10-19 10:00:00, 1.2 ~ 3.4');expect(manual.signals).toHaveLength(2);expect(manual.signals[0]).toMatchObject({market:'us_stock',underlying:'COIN',fallbackZone:'1.2 ~ 3.4'});expect(manual.signals[1].market).toBeUndefined();
 });
});
describe('美股取数边界和安全',()=>{
 it('Bitget v3元数据使用固定新路径；代理拒绝现货、错误地区/写接口和额外参数',async()=>{
  const fetcher=vi.fn(async(_url:RequestInfo|URL)=>new Response(JSON.stringify({code:'00000',data:[]}))),request=fishTransport('bitget',fetcher as typeof fetch,new FishWeightBudget());await request('instruments?category=USDT-FUTURES',1,signal);
  expect(String(fetcher.mock.calls[0][0])).toBe('https://api.bitget.com/api/v3/market/instruments?category=USDT-FUTURES');expect(publicMarketUrl('bitget','instruments?category=USDT-FUTURES').pathname).toBe('/api/v3/market/instruments');
  for(const path of ['instruments?category=SPOT','instruments?category=USDT-FUTURES&marketRegion=US','instruments?category=USDT-FUTURES&category=USDT-FUTURES','orders?category=USDT-FUTURES'])expect(()=>publicMarketUrl('bitget',path)).toThrow();
 });
 it('Deep dig归其他并计数说明，不生成行情事件；仅美股样本完全不请求同名币',async()=>{
  const rows=[signalSample(stock),signalSample(coin)],groups=compileGroups('s > 3','s < 2','signals');expect(rows[0]).toMatchObject({excluded:true,unsupportedReason:'美股：暂不支持取行情'});expect(classifySample(rows[0],groups)).toEqual({group:'other',reason:'us_stock'});expect(previewGroups(rows,groups)).toMatchObject({positive:1,other:1});expect(sampleEventRows(rows,groups).map(r=>r.id)).toEqual(['coin']);
  const fetchFn=vi.fn();const out=await collectDeepDigRun(buildCampaignGroupReport([],true),{...CBI2_DEF,source:'signals',positive:'s > 3',control:'s < 2'},{signals:[stock],fetchFn});expect(fetchFn).not.toHaveBeenCalled();expect(out.data.coverage.unsupportedStocks).toBe(1);expect(out.data.rows[0]).toMatchObject({id:'stock',group:'other',v:null,reason:'美股：暂不支持取行情'});const inference=runInference({...out.data,rows:out.data.rows.map(r=>({...r,v:99}))},'ttest(X, 其他, 对照组)');expect(inference.blocks[0]).toMatchObject({kind:'ttest',result:{nA:0,nB:0}});
 });
 it('跳转预检直接排除美股；不请求exchangeInfo和同名币K线',async()=>{
  const fetchImpl=vi.fn();const result=await preflightSignalJumpIssues([{...stock}], '5m',FISH_STEP,{fetchImpl});expect(result.totalSymbols).toBe(0);expect(fetchImpl).not.toHaveBeenCalled();
 });
 function setup(gap=false){const crypto=market(),us=market(true),btc={...crypto,symbol:'BTCUSDT',instrument:'BTCUSDT',base:'BTC'};const candles=vi.fn(async(m,end,_sig,q)=>Array.from({length:q.count},(_,i)=>({openTime:end-(q.count-i)*FISH_STEP,open:99,close:i<q.count-5?99:101,high:102,low:98,volume:10,quoteVolume:1000,takerBuyQuoteVolume:500,takerBuyVolume:5})).filter((_,i)=>!gap||m.market!=='us_stock'||i!==q.count-10));const adapter:FishDataAdapter={exchange:'binance',list:async()=>[crypto,us],btc:()=>btc,candles,taker:async(_m,b)=>b};return {candles,scanner:new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+FISH_STEP}))) as typeof fetch,undefined,undefined,{binance:adapter})};}
 const settings={feature:{...CBI2_DEF,id:'close',formula:'C'},algorithm:{H:1/12,direction:'>' as const,threshold:100,constraints:[]},signal,onProgress:()=>{}};
 it('复用同一算法，币与股票分开统计；默认扫美股，关闭后不取美股',async()=>{
  const f=setup(),found:TradeSignal[]=[];const run=await f.scanner.scan({...settings,onSignal:s=>found.push(s)});expect(run.counts.hit).toBe(2);expect(run.venues!.binance!.markets!.crypto!.counts.hit).toBe(1);expect(run.venues!.binance!.markets!.us_stock!.counts.hit).toBe(1);expect(found.find(s=>s.market)).toMatchObject({market:'us_stock',underlying:'COIN',exchange:'binance',binanceSymbol:null});expect(mergeFishSignals([],found)).toHaveLength(2);
  f.candles.mockClear();const second=await f.scanner.scan({...settings,includeUsStocks:false,onSignal:()=>{}});expect(second.counts.hit).toBe(1);expect(f.candles.mock.calls.some(c=>c[0].market==='us_stock')).toBe(false);
 });
 it('美股停盘导致中间缺根计缺口，整币跳过，不补数；同轮加密币照常',async()=>{
  const f=setup(true),found:TradeSignal[]=[];const run=await f.scanner.scan({...settings,onSignal:s=>found.push(s)});expect(run.counts.gap).toBe(1);expect(run.venues!.binance!.markets!.us_stock!.counts.gap).toBe(1);expect(found).toHaveLength(1);expect(found[0].market).toBeUndefined();
 });
});
