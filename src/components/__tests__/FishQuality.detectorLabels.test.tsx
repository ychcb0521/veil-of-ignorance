import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishQuality} from '@/components/FishQuality';
import {DetectorLabelCell} from '@/components/FishQualityDetectorLabel';
import {newQualityStudy,importQualityLibrary,qualityComparisonRows,qualityResultKey} from '@/lib/fish/quality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {buildQualitySheets} from '@/lib/fish/qualityExport';
import type {FishQualityState} from '@/hooks/useFishQuality';
const T=Date.UTC(2026,9,20),M=60000;
afterEach(()=>{cleanup();sessionStorage.clear();localStorage.clear();});
function state(){
 const study=enableQualityComparison(importQualityLibrary(newQualityStudy(),[0,1,2].map(i=>({id:'label'+i,symbol:'LABEL'+i+'USDT',timeMs:T+i*M,timeLabel:'',fallbackZone:''}))));
 study.sellPlans=study.sellPlans!.map(p=>({...p,rule:{metric:p.metric,direction:'<' as const,threshold:p.snapshot.threshold},mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}}));
 study.results=qualityComparisonRows(study).flatMap((row,i)=>study.sellPlans!.map((p,j)=>({key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:T+36000000,status:'closed' as const,entryTime:T+i*M,entryPrice:100,endTime:T+10*M,endPrice:100,returnPct:j?2:i===0?0:i===1?-3:7,pnl:j?2:i===0?0:i===1?-3:7,heldHours:1/6,...(j||i!==1?{mirrorFill:{at:T+5*M,price:105,fraction:.5,gainPct:5,atOpen:false}}:{})})));
 return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:vi.fn(),restart:vi.fn(),cancel:vi.fn(),startFilter:vi.fn(),cancelFilter:vi.fn(),setRule:vi.fn(),setCombo:vi.fn(),setObserveHours:vi.fn(),selectSell:vi.fn(),setSelectedRows:vi.fn(),setPriority:vi.fn(),setScope:vi.fn(),setFilters:vi.fn(),setHoldingVetoes:vi.fn(),setSellPlans:vi.fn()} satisfies FishQualityState;
}
it('places an independently folded label immediately after each half mirror and updates from completed results without rerunning',()=>{
 const s=state(),[a,b]=s.study.sellPlans!,view=render(<FishQuality state={s}/>);
 expect(screen.queryAllByTestId('quality-detector-label-item')).toHaveLength(0);
 for(const p of [a,b]){const mirror=screen.getByRole('button',{name:'按'+p.label+'半仓镜像实际涨幅排序'}).closest('th')!;expect(mirror.nextElementSibling).toHaveAttribute('data-testid','quality-detector-label-header');expect(mirror.nextElementSibling).toHaveAttribute('data-sell-plan',p.id);}
 fireEvent.click(screen.getByRole('button',{name:'展开'+a.label+'探测标签'}));expect(screen.getAllByTestId('quality-detector-label-item').map(x=>x.dataset.label).sort()).toEqual(['hit','mild-false','severe-false']);expect(screen.getByRole('button',{name:'展开'+b.label+'探测标签'})).toHaveAttribute('aria-expanded','false');
 const next={...s,study:{...s.study,results:s.study.results.map(r=>r.returnPct===0?{...r,returnPct:1}:r)}};view.rerender(<FishQuality state={next}/>);expect(screen.queryByText('轻微误报')).not.toBeInTheDocument();expect(s.start).not.toHaveBeenCalled();expect(s.restart).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'收起'+a.label+'探测标签'}));expect(screen.queryAllByTestId('quality-detector-label-item')).toHaveLength(0);
});
it('sorts per seller and exports the same classifications while columns remain folded',()=>{
 const s=state(),plan=s.study.sellPlans![0];render(<FishQuality state={s}/>);const sheets=buildQualitySheets(s.study,qualityComparisonRows(s.study)),main=sheets[0],col=main.columns.findIndex(c=>c.header===plan.label+' · 探测标签');expect(main.rows.map(r=>r[col])).toEqual(['轻微误报','严重误报','准确击中']);expect(main.rows.every(r=>r.length===main.columns.length)).toBe(true);
 const runs=sheets.find(s=>s.name==='运行结果')!,ri=runs.columns.findIndex(c=>c.header==='探测标签');expect(runs.rows.every(r=>r.length===runs.columns.length)).toBe(true);expect(runs.rows.map(r=>r[ri])).toEqual(expect.arrayContaining(['轻微误报','严重误报','准确击中']));
 fireEvent.click(screen.getByRole('button',{name:'展开'+plan.label+'探测标签'}));const sort=screen.getByRole('button',{name:'按'+plan.label+'探测标签排序'});fireEvent.click(sort);const order=()=>screen.getAllByTestId('quality-fish-row').map(row=>within(row).getByTestId('quality-detector-label-item').dataset.label);expect(order()).toEqual(['hit','mild-false','severe-false']);fireEvent.click(sort);expect(order()).toEqual(['severe-false','mild-false','hit']);
});
it('retains every detector attribution when several detectors share one trade result',()=>{
 const s=state(),plan=s.study.sellPlans![0],base=qualityComparisonRows(s.study)[0],result=s.study.results.find(r=>r.sampleId===base.id&&r.groupId===plan.id)!;
 s.study.groups=[{...plan,id:'det-a',label:'探测A'},{...plan,id:'det-b',label:'探测B'}];const entries=['det-a','det-b'].map(detectorId=>({row:{...base,id:'entry-'+detectorId,signalId:'same-entry',detectorId},result}));
 render(<table><tbody><tr><DetectorLabelCell plan={plan} entries={entries} study={s.study} expanded onExpand={()=>{}}/></tr></tbody></table>);expect(screen.getAllByTestId('quality-detector-label-item')).toHaveLength(2);expect(screen.getByText(/探测A/)).toBeInTheDocument();expect(screen.getByText(/探测B/)).toBeInTheDocument();expect(screen.getAllByText('轻微误报')).toHaveLength(2);
});
it('keeps labels attached to both entries when the table merges the same signal',()=>{
 const s=state(),first=s.study.samples[0];s.study.samples=[first,{...first,id:'later',enteredAt:first.enteredAt!+M}];
 const rows=qualityComparisonRows(s.study),plan=s.study.sellPlans![0];
 s.study.results=rows.flatMap((row,i)=>s.study.sellPlans!.map(p=>({key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:T+36000000,status:'closed' as const,entryTime:row.enteredAt!,entryPrice:100,endTime:T+10*M,endPrice:100,returnPct:i?2:0,pnl:i?2:0,mirrorFill:{at:T+5*M,price:105,fraction:.5,gainPct:5,atOpen:false}})));
 render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'展开'+plan.label+'探测标签'}));
 expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);expect(screen.getAllByTestId('quality-detector-label-item').map(x=>x.dataset.label).sort()).toEqual(['hit','mild-false']);
 fireEvent.click(screen.getByRole('button',{name:'展开探测算法明细'}));expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(2);expect(screen.getAllByTestId('quality-detector-label-item').map(x=>x.dataset.label).sort()).toEqual(['hit','mild-false']);
});
