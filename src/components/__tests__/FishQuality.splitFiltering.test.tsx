import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishQuality} from '../FishQuality';
import {newQualityStudy,importQualityLibrary,qualityDisplayRows,qualityFilterReadingKey,qualityComparisonRows,qualityResultKey} from '@/lib/fish/quality';
import {makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {preEntrySignal,type PreEntryLibrary} from '@/lib/fish/preEntryMonitor';
import type {FishQualityState} from '@/hooks/useFishQuality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import type {XlsxSheet} from '@/lib/xlsxWorkbook';
const captured=vi.hoisted(()=>({sheets:[] as XlsxSheet[][]}));
vi.mock('@/lib/fish/qualityExport',async original=>({...await original<typeof import('@/lib/fish/qualityExport')>(),downloadQualityComparison:(_s:unknown,_r:unknown,_at:unknown,leading:XlsxSheet[])=>{captured.sheets.push(leading);return 'test.xlsx';}}));
const T=Date.UTC(2026,10,8),noop=vi.fn();
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();captured.sheets=[];vi.clearAllMocks();});
function fixture():FishQualityState{
 const filter=makeQualityBuyFilter('state:state','>',.7),round={id:'r',startedAt:T,updatedAt:T,filters:[filter],state:'complete' as const,hours:1};
 const library:PreEntryLibrary={version:1,rounds:[round],records:[0,1].map(i=>({id:'record'+i,roundId:'r',status:'matched',matchedAt:T+(i+1)*60000,startTime:T,cursor:T+(i+1)*60000,updatedAt:T+(i+1)*60000,readings:[{key:filter.id,value:.8+i/10}],detail:'首次全部满足',sample:{id:'s'+i,source:{id:'s'+i,symbol:'TEST'+i+'USDT',timeMs:T,timeLabel:'',fallbackZone:''},enteredAt:T,basis:'signal',importedAt:T,groups:[]}}))};
 const study=enableQualityComparison(importQualityLibrary(newQualityStudy(T),library.records.map(r=>preEntrySignal(r)!),T,'pre-entry'));
 study.sellPlans=study.sellPlans!.map(plan=>({...plan,rule:{metric:plan.metric,direction:'<' as const,threshold:.5}}));
 study.independentFilters=true;study.buyFilters=[filter];study.filterReadings=qualityComparisonRows(study).map(r=>({key:qualityFilterReadingKey(r,filter),value:.91}));study.selectedRowIds=qualityDisplayRows(study).map(r=>r.id);
 study.results=qualityComparisonRows(study).flatMap(row=>study.sellPlans!.map(plan=>({key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T,status:'closed' as const,returnPct:10,entryTime:row.enteredAt!,entryPrice:100,endTime:T+3600000,endPrice:110})));
 return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:noop,restart:noop,cancel:noop,startFilter:noop,cancelFilter:noop,setRule:noop,setCombo:noop,setObserveHours:noop,selectSell:noop,setSelectedRows:noop,setPriority:noop,setScope:noop,setFilters:noop,setHoldingVetoes:noop,setSellPlans:noop,clearFilterResults:vi.fn(),clearScreeningResults:vi.fn(),preEntry:{library,ready:true,running:false,error:'',progress:null,start:noop,restart:noop,resume:noop,pause:noop,retry:noop,configure:noop,useSavedSettings:noop,importLibrary:vi.fn(),clearTableResults:vi.fn()}};
}
it('duplicates the existing quiet icons on the two module rows and toggles only the matching table group',()=>{
 const state=fixture();render(<FishQuality state={state}/>);
 const fixed=within(screen.getByTestId('quality-static-controls')),dynamic=within(screen.getByTestId('quality-dynamic-controls'));
 const staticEye=fixed.getByRole('button',{name:'隐藏组合表中的静态过滤结果'}),dynamicEye=dynamic.getByRole('button',{name:'隐藏组合表中的动态筛选结果'});
 expect(staticEye.className).toBe(dynamicEye.className);expect(fixed.getByRole('button',{name:'清除组合表中的静态过滤结果'}).className).toBe(dynamic.getByRole('button',{name:'清除组合表中的动态筛选结果'}).className);
 expect(screen.getByTestId('quality-filter-group')).toHaveTextContent('静态过滤');expect(screen.getByTestId('quality-screening-group')).toHaveTextContent('动态筛选');
 fireEvent.click(staticEye);expect(screen.queryByTestId('quality-filter-group')).toBeNull();expect(screen.getAllByTestId('quality-screening-result')).toHaveLength(2);expect(screen.getAllByTestId('quality-sell-relative-gain')).toHaveLength(4);
 fireEvent.click(dynamicEye);expect(screen.queryByTestId('quality-screening-group')).toBeNull();fireEvent.click(fixed.getByRole('button',{name:'显示组合表中的静态过滤结果'}));expect(screen.getByTestId('quality-filter-group')).toBeInTheDocument();expect(screen.queryByTestId('quality-screening-group')).toBeNull();
});
it('keeps all table headers/body/column widths aligned and sorts the saved first-match times',()=>{
 render(<FishQuality state={fixture()}/>);const table=screen.getByTestId('quality-fish-table'),columns=table.querySelectorAll('col').length;
 for(const row of table.querySelectorAll('thead tr'))expect([...row.querySelectorAll('th')].reduce((n,th)=>n+th.colSpan,0)).toBe(columns);
 for(const row of screen.getAllByTestId('quality-fish-row'))expect(within(row).getAllByRole('cell')).toHaveLength(columns);
 fireEvent.click(screen.getByRole('button',{name:'按动态首次满足时间排序'}));expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('TEST1USDT');fireEvent.click(screen.getByRole('button',{name:'按动态首次满足时间排序'}));expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('TEST0USDT');
});
it('confirms each erase separately and clears only the matching working-table results',async()=>{
 const initial=fixture(),original=structuredClone(initial.preEntry!.library),holding=structuredClone(initial.study.results),clearDynamic=vi.fn(),clearStatic=vi.fn();
 function Harness(){const [state,setState]=useState(initial);return <FishQuality state={{...state,clearFilterResults:()=>{clearStatic();setState(s=>({...s,study:{...s.study,filterReadings:[]}}));},clearScreeningResults:async()=>{clearDynamic();setState(s=>({...s,preEntry:{...s.preEntry!,library:{...s.preEntry!.library,records:s.preEntry!.library.records.map(r=>({...r,tableClearedAt:T+9999999}))}},study:{...s.study,screeningResults:[]}}));return true;}}}/>;}
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'清除组合表中的动态筛选结果'}));expect(clearDynamic).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认清除'}));await waitFor(()=>expect(screen.getAllByTestId('quality-screening-result').every(cell=>cell.textContent==='—')).toBe(true));
 expect(clearStatic).not.toHaveBeenCalled();expect(screen.getAllByTestId('quality-filter-cell')).toHaveLength(2);expect(initial.preEntry!.library).toEqual(original);expect(initial.study.results).toEqual(holding);
 fireEvent.click(screen.getByRole('button',{name:'清除组合表中的静态过滤结果'}));fireEvent.click(screen.getByRole('button',{name:'确认清除'}));await waitFor(()=>expect(clearStatic).toHaveBeenCalledOnce());expect(clearDynamic).toHaveBeenCalledOnce();expect(screen.queryByTestId('quality-filter-cell')).toBeNull();expect(screen.getAllByTestId('quality-sell-relative-gain')).toHaveLength(4);
});
it('exports the same separate groups and leaves hidden dynamic results out of the visible table export',()=>{
 render(<FishQuality state={fixture()}/>);fireEvent.click(screen.getByRole('button',{name:'导出鱼质量数据'}));
 const shown=captured.sheets[0];expect(shown[0].headerRows![0].map(c=>c.text)).toEqual(expect.arrayContaining(['静态过滤','动态筛选','持仓监测']));expect(shown[0].columns.map(c=>c.header)).toEqual(expect.arrayContaining(['筛选方案','筛选结果','首次满足时间']));expect(shown.find(s=>s.name==='动态筛选')!.rows).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'隐藏组合表中的动态筛选结果'}));fireEvent.click(screen.getByRole('button',{name:'导出鱼质量数据'}));const hidden=captured.sheets[1];expect(hidden[0].columns.map(c=>c.header)).not.toContain('筛选结果');expect(hidden.find(s=>s.name==='动态筛选')).toBeUndefined();expect(hidden[0].headerRows![0].some(c=>c.text==='静态过滤')).toBe(true);
});
it('retains the confirmation and current results when clearing cannot be saved',async()=>{
 const state=fixture();state.clearScreeningResults=vi.fn().mockResolvedValue(false);render(<FishQuality state={state}/>);fireEvent.click(screen.getByRole('button',{name:'清除组合表中的动态筛选结果'}));fireEvent.click(screen.getByRole('button',{name:'确认清除'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('清除未保存'));expect(screen.getAllByTestId('quality-screening-result').every(cell=>cell.textContent==='已入选')).toBe(true);
});
