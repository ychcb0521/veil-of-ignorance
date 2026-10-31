import{expect,it,vi}from'vitest';import{compileFeatureFormula,evaluateOnBars}from'../deepDig/features';
it('worker results match full calculations across partial updates and new candles without detaching its cache',async()=>{
 const messages:any[]=[];const target={postMessage:(m:any)=>messages.push(m),onmessage:undefined as any};vi.stubGlobal('self',target);await import('../chartCompute.worker');
 const compiled=compileFeatureFormula('X=ema(C,6)\na=avg(X,24)\nb=median(C,6)'),params={interval:'5m' as const};let closes=[1,2,3];
 for(let k=0;k<3;k++){
  if(k===1)closes[2]=3.5;if(k===2)closes.push(4);const bars=closes.map((close,i)=>({openTime:i*300000,open:close,high:close+1,low:close-1,close,volume:10,quoteVolume:100,takerBuyQuoteVolume:50,takerBuyVolume:null,refClose:100}));
  const from=k?2:0;const packet=new Float64Array((bars.length-from)*10);for(let i=from;i<bars.length;i++){const b=bars[i];packet.set([b.openTime,b.open,b.high,b.low,b.close,b.volume,b.quoteVolume,b.takerBuyQuoteVolume,b.refClose,0],(i-from)*10)}
  target.onmessage({data:{id:1,length:bars.length,from,packet:packet.buffer,compiled:k?undefined:compiled,params,variables:['X','a','b']}});
  const expected=evaluateOnBars(bars,compiled,params),actual=messages.at(-1);expect(actual.error).toBeUndefined();for(const name of ['X','a','b'])expect(actual.vars[name]).toEqual(expected.vars.get(name));
 }
 vi.unstubAllGlobals();
});
it('bounds heavy formula state while leaving completed output intact',async()=>{
 vi.resetModules();const messages:any[]=[],target={postMessage:(m:any)=>messages.push(m),onmessage:undefined as any};vi.stubGlobal('self',target);await import('../chartCompute.worker');
 const compiled=compileFeatureFormula('X=C'),packet=()=>{const p=new Float64Array(10);p.set([0,1,2,1,1,10,100,50,100,0]);return p.buffer;};
 for(let id=1;id<=9;id++)target.onmessage({data:{id,length:1,from:0,packet:packet(),compiled,params:{interval:'5m'},variables:['X']}});
 expect(messages.at(-1).evicted).toEqual([1]);expect(messages[0].vars.X[0]).toBe(1);target.onmessage({data:{id:1,length:1,from:0,packet:packet(),compiled,params:{interval:'5m'},variables:['X']}});expect(messages.at(-1).error).toBeUndefined();expect(messages.at(-1).vars.X[0]).toBe(1);vi.unstubAllGlobals();
});

it('PRS worker uses the shared causal engine, restores its seed and ignores a forming candle',async()=>{
 vi.resetModules();const messages:any[]=[],target={postMessage:(m:any)=>messages.push(m),onmessage:undefined as any};vi.stubGlobal('self',target);await import('../chartCompute.worker');
 const {prsPositive}=await import('../deepDig/__tests__/fixtures/prsBars'),{PRS6H_DEF}=await import('../deepDig/features'),{computePrs6h}=await import('../prs6h'),{bars}=prsPositive(),split=bars.length-3;
 const seed=computePrs6h(bars.slice(0,split),{symbol:'TESTUSDT'}).checkpoint,tail=bars.slice(split),packet=new Float64Array(tail.length*10);
 tail.forEach((b,i)=>packet.set([b.openTime,b.open,b.high,b.low,b.close,b.volume,b.quoteVolume!,b.takerBuyQuoteVolume!,NaN,i===tail.length-1?0:1],i*10));
 const compiled=compileFeatureFormula(PRS6H_DEF.formula),params={...PRS6H_DEF,PRS6H_symbol:'TESTUSDT',PRS6H_tick_size:.01,PRS6H_checkpoint:seed};
 target.onmessage({data:{id:900,length:tail.length,from:0,packet:packet.buffer,compiled,params,variables:['PRS6H','PRS6H_S']}});
 const actual=messages.at(-1),expected=evaluateOnBars(tail.map((b,i)=>({...b,PRS6H_closed:i!==tail.length-1})),compiled,params);
 expect(actual.error).toBeUndefined();expect(actual.vars.PRS6H).toEqual(expected.vars.get('PRS6H'));expect(actual.PRS6H_checkpoint.last_time).toBe(expected.PRS6H_checkpoint!.last_time);vi.unstubAllGlobals();
});
