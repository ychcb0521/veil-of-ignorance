import {render,screen,fireEvent,within,cleanup,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishQuality} from '../FishQuality';
import {FishHitRateTest} from '../FishHitRateTest';
import * as hitRateSettings from '@/lib/fish/hitRateSettings';
import type {FishHitRateOptions} from '@/lib/fish/hitRate';
import {archiveQualityMonitorStudy} from '@/lib/fish/qualityMonitorLibrary';
import {monitorArchiveFixture,ARCHIVE_T as T} from '@/lib/fish/__tests__/monitorArchive.fixture';
import type {FishQualityState} from '@/hooks/useFishQuality';
import type {FishQualityStudy} from '@/lib/fish/quality';
afterEach(cleanup);
function state(study:FishQualityStudy){const noop=vi.fn(),run=vi.fn(async()=>{});return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:run,restart:run,cancel:noop,startFilter:run,cancelFilter:noop,setRule:noop,setCombo:noop,setObserveHours:noop,selectSell:noop,setSelectedRows:noop,setPriority:noop,setScope:noop,setFilters:noop,setHoldingVetoes:noop,setSellPlans:noop} satisfies FishQualityState;}
it('opens a newest-first directory and uses the same multi-level result table with frozen values and expansion controls',()=>{
 let s=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4000000);const first=s.monitorLibrary!.archives![0];s={...s,results:s.results.map(r=>({...r,returnPct:-7}))};s=archiveQualityMonitorStudy(s,T+5000000);const latest=s.monitorLibrary!.archives![1],view=state(s);
 render(<FishQuality state={view}/>);fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));const directory=screen.getByTestId('monitor-archive-directory'),items=within(directory).getAllByTestId('monitor-archive-item');expect(items).toHaveLength(2);expect(within(items[0]).getByRole('button')).toHaveAttribute('aria-label','打开监测归档 '+latest.id);
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+first.id}));const board=screen.getByTestId('quality-archive-board');expect(within(board).getByTestId('quality-algorithm-categories')).toHaveTextContent('入场信息');expect(within(board).getByTestId('quality-algorithm-categories')).toHaveTextContent('静态过滤');expect(within(board).getByTestId('quality-algorithm-categories')).toHaveTextContent('持仓监测');expect(within(board).queryAllByTestId('quality-entry-header')).toHaveLength(0);expect(within(board).getByTestId('quality-fish-table')).toHaveTextContent('+10.00%');expect(within(board).queryByRole('button',{name:'开始监测'})).not.toBeInTheDocument();
 expect(within(board).getAllByRole('button',{name:/设置.*卖出算法/}).every(e=>(e as HTMLButtonElement).disabled)).toBe(true);fireEvent.click(within(board).getByRole('button',{name:'展开探测值明细'}));expect(within(board).getByRole('button',{name:'展开探测值明细'})).toHaveAttribute('aria-expanded','true');expect(view.restart).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+latest.id}));expect(within(screen.getByTestId('quality-archive-board')).getAllByTitle(/收益率 -7\.00%/).length).toBeGreaterThan(0);expect(first.study.results[0].returnPct).toBe(10);
});
it('keeps earlier record-only rounds reachable using the shared table, with missing historical observations clearly labelled',()=>{
 const s=monitorArchiveFixture();render(<FishQuality state={state(s)}/>);fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+s.monitorLibrary!.rounds[0].id}));expect(screen.getByTestId('monitor-archive-content')).toHaveTextContent('早期轮次');const board=screen.getByTestId('quality-archive-board');expect(within(board).getByTestId('quality-fish-table')).toHaveTextContent('+10.00%');expect(within(board).queryAllByTestId('quality-entry-reading')).toHaveLength(0);
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
