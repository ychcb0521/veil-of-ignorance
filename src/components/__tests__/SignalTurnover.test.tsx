import {it,expect,vi,beforeEach} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SignalTurnoverButton} from '@/components/SignalTurnover';
import {fishSignalFingerprint} from '@/lib/fish/suggestions';
import type {TradeSignal} from '@/lib/signalLibrary';
const signals:TradeSignal[]=[{id:'a',symbol:'AAAUSDT',timeMs:Date.UTC(2026,3,9),timeLabel:'',fallbackZone:''},{id:'b',symbol:'BBBUSDT',timeMs:Date.UTC(2026,3,10),timeLabel:'',fallbackZone:''}];
beforeEach(()=>localStorage.clear());
it('点开对话框开始统计：显示区间、分位与分布；信号库改动后提示过期',async()=>{
 const run=vi.fn(async(o:any)=>{o.onProgress({status:'running',done:1,total:2,current:'AAAUSDT'});return {version:1 as const,fingerprint:fishSignalFingerprint(signals),createdAt:Date.now(),total:2,partial:1,complete:true,rows:[{symbol:'AAAUSDT',timeMs:1,turnover:3e6,hours:24},{symbol:'BBBUSDT',timeMs:2,turnover:2.5e8,hours:5}],stats:{n:2,min:3e6,p10:2.77e7,p25:6.5e7,p50:1.265e8,p75:1.88e8,p90:2.25e8,max:2.5e8,mean:1.265e8}};});
 const view=render(<SignalTurnoverButton signals={signals} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'信号成交额'}));fireEvent.click(screen.getByRole('button',{name:'开始统计'}));
 await waitFor(()=>expect(screen.getByTestId('signal-turnover-result')).toBeInTheDocument());
 expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('300 万 ~ 2.5 亿');expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('1 个上市不足 24 小时');
 expect(screen.getByLabelText('成交额分布')).toHaveTextContent('100万–500万1');
 view.rerender(<SignalTurnoverButton signals={signals.slice(0,1)} run={run}/>);
 expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('信号库有改动');
});
