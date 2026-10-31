import {afterEach,expect,it,vi} from 'vitest';
import {DBL5_DEF,compileFeatureFormula,evaluateOnBars} from '../deepDig/features';
import {T,sample} from './fixtures/dblBars';
afterEach(()=>vi.unstubAllGlobals());
it('native worker preserves raw decimal ticks beyond the Float64 candle packet and closed-bar masks',async()=>{
 vi.resetModules();const messages:any[]=[],target={postMessage:(m:any)=>messages.push(m),onmessage:undefined as any};vi.stubGlobal('self',target);await import('../chartCompute.worker');
 const pairs=[['01','00'],['03','00'],['02','02'],['03','03']],bars=pairs.map(([h,l],i)=>({...sample()[i],DBL5_tick_size:'.01',DBL5_prices:{open:'123456789012345678.'+h,high:'123456789012345678.'+h,low:'123456789012345678.'+l,close:'123456789012345678.'+h}}));
 const packet=new Float64Array(bars.length*10);bars.forEach((b,i)=>packet.set([b.openTime,Number(b.DBL5_prices.open),Number(b.DBL5_prices.high),Number(b.DBL5_prices.low),Number(b.DBL5_prices.close),0,NaN,NaN,NaN,1],i*10));
 const params={...DBL5_DEF,DBL5_symbol:'EXACT',DBL5_tick_size:'.01',DBL5_config:{n:1},DBL5_initialization_start:T},compiled=compileFeatureFormula(DBL5_DEF.formula);
 target.onmessage({data:{id:2001,length:bars.length,from:0,packet:packet.buffer,rawDblPrices:bars.map(b=>b.DBL5_prices),compiled,params,variables:['DBL5','DBL5_upper','DBL5_available']}});
 const actual=messages.at(-1),expected=evaluateOnBars(bars.map(b=>({...b,DBL5_tick_size:'.01'})),compiled,params);expect(actual.error).toBeUndefined();expect(actual.vars.DBL5_available.at(-1)).toBe(1);expect(actual.DBL5_checkpoint.active.lower_ticks).toBe('12345678901234567802');expect(actual.DBL5_checkpoint.active.upper_ticks).toBe('12345678901234567803');expect(actual.vars.DBL5).toEqual(expected.vars.get('DBL5'));expect(JSON.stringify(actual.DBL5_checkpoint)).toContain('dbl-5-v2');
});
