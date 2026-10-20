import {it,expect,vi,beforeEach} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SignalTurnoverButton} from '@/components/SignalTurnover';
import {saveSignalTurnover,summarizeTurnover} from '@/lib/signalTurnover';
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

it('已有成交额直接展示评分关系；修改或撤销评分即时更新，不重新取数',()=>{
 saveSignalTurnover({version:1,fingerprint:fishSignalFingerprint(signals),createdAt:Date.now(),total:2,partial:0,complete:true,rows:signals.map((s,i)=>({...s,turnover:i*1000,hours:24})),stats:summarizeTurnover([0,1000])});
 const run=vi.fn();
 const view=render(<SignalTurnoverButton signals={signals.map(s=>({...s,quality:3}))} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'信号成交额'}));
 expect(screen.getByLabelText('评分与成交额')).toHaveTextContent('2 个已评分 · 0 个未评分');
 expect(screen.getByRole('img',{name:/散点图/}).querySelectorAll('circle')).toHaveLength(2);
 view.rerender(<SignalTurnoverButton signals={[{...signals[0],quality:5},signals[1]]} run={run}/>);
 expect(screen.getByLabelText('评分与成交额')).toHaveTextContent('1 个已评分 · 1 个未评分');
 expect(screen.getByRole('img',{name:/散点图/}).querySelector('circle')).toHaveAttribute('aria-label','AAAUSDT，5 分，0 USDT');
 expect(screen.queryByText(/信号库有改动/)).not.toBeInTheDocument();
 view.rerender(<SignalTurnoverButton signals={signals} run={run}/>);
 expect(screen.getByText(/暂无同时有评分和成交额/)).toBeInTheDocument();
 expect(run).not.toHaveBeenCalled();
});
