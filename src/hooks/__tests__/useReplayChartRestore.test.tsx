import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useReplayChartRestore } from '../useReplayChartRestore';
const bar = (time:number) => ({time,open:1,high:2,low:1,close:1,volume:1});
const options = () => ({ status:'paused' as 'stopped'|'paused'|'playing', clockReady:true, symbol:'ORDIUSDT',interval:'5m',reverse:false,getTime:vi.fn(()=>600000),dataRef:{current:[] as ReturnType<typeof bar>[]},contextRef:{current:{symbol:'',interval:''}},initLoad:vi.fn(async()=>[bar(300000),bar(600000)]),onRestored:vi.fn() });
it('loads the active isolated clock and current symbol/timeframe, not a global saved clock',async()=>{
 const p=options();renderHook(()=>useReplayChartRestore(p));expect(p.initLoad).toHaveBeenCalledWith('ORDIUSDT','5m',600000,{reverse:false});await waitFor(()=>expect(p.onRestored).toHaveBeenCalledOnce());
});
it('waits for late clock hydration and restores once without fetching again on playback updates',()=>{
 const p=options();p.clockReady=false;const h=renderHook((props)=>useReplayChartRestore(props),{initialProps:p});expect(p.initLoad).not.toHaveBeenCalled();h.rerender({...p,clockReady:true});expect(p.initLoad).toHaveBeenCalledOnce();h.rerender({...p,clockReady:true,status:'playing'});expect(p.initLoad).toHaveBeenCalledOnce();
});
it('restores a stopped-to-paused account hydration and preserves reverse direction',()=>{
 const p=options();p.status='stopped';p.reverse=true;const h=renderHook((props)=>useReplayChartRestore(props),{initialProps:p});expect(p.initLoad).not.toHaveBeenCalled();h.rerender({...p,status:'paused'});expect(p.initLoad).toHaveBeenCalledWith('ORDIUSDT','5m',600000,{reverse:true});
});
it('does not replace data already loaded by a manual start or signal jump',()=>{
 const p=options();p.dataRef.current=[bar(300000),bar(600000)];p.contextRef.current={symbol:p.symbol,interval:p.interval};renderHook(()=>useReplayChartRestore(p));expect(p.initLoad).not.toHaveBeenCalled();
});
it('replaces a future window even when its symbol and timeframe match',()=>{
 const p=options();p.dataRef.current=[bar(900000)];p.contextRef.current={symbol:p.symbol,interval:p.interval};renderHook(()=>useReplayChartRestore(p));expect(p.initLoad).toHaveBeenCalledWith(p.symbol,p.interval,600000,{reverse:false});
});
it('does not claim successful recovery for a failed or superseded request',async()=>{
 const p=options();p.initLoad.mockResolvedValue([]);renderHook(()=>useReplayChartRestore(p));await Promise.resolve();expect(p.onRestored).not.toHaveBeenCalled();
});
