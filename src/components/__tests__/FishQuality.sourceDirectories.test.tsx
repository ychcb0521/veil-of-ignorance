import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishQuality} from '../FishQuality';
import {newQualityStudy,importQualityLibrary,qualityDisplayRows,type QualitySample} from '@/lib/fish/quality';
import {preEntrySignal,type PreEntryLibrary} from '@/lib/fish/preEntryMonitor';
import {makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {beginQualityFilterRound,finishQualityFilterRound} from '@/lib/fish/qualityFilterLibrary';
import type {FishQualityState} from '@/hooks/useFishQuality';
const T=Date.UTC(2026,10,8);
afterEach(()=>{cleanup();sessionStorage.clear();localStorage.clear();});
function fixture(){
 const rounds=['old','latest'].map((id,i)=>({id,startedAt:T+i*60000,updatedAt:T+i*60000,state:'complete' as const,filters:[],hours:0}));
 const library:PreEntryLibrary={version:1,rounds,records:rounds.map((r,i)=>({id:r.id,roundId:r.id,status:'matched',matchedAt:r.startedAt+60000,startTime:T,cursor:r.startedAt+60000,updatedAt:T,readings:[],sample:{id:r.id,source:{id:r.id,symbol:i?'NEWUSDT':'OLDUSDT',timeMs:T,timeLabel:'',fallbackZone:'',quality:4},enteredAt:T,basis:'signal',groups:[],importedAt:T} as QualitySample}))};
 let study=importQualityLibrary({...newQualityStudy(T),independentFilters:true,sellPlans:[]},library.records.map(r=>preEntrySignal(r)!),T,'pre-entry');study.selectedRowIds=qualityDisplayRows(study).map(r=>r.id);
 study={...study,buyFilters:[makeQualityBuyFilter('state:state','>',.7)]};
 const first=beginQualityFilterRound(study,study,T)!;study=finishQualityFilterRound(first.study,first.capture,'complete',T+1);
 const noop=vi.fn(),state:FishQualityState={study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:noop,restart:noop,cancel:noop,startFilter:noop,cancelFilter:noop,setRule:noop,setCombo:noop,setObserveHours:noop,selectSell:noop,setSelectedRows:noop,setPriority:noop,setScope:noop,setFilters:noop,setHoldingVetoes:noop,setSellPlans:noop,restoreMonitorStudy:vi.fn().mockResolvedValue(true),preEntry:{library,ready:true,running:false,error:'',progress:null,start:noop,restart:noop,resume:noop,pause:noop,retry:noop,configure:noop,useSavedSettings:noop,importLibrary:vi.fn()}};
 return {state,filterId:first.capture.roundId};
}
it('defaults to the newest screening directory without replacing saved data, and reopening the selected source opens its directory',async()=>{
 const {state}=fixture(),before=structuredClone(state.study);
 render(<FishQuality state={state}/>);
 const table=screen.getByTestId('quality-fish-table');expect(table).toHaveTextContent('NEWUSDT');expect(table).not.toHaveTextContent('OLDUSDT');
 expect(screen.getByTestId('quality-active-directory')).toHaveTextContent('2026-11-08 08:01:00');expect(state.restoreMonitorStudy).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('combobox',{name:'鱼质量的来源'}));
 const options=within(screen.getByRole('listbox',{name:'选择组合表来源'})).getAllByRole('option');
 expect(options.map(o=>o.textContent!.replace(/\d/g,'').trim())).toEqual(['全部来源','信号库','图灵杯','过滤库','筛选库','挖掘库','鱼舱']);
 fireEvent.click(screen.getByRole('option',{name:/^筛选库/}));
 const dialog=screen.getByRole('dialog');expect(within(dialog).getByLabelText('打开筛选归档 latest')).toHaveAttribute('aria-expanded','true');
 expect(state.study).toEqual(before);expect(state.restoreMonitorStudy).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'选择此目录'}));
 await waitFor(()=>expect(state.restoreMonitorStudy).toHaveBeenCalledWith(expect.objectContaining({samples:expect.any(Array)}),undefined,true));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('opens the filter library from the source picker and changes the table only after a directory is chosen',async()=>{
 const {state,filterId}=fixture();render(<FishQuality state={state}/>);
 fireEvent.click(screen.getByRole('combobox',{name:'鱼质量的来源'}));fireEvent.click(screen.getByRole('option',{name:/^过滤库/}));
 const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('heading',{name:'时间目录'})).toBeInTheDocument();expect(state.restoreMonitorStudy).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByLabelText('打开过滤归档 '+filterId));fireEvent.click(within(dialog).getByRole('button',{name:'选择此目录'}));
 await waitFor(()=>expect(state.restoreMonitorStudy).toHaveBeenCalledWith(expect.objectContaining({buyFilters:expect.arrayContaining([expect.objectContaining({threshold:.7})])}),undefined,true));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.getByRole('combobox',{name:'鱼质量的来源'})).toHaveTextContent('过滤库');
});
