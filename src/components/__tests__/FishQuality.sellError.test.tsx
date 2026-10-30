import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FishQuality} from '@/components/FishQuality';
import {newQualityStudy,importQualityLibrary,qualityComparisonRows,qualityResultKey,type FishQualityStudy} from '@/lib/fish/quality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {POST_EXIT_HOURS,qualityPostExitKey} from '@/lib/fish/qualityPostExit';
import {buildQualitySheets} from '@/lib/fish/qualityExport';
import type {FishQualityState} from '@/hooks/useFishQuality';
const T=Date.UTC(2026,9,20),M=60000,NOW=T+9*3600000;
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);});
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();vi.useRealTimers();});
function fill(study:FishQualityStudy){
 study.sellPlans=study.sellPlans!.map(p=>({...p,rule:{metric:p.metric,direction:'<' as const,threshold:.5}}));
 study.results=qualityComparisonRows(study).flatMap((row,i)=>study.sellPlans!.map((p,j)=>{const end=T+(10+i+j)*M;return {key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:NOW,status:'closed' as const,entryTime:row.enteredAt!,entryPrice:100,endTime:end,endPrice:110,returnPct:10,pnl:10,exitReading:.4,...(i===3?{}:{exitSnapshot:{barOpenTime:end-M,observedAt:end,...(i===2?{cause:{id:'stop',kind:'static-drawdown' as const,label:'静态止损',direction:'>=' as const,threshold:5}}:{})}})};}));
 study.postExitReadings=qualityComparisonRows(study).flatMap((row,i)=>study.sellPlans!.map((p,j)=>{const r=study.results.find(r=>r.sampleId===row.id&&r.groupId===p.id)!;return {key:qualityPostExitKey(row.source,r,p)!,evaluatedAt:NOW,exitTime:r.endTime!,exitPrice:r.endPrice!,startMs:r.endTime!,excludedExitMinute:false,windows:POST_EXIT_HOURS.map((hours,k)=>({hours,status:'ready' as const,peakPct:i===0&&j===0?[4,2,3,0,6][k]:1,drawdown2Pct:i===0&&j===0?[1,1,1,0,2][k]:1}))};}));
 return study;
}
function state(){const study=fill(enableQualityComparison(importQualityLibrary(newQualityStudy(),[0,1,2,3].map(i=>({id:'e'+i,symbol:'SERR'+i+'USDT',timeMs:T+i*M,timeLabel:'',fallbackZone:''})))));return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:vi.fn(),restart:vi.fn(),cancel:vi.fn(),startFilter:vi.fn(),cancelFilter:vi.fn(),setRule:vi.fn(),setCombo:vi.fn(),setObserveHours:vi.fn(),selectSell:vi.fn(),setSelectedRows:vi.fn(),setPriority:vi.fn(),setScope:vi.fn(),setFilters:vi.fn(),setHoldingVetoes:vi.fn(),setSellPlans:vi.fn(),postExit:{owner:'test',running:false,progress:null,error:'',request:vi.fn(),cancel:vi.fn()}} satisfies FishQualityState;}
const row=(i:number)=>screen.getAllByTestId('quality-fish-row').find(r=>r.textContent!.includes('SERR'+i+'USDT'))!;
it('places five independently folded seller labels before counterfactuals and requests only evidenced algorithm exits',()=>{
 const s=state(),[a,b]=s.study.sellPlans!;const view=render(<FishQuality state={s}/>);
 expect(screen.getAllByTestId('quality-sell-error-folded')).toHaveLength(2);expect(screen.queryAllByTestId('quality-sell-error-header')).toHaveLength(0);
 const held=screen.getByRole('button',{name:'按'+a.label+'持仓时间排序'}).closest('th')!;expect(held.nextElementSibling).toHaveAttribute('data-testid','quality-sell-error-folded');expect(held.nextElementSibling!.nextElementSibling).toHaveAttribute('data-testid','quality-post-exit-folded');
 fireEvent.click(screen.getByRole('button',{name:'展开'+a.label+'卖出误报'}));expect(screen.getAllByTestId('quality-sell-error-header')).toHaveLength(5);expect(screen.getAllByTestId('quality-post-exit-folded')).toHaveLength(2);expect(screen.getByRole('button',{name:'展开'+b.label+'卖出误报'})).toHaveAttribute('aria-expanded','false');expect(screen.getByLabelText('卖出类别统计')).toHaveAttribute('colspan','24');
 expect(within(row(0)).getAllByTestId('quality-sell-error-item').map(x=>x.dataset.label)).toEqual(['false-exit','not-met','false-exit','not-met','false-exit']);expect(within(row(2)).getAllByTestId('quality-sell-error-item').every(x=>x.dataset.label==='other-exit')).toBe(true);expect(within(row(3)).getAllByTestId('quality-sell-error-item').every(x=>x.dataset.label==='unknown-cause')).toBe(true);
 const eligible=qualityComparisonRows(s.study).slice(0,2).map(r=>r.id);expect(s.postExit.request).toHaveBeenCalledWith([a.id],expect.arrayContaining(eligible),true);for(const c of s.postExit.request.mock.calls)expect(c[1]).toHaveLength(2);
 view.rerender(<FishQuality state={{...s,study:{...s.study,sellPlans:s.study.sellPlans!.map(p=>p.id===a.id?{...p,label:'改名方案'}:p)}}}/>);expect(screen.getByRole('button',{name:'收起改名方案卖出误报'})).toHaveAttribute('aria-expanded','true');
 fireEvent.click(screen.getByRole('button',{name:'收起改名方案卖出误报'}));expect(screen.queryAllByTestId('quality-sell-error-header')).toHaveLength(0);
});
it('sorts each horizon and exports the same five tags while folded, updating from cache without rerunning trades',()=>{
 const s=state(),a=s.study.sellPlans![0],rows=qualityComparisonRows(s.study),sheets=buildQualitySheets(s.study,rows),main=sheets[0],runs=sheets.find(s=>s.name==='运行结果')!;
 const cols=POST_EXIT_HOURS.map(h=>main.columns.findIndex(c=>c.header===a.label+' · 卖后'+h+'h 卖出误报'));expect(cols.map(c=>main.rows[0][c])).toEqual(['卖出误报','未达误报','卖出误报','未达误报','卖出误报']);expect(main.columns[cols[4]+1].header).toContain('卖后0.5h 峰值涨幅');expect(main.rows.every(r=>r.length===main.columns.length)).toBe(true);expect(runs.rows.every(r=>r.length===runs.columns.length)).toBe(true);expect(runs.rows).toHaveLength(8);
 const runCol=runs.columns.findIndex(c=>c.header==='卖后0.5h 卖出误报');expect(runs.rows.map(r=>r[runCol])).toContain('卖出误报');expect(runs.rows.map(r=>r[runCol])).toContain('非算法触发');
 const view=render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'展开'+a.label+'卖出误报'}));const sort=screen.getByRole('button',{name:'按'+a.label+'卖后0.5h卖出误报排序'});fireEvent.click(sort);expect(screen.getAllByTestId('quality-fish-row').slice(0,2).map(r=>r.textContent!.match(/SERR\dUSDT/)![0])).toEqual(['SERR0USDT','SERR1USDT']);fireEvent.click(sort);expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('SERR1USDT');
 const next={...s,study:{...s.study,postExitReadings:s.study.postExitReadings!.map(r=>({...r,windows:r.windows.map(w=>({...w,peakPct:1,drawdown2Pct:1}))}))}};view.rerender(<FishQuality state={next}/>);expect(within(row(0)).getAllByTestId('quality-sell-error-item').every(x=>x.dataset.label==='not-met')).toBe(true);expect(s.start).not.toHaveBeenCalled();expect(s.restart).not.toHaveBeenCalled();
});
it('distinguishes future windows and missing data from negative findings even if a ready cache exists',()=>{
 const s=state(),a=s.study.sellPlans![0];vi.setSystemTime(T+60*M);s.study.postExitReadings=s.study.postExitReadings!.map(r=>({...r,windows:r.windows.map(w=>w.hours===.5?{hours:w.hours,status:'error' as const,error:'缺根'}:w)}));render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'展开'+a.label+'卖出误报'}));const tags=within(row(0)).getAllByTestId('quality-sell-error-item');expect(tags[0]).toHaveTextContent('缺数据');expect(tags[1]).toHaveTextContent('待满1h');expect(tags[4]).toHaveTextContent('待满6h');
});
it('preserves individual entries when merged and does not duplicate one exit for detector rows',()=>{
 const s=state(),first=s.study.samples[0];s.study={...s.study,samples:[first,{...first,id:'again',enteredAt:first.enteredAt!+M}]};fill(s.study);const a=s.study.sellPlans![0];render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'展开'+a.label+'卖出误报'}));expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);const firstCell=screen.getAllByTestId('quality-sell-error-value')[0];expect(within(firstCell).getAllByTestId('quality-sell-error-item').map(x=>x.dataset.label).sort()).toEqual(['false-exit','not-met']);expect(firstCell).toHaveTextContent('买入');fireEvent.click(screen.getByRole('button',{name:'展开探测算法明细'}));expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(2);expect(screen.getAllByTestId('quality-sell-error-item')).toHaveLength(10);
});
