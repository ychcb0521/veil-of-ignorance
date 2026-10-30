import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishQuality} from '@/components/FishQuality';
import {newQualityStudy,importQualityLibrary,qualityComparisonRows,qualityResultKey,type QualityResult} from '@/lib/fish/quality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {POST_EXIT_HOURS,qualityPostExitKey,type QualityPostExitReading} from '@/lib/fish/qualityPostExit';
import {buildQualitySheets} from '@/lib/fish/qualityExport';
import type {FishQualityState} from '@/hooks/useFishQuality';
const T=Date.UTC(2026,9,20),M=60000;
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();vi.useRealTimers();});
function state(){
 let study=enableQualityComparison(importQualityLibrary(newQualityStudy(),[0,1].map(i=>({id:'s'+i,symbol:'TEST'+i+'USDT',timeMs:T+i*M,timeLabel:'',fallbackZone:''}))));
 const rows=qualityComparisonRows(study);
 study.results=rows.flatMap((row,i)=>study.sellPlans!.map(plan=>({key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T+6*3600000,status:'closed' as const,entryTime:T+i*M,entryPrice:100,endTime:T+(i+10)*M,endPrice:110+i,returnPct:10+i,heldHours:1})));
 study.postExitReadings=rows.flatMap((row,i)=>study.sellPlans!.map(plan=>{const result=study.results.find(r=>r.sampleId===row.id&&r.groupId===plan.id)!;return {key:qualityPostExitKey(row.source,result,plan)!,evaluatedAt:T+7*3600000,exitTime:result.endTime!,exitPrice:result.endPrice!,startMs:result.endTime!,excludedExitMinute:false,windows:POST_EXIT_HOURS.map(hours=>({hours,status:'ready' as const,peakPct:hours+i+1,drawdown2Pct:hours/10+i}))} satisfies QualityPostExitReading;}));
 return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:vi.fn(),restart:vi.fn(),cancel:vi.fn(),startFilter:vi.fn(),cancelFilter:vi.fn(),setRule:vi.fn(),setCombo:vi.fn(),setObserveHours:vi.fn(),selectSell:vi.fn(),setSelectedRows:vi.fn(),setPriority:vi.fn(),setScope:vi.fn(),setFilters:vi.fn(),setHoldingVetoes:vi.fn(),setSellPlans:vi.fn(),postExit:{owner:'test',running:false,progress:null,error:'',request:vi.fn(),cancel:vi.fn()}} satisfies FishQualityState;
}
it('adds exactly ten columns per expanded sub-algorithm, aligns all header/body spans and keeps toggles independent',()=>{
 const s=state(),[a,b]=s.study.sellPlans!;render(<FishQuality state={s}/>);
 expect(screen.queryAllByTestId('quality-post-exit-header')).toHaveLength(0);expect(screen.getAllByTestId('quality-post-exit-folded')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'展开'+a.label+'卖后反事实'}));
 expect(screen.getAllByTestId('quality-post-exit-header')).toHaveLength(10);expect(screen.getAllByTestId('quality-post-exit-value')).toHaveLength(20);
 expect(screen.getByLabelText('卖出类别统计')).toHaveAttribute('colspan','19');
 expect(screen.getByRole('button',{name:'展开'+b.label+'卖后反事实'})).toHaveAttribute('aria-expanded','false');
 for(const row of screen.getAllByTestId('quality-fish-row'))expect(within(row).getAllByRole('cell')).toHaveLength(28);
 expect(s.postExit.request).toHaveBeenCalledWith([a.id],expect.any(Array),true);
 fireEvent.click(screen.getByRole('button',{name:'展开'+b.label+'卖后反事实'}));expect(screen.getAllByTestId('quality-post-exit-header')).toHaveLength(20);
 fireEvent.click(screen.getByRole('button',{name:'收起'+a.label+'卖后反事实'}));expect(screen.getAllByTestId('quality-post-exit-header')).toHaveLength(10);
 expect(screen.getAllByTestId('quality-post-exit-header').every(x=>x.dataset.sellPlan===b.id)).toBe(true);
});
it('sorts new numeric columns in both directions and exports all ten measurements even while folded',()=>{
 const s=state(),plan=s.study.sellPlans![0];render(<FishQuality state={s}/>);
 const sheets=buildQualitySheets(s.study,qualityComparisonRows(s.study)),main=sheets[0];
 for(const h of POST_EXIT_HOURS)for(const metric of ['峰值涨幅','静态最大回撤2'])expect(main.columns.some(c=>c.header.includes(plan.label+' · 卖后'+h+'h '+metric))).toBe(true);
 expect(main.rows.every(row=>row.length===main.columns.length)).toBe(true);
 const index=main.columns.findIndex(c=>c.header.includes(plan.label+' · 卖后0.5h 峰值涨幅'));expect(main.rows.map(row=>row[index])).toEqual([1.5,2.5]);
 fireEvent.click(screen.getByRole('button',{name:'展开'+plan.label+'卖后反事实'}));
 const order=()=>screen.getAllByTestId('quality-fish-row').map(row=>within(row).getAllByTestId('quality-post-exit-value')[0].textContent);
 const sort=screen.getByRole('button',{name:'按'+plan.label+'卖后0.5h 峰值涨幅排序'});
 fireEvent.click(sort);expect(order()).toEqual(['+2.50%','+1.50%']);fireEvent.click(sort);expect(order()).toEqual(['+1.50%','+2.50%']);
});
it('distinguishes immature/missing observations and real zero while retaining the original sell result',()=>{
 const s=state(),plan=s.study.sellPlans![0];vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(T+45*M);
 const before=JSON.stringify(s.study.results);s.study.postExitReadings=s.study.postExitReadings!.map(r=>({...r,windows:POST_EXIT_HOURS.map(hours=>hours===.5?{hours,status:'ready' as const,peakPct:0,drawdown2Pct:0}:{hours,status:'waiting' as const})}));
 render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'展开'+plan.label+'卖后反事实'}));
 const cells=within(screen.getAllByTestId('quality-fish-row')[0]).getAllByTestId('quality-post-exit-value');expect(cells[0]).toHaveTextContent('0.00%');expect(cells[2]).toHaveTextContent('待满1h');expect(cells[8]).toHaveTextContent('待满6h');expect(JSON.stringify(s.study.results)).toBe(before);
});

it('keeps merged-entry ranges and expanded detector rows aligned with each actual exit',()=>{
 const s=state(),first=s.study.samples[0],second={...first,id:'later',enteredAt:first.enteredAt!+60000};s.study.samples=[first,second];
 const rows=qualityComparisonRows(s.study),plan=s.study.sellPlans![0];
 s.study.results=rows.flatMap((row,i)=>s.study.sellPlans!.map(p=>({key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:T+36000000,status:'closed' as const,entryTime:row.enteredAt!,entryPrice:100,endTime:T+(i+10)*M,endPrice:110+i,returnPct:10+i})));
 s.study.postExitReadings=rows.map((row,i)=>{const result=s.study.results.find(v=>v.sampleId===row.id&&v.groupId===plan.id)!;return {key:qualityPostExitKey(row.source,result,plan)!,evaluatedAt:T+36000000,exitTime:result.endTime!,exitPrice:result.endPrice!,startMs:result.endTime!,excludedExitMinute:false,windows:POST_EXIT_HOURS.map(hours=>({hours,status:'ready' as const,peakPct:i?9:3,drawdown2Pct:i?4:1}))};});
 render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'展开'+plan.label+'卖后反事实'}));
 expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);expect(screen.getAllByTestId('quality-post-exit-value')[0]).toHaveTextContent('+3.00%～+9.00%');
 fireEvent.click(screen.getByRole('button',{name:'展开探测算法明细'}));expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(2);expect(screen.getAllByTestId('quality-post-exit-value')).toHaveLength(20);
});
