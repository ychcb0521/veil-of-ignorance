import {render,screen,fireEvent,within,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishQuality} from '../FishQuality';
import {archiveQualityMonitorStudy} from '@/lib/fish/qualityMonitorLibrary';
import {monitorArchiveFixture,ARCHIVE_T as T} from '@/lib/fish/__tests__/monitorArchive.fixture';
import type {FishQualityState} from '@/hooks/useFishQuality';
import type {FishQualityStudy} from '@/lib/fish/quality';
afterEach(cleanup);
function state(study:FishQualityStudy){const noop=vi.fn(),run=vi.fn(async()=>{});return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:run,restart:run,cancel:noop,startFilter:run,cancelFilter:noop,setRule:noop,setCombo:noop,setObserveHours:noop,selectSell:noop,setSelectedRows:noop,setPriority:noop,setScope:noop,setFilters:noop,setHoldingVetoes:noop,setSellPlans:noop} satisfies FishQualityState;}
it('opens a newest-first directory and uses the same multi-level result table with frozen values and expansion controls',()=>{
 let s=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4000000);const first=s.monitorLibrary!.archives![0];s={...s,results:s.results.map(r=>({...r,returnPct:-7}))};s=archiveQualityMonitorStudy(s,T+5000000);const latest=s.monitorLibrary!.archives![1],view=state(s);
 render(<FishQuality state={view}/>);fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));const directory=screen.getByTestId('monitor-archive-directory'),items=within(directory).getAllByTestId('monitor-archive-item');expect(items).toHaveLength(2);expect(within(items[0]).getByRole('button')).toHaveAttribute('aria-label','打开监测归档 '+latest.id);
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+first.id}));const board=screen.getByTestId('quality-archive-board');expect(within(board).getByTestId('quality-algorithm-categories')).toHaveTextContent('入场信息');expect(within(board).getByTestId('quality-algorithm-categories')).toHaveTextContent('卖出算法');expect(within(board).getAllByTestId('quality-entry-header')).toHaveLength(first.study.sellPlans!.length);expect(within(board).getByTestId('quality-fish-table')).toHaveTextContent('+10.00%');expect(within(board).queryByRole('button',{name:'开始监测'})).not.toBeInTheDocument();
 expect(within(board).getAllByRole('button',{name:/设置.*卖出算法/}).every(e=>(e as HTMLButtonElement).disabled)).toBe(true);fireEvent.click(within(board).getByRole('button',{name:'展开探测值明细'}));expect(within(board).getByRole('button',{name:'展开探测值明细'})).toHaveAttribute('aria-expanded','true');expect(view.restart).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+latest.id}));expect(screen.getByTestId('quality-archive-board')).toHaveTextContent('-7.00%');expect(first.study.results[0].returnPct).toBe(10);
});
it('keeps earlier record-only rounds reachable using the shared table, with missing historical observations clearly labelled',()=>{
 const s=monitorArchiveFixture();render(<FishQuality state={state(s)}/>);fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+s.monitorLibrary!.rounds[0].id}));expect(screen.getByTestId('monitor-archive-content')).toHaveTextContent('早期轮次');const board=screen.getByTestId('quality-archive-board');expect(within(board).getByTestId('quality-fish-table')).toHaveTextContent('+10.00%');expect(within(board).getAllByTestId('quality-entry-reading')[0]).toHaveTextContent('未归档');
});
