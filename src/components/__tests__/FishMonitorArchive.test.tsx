import {render,screen,fireEvent,within,cleanup,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishMonitorLibrary} from '../FishMonitorLibrary';
import {FishQuality} from '../FishQuality';
import {importQualityWorkspaceRows} from '@/lib/fish/qualityWorkspace';
import {FishHitRateTest} from '../FishHitRateTest';
import * as hitRateSettings from '@/lib/fish/hitRateSettings';
import type {FishHitRateOptions} from '@/lib/fish/hitRate';
import {archiveQualityMonitorStudy} from '@/lib/fish/qualityMonitorLibrary';
import {monitorArchiveFixture,ARCHIVE_T as T} from '@/lib/fish/__tests__/monitorArchive.fixture';
import type {FishQualityState} from '@/hooks/useFishQuality';
import type {FishQualityStudy} from '@/lib/fish/quality';
afterEach(cleanup);
function state(study:FishQualityStudy){const noop=vi.fn(),run=vi.fn(async()=>{});return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:run,restart:run,cancel:noop,startFilter:run,cancelFilter:noop,setRule:noop,setCombo:noop,setObserveHours:noop,selectSell:noop,setSelectedRows:noop,setPriority:noop,setScope:noop,setFilters:noop,setHoldingVetoes:noop,setSellPlans:noop} satisfies FishQualityState;}
it('does not fetch a monitoring body until loading the selected directory',async()=>{
 const initial=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4_000_000);
 const {study:body,...entry}=initial.monitorLibrary!.archives![0];
 const other={...entry,id:'other',createdAt:entry.createdAt+1};
 const study={...initial,monitorLibrary:{...initial.monitorLibrary!,archives:[entry,other]}};
 const loadArchive=vi.fn().mockResolvedValue(body);
 render(<FishMonitorLibrary study={study} account="alice" loadArchive={loadArchive}
   renderStudy={snapshot=><p>已读取 {snapshot.samples.length} 条</p>}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 expect(loadArchive).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+other.id}));
 expect(loadArchive).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+entry.id}));
 expect(loadArchive).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'载入所选目录'}));
 expect(await screen.findByText(/已读取/)).toBeVisible();
 expect(loadArchive).toHaveBeenCalledExactlyOnceWith(entry,false);
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+other.id}));
 expect(screen.queryByText(/已读取/)).toBeNull();
 expect(loadArchive).toHaveBeenCalledOnce();
});

it('shows the shared combination table as the first and only monitor detail and imports its selection',async()=>{
 const study=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4_000_000);
 const entry=study.monitorLibrary!.archives![0];
 let working={...study,results:[],samples:[]} as FishQualityStudy;
 const importRows=vi.fn((snapshot:FishQualityStudy,ids:readonly string[])=>{working=importQualityWorkspaceRows(working,snapshot,ids);return true;});
 const source=()=>study;
 const workspace={sources:{fish:source,mined:source,library:source,turing:source},importRows,removeRows:vi.fn(),saveMonitoring:vi.fn(),saveFiltering:vi.fn()};
 const view=render(<FishQuality state={{...state(working),workspace}}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+entry.id}));
 const board=within(await screen.findByTestId('quality-archive-board'));
 expect(board.getByTestId('quality-fish-table')).toHaveTextContent('+10.00%');
 expect(screen.queryByTestId('quality-workspace-source-rows')).toBeNull();
 fireEvent.click(board.getByRole('checkbox',{name:'全选当前筛选信号'}));
 fireEvent.click(board.getByRole('button',{name:/导入所选到组合表/}));
 expect(importRows).toHaveBeenCalledOnce();
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(working.samples.flatMap(sample=>sample.importedMonitoring?.map(item=>item.result)??[])).toEqual(expect.arrayContaining(entry.study.results));
 view.rerender(<FishQuality state={{...state(working),workspace}}/>);
 expect(screen.getByTestId('quality-fish-table')).toHaveTextContent('+10.00%');
});

it('opens one monitoring result table per template and keeps saved results from different rounds',async()=>{
 const original=monitorArchiveFixture();
 const saved=original.sellPlans!.map((plan,i)=>({id:'saved-'+i,name:plan.label,savedAt:T-1000+i,updatedAt:T-1000+i,plan}));
 let study=archiveQualityMonitorStudy({...original,planTemplates:saved},T+4_000_000);
 const first=study.monitorLibrary!.archives![0];
 study=archiveQualityMonitorStudy({...study,results:study.results.map(result=>({...result,returnPct:-7}))},T+5_000_000);
 const view=state(study);
 render(<FishQuality state={view}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 fireEvent.click(screen.getByRole('button',{name:'查看全部轮次'}));
 expect(screen.queryByRole('button',{name:'管理轮次与归档'})).not.toBeInTheDocument();
 expect(screen.queryByTestId('monitor-archive-item')).not.toBeInTheDocument();
 const group=screen.getAllByTestId('monitor-template-group')[0];
 fireEvent.click(within(group).getAllByRole('button')[0]);
 const board=await within(group).findByTestId('quality-archive-board');
 expect(within(group).getAllByTestId('quality-archive-board')).toHaveLength(1);
 expect(within(board).getByTestId('quality-algorithm-categories')).toHaveTextContent('持仓监测');
 expect(within(board).getByTestId('quality-fish-table')).toHaveTextContent('+10.00%');
 expect(within(board).getAllByTitle(/收益率 -7\.00%/).length).toBeGreaterThan(0);
 expect(within(board).queryByRole('button',{name:'开始监测'})).not.toBeInTheDocument();
 expect(view.restart).not.toHaveBeenCalled();
 expect(first.study.results[0].returnPct).toBe(10);
});

it('omits unmatched historical snapshots from the default list without removing their records',()=>{
 const study=monitorArchiveFixture(),before=structuredClone(study);
 render(<FishQuality state={state(study)}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 fireEvent.click(screen.getByRole('button',{name:'查看全部轮次'}));
 expect(screen.queryByTestId('monitor-template-group')).not.toBeInTheDocument();
 expect(screen.getByText('暂无与已保存模板对应的记录。')).toBeVisible();
 fireEvent.keyDown(screen.getByRole('button',{name:'监测库更多操作'}),{key:'Enter'});
 expect(screen.getByRole('menuitem',{name:'导出库内记录（Excel）'})).not.toHaveAttribute('data-disabled');
 expect(study).toEqual(before);
});

it('selects samples in the full monitoring archive and tests their original signal time', async () => {
 const s = monitorArchiveFixture();
 const signalTime = T - 6 * 60_000;
 const samples = s.samples.map(sample => sample.source.symbol === 'AAAUSDT' ? {
  ...sample, source: {...sample.source, preEntryMonitor: {recordId:'entry', roundId:'screening', sourceId:sample.source.id, sourceTime:signalTime, matchedAt:T}},
 } : sample);
 const full = archiveQualityMonitorStudy({...s,samples}, T + 4_000_000);
 const archive = full.monitorLibrary!.archives![0];
 const {study: archivedStudy, ...directory} = archive;
 const loadMonitorArchive = vi.fn().mockResolvedValue(archivedStudy);
 const quality = {...state({...full,monitorLibrary:{...full.monitorLibrary!,archives:[directory]}}),loadMonitorArchive};
 const run = vi.fn(async (_options: FishHitRateOptions) => {});
 const settings = {version:1, cards:[], combination:'or', selection:{exchanges:['binance'],includeDuplicates:false},
  downwardWick:{enabled:false,hours:12,atrMultiple:4}, turnover:{enabled:false,floors:[]},window:{beforeHours:2.5,afterHours:2.5}} satisfies hitRateSettings.FishHitRateSettings;
 const build = vi.spyOn(hitRateSettings,'buildFishHitRateSettings').mockReturnValue({algorithms:[],combination:'or'});
 try {
  render(<FishHitRateTest quality={quality} captureSettings={()=>settings} defs={[]} run={run} onRunningChange={()=>{}}/>);
  expect(screen.getByRole('radio',{name:'筛选库'})).toBeChecked();
  fireEvent.click(screen.getByRole('radio',{name:'监测库'}));
  fireEvent.click(screen.getByRole('button',{name:'从监测库选择标的'}));
  fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+archive.id}));
  const board = await screen.findByTestId('quality-archive-board');
  expect(loadMonitorArchive).toHaveBeenCalledWith(directory);
  expect(within(board).getByTestId('quality-monitor-group')).toBeVisible();
  fireEvent.click(within(board).getByRole('checkbox',{name:/选择 AAAUSDT/}));
  expect(screen.getByText('已选 1 条测试样本')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'使用所选样本'}));
  fireEvent.click(screen.getByRole('radio',{name:'筛选库'}));
  fireEvent.click(screen.getByRole('radio',{name:'监测库'}));
  expect(screen.getByText('1 条样本 · 1 个不同时间窗口')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'开始测试'}));
  await waitFor(()=>expect(run).toHaveBeenCalledOnce());
  expect(run.mock.calls[0][0].samples).toEqual([expect.objectContaining({symbol:'AAAUSDT',timeMs:signalTime})]);
  expect(quality.setSelectedRows).not.toHaveBeenCalled();
 } finally { build.mockRestore(); }
});
