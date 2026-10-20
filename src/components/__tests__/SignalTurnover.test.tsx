import {it,expect,vi,beforeEach} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SignalTurnoverButton} from '@/components/SignalTurnover';
import {saveSignalTurnover} from '@/lib/signalTurnover';
import {fishSignalFingerprint} from '@/lib/fish/suggestions';
import {TURNOVER_WINDOWS,summarizeTurnover,turnoverValues,type SignalTurnoverOptions,type SignalTurnoverResult,type TurnoverWindow} from '@/lib/signalTurnover';
import type {TradeSignal} from '@/lib/signalLibrary';
const signals:TradeSignal[]=[{id:'a',symbol:'AAAUSDT',timeMs:Date.UTC(2026,3,9),timeLabel:'',fallbackZone:''},{id:'b',symbol:'BBBUSDT',timeMs:Date.UTC(2026,3,10),timeLabel:'',fallbackZone:''}];
beforeEach(()=>localStorage.clear());
it('点开对话框开始统计：显示区间、分位与分布；信号库改动后提示过期',async()=>{
 const rows=[{symbol:'AAAUSDT',timeMs:1,hours:24,windows:{24:3e6,12:2e6,6:1e6,4:7e5,2:4e5,1:2e5}},{symbol:'BBBUSDT',timeMs:2,hours:5,windows:{24:2.5e8,12:2.5e8,6:2.5e8,4:1.2e8,2:6e7,1:3e7}}];
 const per=<T,>(f:(h:TurnoverWindow)=>T)=>Object.fromEntries(TURNOVER_WINDOWS.map(h=>[h,f(h)])) as Record<TurnoverWindow,T>;
 const result:SignalTurnoverResult={version:2,fingerprint:fishSignalFingerprint(signals),createdAt:Date.now(),total:2,complete:true,rows,stats:per(h=>summarizeTurnover(turnoverValues(rows,h))),partial:per(h=>rows.filter(r=>r.hours<h).length)};
 const run=vi.fn(async(o:SignalTurnoverOptions)=>{o.onProgress({status:'running',done:1,total:2,current:'AAAUSDT'});return result;});
 const view=render(<SignalTurnoverButton signals={signals} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'信号成交额'}));fireEvent.click(screen.getByRole('button',{name:'开始统计'}));
 await waitFor(()=>expect(screen.getByTestId('signal-turnover-result')).toBeInTheDocument());
 expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('300 万 ~ 2.5 亿');expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('1 个上市不足 24 小时');
 expect(screen.getByLabelText('成交额分布')).toHaveTextContent('100万–500万1');
 // 各时长对比表一眼看全；切到 1h，详情换成 1 小时的口径
 const table=screen.getByRole('table',{name:'各时长成交额对比'});expect(table).toHaveTextContent('24h300 万');expect(table).toHaveTextContent('1h20 万');
 fireEvent.click(screen.getByRole('tab',{name:'1h'}));
 expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('信号前 1 小时成交额');expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('20 万 ~ 3000 万');
 expect(screen.getByTestId('signal-turnover-result')).not.toHaveTextContent('上市不足 1 小时');
 fireEvent.click(screen.getByRole('tab',{name:'6h'}));expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('1 个上市不足 6 小时');
 view.rerender(<SignalTurnoverButton signals={signals.slice(0,1)} run={run}/>);
 expect(screen.getByTestId('signal-turnover-result')).toHaveTextContent('信号库有改动');
});

it('已有成交额直接展示评分关系；修改或撤销评分即时更新，不重新取数',()=>{
 const rows=signals.map((s,i)=>({...s,windows:{24:i*1000,12:i*500,6:i*250,4:i*100,2:i*50,1:i*20},hours:24}));
 saveSignalTurnover({version:2,fingerprint:fishSignalFingerprint(signals),createdAt:Date.now(),total:2,complete:true,rows,stats:Object.fromEntries(TURNOVER_WINDOWS.map(h=>[h,summarizeTurnover(turnoverValues(rows,h))])) as any,partial:{24:0,12:0,6:0,4:0,2:0,1:0}});
 const run=vi.fn();
 const view=render(<SignalTurnoverButton signals={signals.map(s=>({...s,quality:3}))} run={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'信号成交额'}));
 expect(screen.getByLabelText('评分与成交额')).toHaveTextContent('2 个已评分 · 0 个未评分');
 expect(screen.getByRole('img',{name:/散点图/}).querySelectorAll('circle')).toHaveLength(2);
 view.rerender(<SignalTurnoverButton signals={[{...signals[0],quality:5},signals[1]]} run={run}/>);
 expect(screen.getByLabelText('评分与成交额')).toHaveTextContent('1 个已评分 · 1 个未评分');
 expect(screen.getByRole('img',{name:/散点图/}).querySelector('circle')).toHaveAttribute('aria-label','AAAUSDT，5 分，0 USDT');
 expect(screen.queryByText(/信号库有改动/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('tab',{name:'1h'}));expect(screen.getByRole('img',{name:/前1小时成交额散点图/})).toBeInTheDocument();fireEvent.click(screen.getByRole('tab',{name:'24h'}));
 view.rerender(<SignalTurnoverButton signals={signals} run={run}/>);
 expect(screen.getByText(/暂无同时有评分和成交额/)).toBeInTheDocument();
 expect(run).not.toHaveBeenCalled();
});
