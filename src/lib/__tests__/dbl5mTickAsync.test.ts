import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {sample} from './fixtures/dblBars';
import {accountResearchIndicators,researchChartSeries} from '../researchIndicators';
import {clearAti6hMarketCache} from '../ati6hMarketData';
import {clearMarketDataCache} from '../deepRsa/marketData';
import {resetResearchHistory} from '../researchChartHistory';
beforeEach(()=>{localStorage.clear();clearAti6hMarketCache();clearMarketDataCache();resetResearchHistory();});afterEach(()=>vi.unstubAllGlobals());
it('cold chart metadata + hidden history requests converge to historical RAVE prices in all four panes',async()=>{
 const start=Date.UTC(2026,3,9),raw=sample().map((b,i)=>{const p=(n:number)=>((32040+n)/100000).toFixed(5);return [start+i*300000,p(b.open),p(b.high),p(b.low),p(b.close),'1000',start+(i+1)*300000-1,'100',5,'500','50',0];});
 const fetch=vi.fn(async(input:RequestInfo|URL)=>{const u=new URL(String(input));if(u.pathname.endsWith('/exchangeInfo'))return new Response(JSON.stringify({symbols:[{symbol:'RAVEUSDT',filters:[{filterType:'PRICE_FILTER',tickSize:'.0001'}]}]}));const a=Number(u.searchParams.get('startTime')),z=Number(u.searchParams.get('endTime'));return new Response(JSON.stringify(raw.filter(r=>Number(r[0])>=a&&Number(r[0])<=z)));});vi.stubGlobal('fetch',fetch);
 const data=raw.slice(8).map(r=>({timestamp:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:1000,researchSymbol:'RAVEUSDT',DBL5_initialization_start:start,DBL5_prices:{open:String(r[1]),high:String(r[2]),low:String(r[3]),close:String(r[4])}})),main=accountResearchIndicators().find(i=>i.id==='DBL5');
 expect(researchChartSeries(data,main,3).pending).toBe(true);await vi.waitFor(()=>expect(researchChartSeries(data,main,3).core).toEqual([.3214,.3214,.3214,.3214,.3214,.32142,.32142,.32142,.32142,null]));
 for(const id of ['DBL5_DISTANCE','DBL5_WIDTH','DBL5_AGE'])expect(researchChartSeries(data,accountResearchIndicators().find(i=>i.id===id),3).core.some(v=>v!==null)).toBe(true);
 expect(fetch.mock.calls.some(([u])=>String(u).includes('/exchangeInfo'))).toBe(true);expect(fetch.mock.calls.some(([u])=>String(u).includes('/klines'))).toBe(true);
});
