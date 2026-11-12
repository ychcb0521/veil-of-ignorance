import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FishQuality} from '@/components/FishQuality';
import {newQualityStudy,importQualityLibrary,qualityComparisonRows,qualityResultKey,type FishQualityStudy} from '@/lib/fish/quality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {POST_EXIT_HOURS,qualityPostExitKey} from '@/lib/fish/qualityPostExit';
import {buildQualitySheets} from '@/lib/fish/qualityExport';
import {saveQualityReturn,armQualityReturn,finishQualityReturn} from '@/lib/fish/qualityReturn';
import type {FishQualityState} from '@/hooks/useFishQuality';
const T=Date.UTC(2026,9,20),M=60000,NOW=T+9*3600000;
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);});
afterEach(()=>{cleanup();finishQualityReturn();window.history.replaceState(null,'');localStorage.clear();sessionStorage.clear();vi.useRealTimers();});
function fill(study:FishQualityStudy){
 study.sellPlans=study.sellPlans!.map(p=>({...p,rule:{metric:p.metric,direction:'<' as const,threshold:.5}}));
 study.results=qualityComparisonRows(study).flatMap((row,i)=>study.sellPlans!.map((p,j)=>{const end=T+(10+i+j)*M;return {key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:NOW,status:'closed' as const,entryTime:row.enteredAt!,entryPrice:100,endTime:end,endPrice:110,returnPct:10,pnl:10,exitReading:.4,...(i===3?{}:{exitSnapshot:{barOpenTime:end-M,observedAt:end,...(i===2?{cause:{id:'stop',kind:'static-drawdown' as const,label:'静态止损',direction:'>=' as const,threshold:5}}:{})}})};}));
 study.postExitReadings=qualityComparisonRows(study).flatMap((row,i)=>study.sellPlans!.map((p,j)=>{const r=study.results.find(r=>r.sampleId===row.id&&r.groupId===p.id)!;return {key:qualityPostExitKey(row.source,r,p)!,evaluatedAt:NOW,exitTime:r.endTime!,exitPrice:r.endPrice!,startMs:r.endTime!,excludedExitMinute:false,windows:POST_EXIT_HOURS.map((hours,k)=>({hours,status:'ready' as const,peakPct:i===0&&j===0?[4,2,3,0,6][k]:1,drawdown2Pct:i===0&&j===0?[1,1,1,0,2][k]:1}))};}));
 return study;
}
function state(){const study=fill(enableQualityComparison(importQualityLibrary(newQualityStudy(),[0,1,2,3].map(i=>({id:'e'+i,symbol:'SERR'+i+'USDT',timeMs:T+i*M,timeLabel:'',fallbackZone:''})))));return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:vi.fn(),restart:vi.fn(),cancel:vi.fn(),startFilter:vi.fn(),cancelFilter:vi.fn(),setRule:vi.fn(),setCombo:vi.fn(),setObserveHours:vi.fn(),selectSell:vi.fn(),setSelectedRows:vi.fn(),setPriority:vi.fn(),setScope:vi.fn(),setFilters:vi.fn(),setHoldingVetoes:vi.fn(),setSellPlans:vi.fn(),postExit:{owner:'test',running:false,progress:null,error:'',request:vi.fn(),cancel:vi.fn()}} satisfies FishQualityState;}
const row=(i:number)=>screen.getAllByTestId('quality-fish-row').find(r=>r.textContent!.includes('SERR'+i+'USDT'))!;
it('removes seller-error columns and keeps counterfactuals directly after holding time',()=>{
 const s=state(),a=s.study.sellPlans![0];render(<FishQuality state={s}/>);
 expect(screen.queryByText('卖出误报')).not.toBeInTheDocument();
 expect(screen.queryAllByTestId('quality-sell-error-folded')).toHaveLength(0);
 expect(screen.queryAllByTestId('quality-sell-error-header')).toHaveLength(0);
 expect(screen.queryAllByTestId('quality-sell-error-summary')).toHaveLength(0);
 const held=screen.getByRole('button',{name:'按'+a.label+'持仓时间排序'}).closest('th')!;
 expect(held.nextElementSibling).toHaveAttribute('data-testid','quality-post-exit-folded');
 expect(screen.getByTestId('quality-monitor-group')).toHaveAttribute('colspan','14');
 expect(s.postExit.request).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'展开'+a.label+'卖后反事实'}));
 expect(screen.getByTestId('quality-monitor-group')).toHaveAttribute('colspan','23');
 const columns=screen.getByTestId('quality-fish-table').querySelectorAll('col').length;
 for(const bodyRow of screen.getAllByTestId('quality-fish-row'))expect(within(bodyRow).getAllByRole('cell')).toHaveLength(columns);
 expect(screen.getAllByTestId('quality-post-exit-header')).toHaveLength(10);
});
it('omits removed fields from exports while retaining counterfactual values and aligned rows',()=>{
 const s=state(),before=structuredClone(s.study),a=s.study.sellPlans![0];
 const sheets=buildQualitySheets(s.study,qualityComparisonRows(s.study)),main=sheets[0],runs=sheets.find(s=>s.name==='运行结果')!;
 for(const sheet of [main,runs]){
  expect(sheet.columns.some(c=>c.header.includes('卖出误报'))).toBe(false);
  expect(sheet.rows.every(r=>r.length===sheet.columns.length)).toBe(true);
 }
 const peak=main.columns.findIndex(c=>c.header===a.label+' · 卖后0.5h 峰值涨幅 %（卖出价基准）');
 expect(main.rows[0][peak]).toBe(4);
 expect(main.columns[peak+1].header).toContain('静态最大回撤2');
 expect(runs.rows).toHaveLength(8);expect(s.study).toEqual(before);
});
it('ignores legacy seller-error expansion and sorting without requesting hidden background observations',()=>{
 const s=state(),a=s.study.sellPlans![0];
 window.history.replaceState({key:'legacy-sell-error'},'');
 saveQualityReturn({ui:{open:true,query:'',month:'',origin:'',detectorExpanded:false,sellErrorExpanded:[a.id],postExitExpanded:[],sort:'sell-error:0.5:'+a.id,ascending:false,tableTop:0},scroll:[]},NOW);
 expect(armQualityReturn(NOW)).toBe(true);
 render(<FishQuality state={s}/>);
 expect(screen.queryByText('卖出误报')).not.toBeInTheDocument();
 expect(screen.getByRole('columnheader',{name:/信号时间/})).toHaveAttribute('aria-sort','descending');
 expect(s.postExit.request).not.toHaveBeenCalled();
 expect(screen.queryByTestId('quality-post-exit-progress')).not.toBeInTheDocument();
});
