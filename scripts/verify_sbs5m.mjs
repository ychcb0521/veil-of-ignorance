/** Local-only deterministic replay. Never reads credentials or writes a database. */
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',resolve:{alias:{'@':resolve('src')}}});
try{
 const {computeSbs5m,Sbs5mEngine}=await server.ssrLoadModule('/src/lib/sbs5m.ts');
 const {evaluateSbs5m}=await server.ssrLoadModule('/src/lib/sbs5mEvaluation.ts');
 const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('SBS-5M replay mismatch');};
 const cases=JSON.parse(readFileSync('docs/examples/sbs-5m-cases.json','utf8'));
 for(const [name,{options,bars,expected}] of Object.entries(cases)){
  const batch=computeSbs5m(bars,options),engine=new Sbs5mEngine(options),cut=Math.floor(bars.length/2);
  equal(batch.rows,bars.map(b=>engine.push(b)));const a=computeSbs5m(bars.slice(0,cut),options),b=computeSbs5m(bars.slice(cut),{...options,checkpoint:a.checkpoint});equal(b.rows,batch.rows.slice(cut));
  equal(batch.rows.map(r=>({at:r.at,support_price:r.support_price,support_status:r.support_status,events:r.events.map(e=>e.type)})),expected);
  console.log(name+': batch / stream / checkpoint / expected states OK');
 }
 const arg=process.argv.indexOf('--history');
 if(arg>=0){
  const raw=JSON.parse(readFileSync(process.argv[arg+1],'utf8')),tickArg=process.argv.indexOf('--tick'),symbolArg=process.argv.indexOf('--symbol'),tick=Number(process.argv[tickArg+1]);
  if(tickArg<0||!Number.isFinite(tick)||tick<=0||symbolArg<0)throw Error('--history requires actual exchange --tick and --symbol');
  const symbol=process.argv[symbolArg+1],version=createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  const bars=raw.map(r=>({openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),quoteVolume:Number(r[7]),takerBuyVolume:Number(r[9]),takerBuyQuoteVolume:Number(r[10]),SBS5M_tick_size:tick,SBS5M_closed:true}));
  const out=computeSbs5m(bars,{symbol,dataSource:'binance-usdm',dataVersion:version,initializationId:'historical-file:'+version});
  console.log(JSON.stringify({symbol,bars:bars.length,data_version:version,evaluation:evaluateSbs5m(out.rows,bars)},null,2));
 }
}finally{await server.close();}
