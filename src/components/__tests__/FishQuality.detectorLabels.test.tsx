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
// 【用户要求】2026-11-02 组合表「持仓监测」里的「探测标签」删除（买前过滤已有）；导出与单元格组件保留
it('no longer shows a detector-label column under 持仓监测; the half mirror is followed by holding time',()=>{
 const s=state(),[a,b]=s.study.sellPlans!;render(<FishQuality state={s}/>);
 expect(screen.queryAllByTestId('quality-detector-label-header')).toHaveLength(0);expect(screen.queryByRole('button',{name:'展开'+a.label+'探测标签'})).toBeNull();
 for(const p of [a,b]){const mirror=screen.getByRole('button',{name:'按'+p.label+'镜像平衡减仓实际涨幅排序'}).closest('th')!;expect(mirror.nextElementSibling).toHaveTextContent(/^持仓时间/);}
});
it('exports the same classifications although the table no longer shows the column',()=>{
 const s=state(),plan=s.study.sellPlans![0];render(<FishQuality state={s}/>);const sheets=buildQualitySheets(s.study,qualityComparisonRows(s.study)),main=sheets[0],col=main.columns.findIndex(c=>c.header===plan.label+' · 探测标签');expect(main.rows.map(r=>r[col])).toEqual(['轻微误报','严重误报','准确击中']);expect(main.rows.every(r=>r.length===main.columns.length)).toBe(true);
 const runs=sheets.find(s=>s.name==='运行结果')!,ri=runs.columns.findIndex(c=>c.header==='探测标签');expect(runs.rows.every(r=>r.length===runs.columns.length)).toBe(true);expect(runs.rows.map(r=>r[ri])).toEqual(expect.arrayContaining(['轻微误报','严重误报','准确击中']));
 expect(screen.queryByRole('button',{name:'按'+plan.label+'探测标签排序'})).toBeNull();
});
it('retains every detector attribution when several detectors share one trade result',()=>{
 const s=state(),plan=s.study.sellPlans![0],base=qualityComparisonRows(s.study)[0],result=s.study.results.find(r=>r.sampleId===base.id&&r.groupId===plan.id)!;
 s.study.groups=[{...plan,id:'det-a',label:'探测A'},{...plan,id:'det-b',label:'探测B'}];const entries=['det-a','det-b'].map(detectorId=>({row:{...base,id:'entry-'+detectorId,signalId:'same-entry',detectorId},result}));
 render(<table><tbody><tr><DetectorLabelCell plan={plan} entries={entries} study={s.study} expanded onExpand={()=>{}}/></tr></tbody></table>);expect(screen.getAllByTestId('quality-detector-label-item')).toHaveLength(2);expect(screen.getByText(/探测A/)).toBeInTheDocument();expect(screen.getByText(/探测B/)).toBeInTheDocument();expect(screen.getAllByText('轻微误报')).toHaveLength(2);
});
it('keeps one row per buy of the same signal without a label column',()=>{
 const s=state(),first=s.study.samples[0];s.study.samples=[first,{...first,id:'later',enteredAt:first.enteredAt!+M}];
 const rows=qualityComparisonRows(s.study),plan=s.study.sellPlans![0];
 s.study.results=rows.flatMap((row,i)=>s.study.sellPlans!.map(p=>({key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:T+36000000,status:'closed' as const,entryTime:row.enteredAt!,entryPrice:100,endTime:T+10*M,endPrice:100,returnPct:i?2:0,pnl:i?2:0,mirrorFill:{at:T+5*M,price:105,fraction:.5,gainPct:5,atOpen:false}})));
 render(<FishQuality state={s}/>);void plan;
 expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(2);expect(screen.queryAllByTestId('quality-detector-label-item')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'展开探测算法明细'}));expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(2);
});
