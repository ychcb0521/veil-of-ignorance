/** Reproducible local replay. No credentials, account writes or network requests. */
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',resolve:{alias:{'@':resolve('src')}}});
try{
 const {computeDbl5,Dbl5Engine}=await server.ssrLoadModule('/src/lib/dbl5m.ts');
 const {sample,T}=await server.ssrLoadModule('/src/lib/__tests__/fixtures/dblBars.ts');
 const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('DBL-5 replay mismatch');};
 const verify=(bars,options)=>{const batch=computeDbl5(bars,options),engine=new Dbl5Engine(options),cut=Math.floor(bars.length/2);equal(batch.rows,bars.map(b=>engine.push(b)));const first=computeDbl5(bars.slice(0,cut),options),rest=computeDbl5(bars.slice(cut),{...options,checkpoint:JSON.parse(JSON.stringify(first.checkpoint))});equal(rest.rows,batch.rows.slice(cut));equal(computeDbl5(bars.slice(0,cut),options).rows,batch.rows.slice(0,cut));return batch;};
 const out=verify(sample(),{symbol:'DBL-SYNTHETIC',initializationStart:T,initializationId:`start:${T}:v1`});
 equal(out.rows.map(r=>r.darvas_5m_lower),[...Array(7).fill(null),...Array(6).fill(100),...Array(4).fill(102),null]);
 console.log(JSON.stringify({case:'18-bar specification',version:out.checkpoint.algorithm_version,checks:['expected prices','batch = streaming','JSON checkpoint restore','future prefix immutable'],events:out.rows.filter(r=>r.darvas_5m_event!=='NONE').map(r=>({bar:(r.at-T)/300000,event:r.darvas_5m_event,lower:r.darvas_5m_lower,upper:r.darvas_5m_upper}))},null,2));
 const arg=process.argv.indexOf('--history');if(arg>=0){
  const raw=JSON.parse(readFileSync(process.argv[arg+1],'utf8')),tickArg=process.argv.indexOf('--tick'),symbolArg=process.argv.indexOf('--symbol');
  if(tickArg<0||symbolArg<0)throw Error('--history requires actual exchange --tick and --symbol');
  const tick=process.argv[tickArg+1],symbol=process.argv[symbolArg+1],hash=createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  const bars=raw.map(r=>({openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),quoteVolume:null,takerBuyVolume:null,takerBuyQuoteVolume:null,DBL5_closed:true,DBL5_tick_size:tick,DBL5_prices:{open:String(r[1]),high:String(r[2]),low:String(r[3]),close:String(r[4])}}));
  const checked=verify(bars,{symbol,tickSize:tick,dataSource:'binance-usdm',dataVersion:hash,initializationStart:bars[0].openTime,initializationId:'historical-file:'+hash}),events=checked.events;
  console.log(JSON.stringify({case:'historical public OHLC',symbol,bars:bars.length,first_open:bars[0].openTime,last_close:bars.at(-1).openTime+300000,tick,source_sha256:hash,version:checked.checkpoint.algorithm_version,available:checked.rows.filter(r=>r.darvas_5m_available).length,missing:checked.rows.filter(r=>!r.darvas_5m_available).length,event_counts:Object.fromEntries([...new Set(events.map(e=>e.type))].map(t=>[t,events.filter(e=>e.type===t).length])),checks:['batch = streaming','checkpoint restore','prefix immutability'],limitation:'Structural replay only; no return, support-success or fitted-parameter claim.'},null,2));
 }
}finally{await server.close();}
