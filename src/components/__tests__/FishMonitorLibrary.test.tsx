import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishMonitorLibrary} from '@/components/FishMonitorLibrary';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {importQualityLibrary,newQualityStudy,qualityDisplayRows,qualityFilterReadingKey,qualityResultKey,qualityRunSamples,type FishQualityStudy} from '@/lib/fish/quality';
import {makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {beginQualityMonitorRound,captureQualityMonitorResult,finishQualityMonitorRound} from '@/lib/fish/qualityMonitorLibrary';
const download=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/fish/qualityMonitorTable',async importOriginal=>({...await importOriginal<typeof import('@/lib/fish/qualityMonitorTable')>(),downloadMonitorRecords:download}));
afterEach(()=>{cleanup();download.mockReset();});
const T = Date.UTC(2026, 9, 27);
function archived(): FishQualityStudy {
  let s = enableQualityComparison(importQualityLibrary(newQualityStudy(T), ['AAAUSDT', 'BBBUSDT'].map((symbol, i) => ({ id: symbol, symbol, timeMs: T + i * 60000, timeLabel: '', fallbackZone: '' }))));
  s.sellPlans = [{ ...s.sellPlans![0], rule: { metric: 'state', direction: '<', threshold: .5 }, buyFilters: [makeQualityBuyFilter('state:state', '>', .7)] }];
  s.selectedRowIds = qualityDisplayRows(s).map(r => r.id);
  for (const threshold of [.5, .4]) {
    s = { ...s, sellPlans: [{ ...s.sellPlans![0], rule: { metric: 'state', direction: '<', threshold } }] };
    const begun = beginQualityMonitorRound(s, s, T + (threshold === .5 ? 1 : 1000)); let saved = begun.study;
    for (const row of qualityRunSamples(s)) {
      const plan = s.sellPlans![0], f = plan.buyFilters![0], key = qualityFilterReadingKey(row, f);
      begun.capture.readings.set(key, { key, value: .9 });
      saved = captureQualityMonitorResult(saved, begun.capture, { key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, status: 'closed', complete: true, evaluatedAt: T + 5000, entryTime: row.enteredAt!, entryPrice: 100, endTime: T + 600000, endPrice: 110, returnPct: 10, pnl: 10 }, T + 5000);
    }
    s = finishQualityMonitorRound(saved, begun.capture, 'complete', T + 6000);
  }
  return s;
}

it('opens the time directory directly and removes both redundant views without altering saved records',()=>{
 const study=archived(),before=structuredClone(study);study.sellPlans![0].rule!.threshold=.1;
 const show=vi.fn((snapshot:FishQualityStudy)=><p>冻结门槛 {snapshot.sellPlans![0].rule!.threshold} · {snapshot.results.length} 项结果</p>);
 render(<FishMonitorLibrary study={study} renderStudy={show}/>);
 expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 expect(screen.getByRole('heading',{name:'时间目录'})).toBeInTheDocument();
 expect(screen.queryByRole('tab',{name:'全部记录'})).toBeNull();expect(screen.queryByRole('tab',{name:/重点信号区/})).toBeNull();expect(screen.queryByTestId('monitor-library-table')).toBeNull();
 expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(2);expect(show).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+study.monitorLibrary!.rounds[0].id}));
 expect(screen.getByTestId('monitor-archive-content')).toHaveTextContent('冻结门槛 0.5 · 2 项结果');
 expect(study.monitorLibrary).toEqual(before.monitorLibrary);
});
it('retains full-record export while the directory is the only visible view',()=>{
 const study=archived();render(<FishMonitorLibrary study={study}/>);fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 const button=screen.getByRole('button',{name:'导出监测库数据'});expect(button).toHaveTextContent('4');fireEvent.click(button);
 expect(download).toHaveBeenCalledWith(study.monitorLibrary!.records,expect.any(Map));
});
it('offers the existing copy callback for earlier record-only rounds too, using the selected frozen results',async()=>{
 const study=archived(),round=study.monitorLibrary!.rounds[0],copy=vi.fn().mockResolvedValue(true);
 render(<FishMonitorLibrary study={study} renderStudy={s=><p>{s.results.length} 项结果</p>} onCopyStudy={copy}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+round.id}));
 expect(screen.getByTestId('monitor-archive-content')).toHaveTextContent('早期轮次');
 fireEvent.click(screen.getByRole('button',{name:'复制至组合表'}));
 await waitFor(()=>expect(copy).toHaveBeenCalledOnce());expect(copy.mock.calls[0][0].results).toHaveLength(2);expect(copy.mock.calls[0][1]).toBe(round.id);
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('keeps an empty directory clear and disables export when no records exist',()=>{
 render(<FishMonitorLibrary study={newQualityStudy(T)}/>);fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 expect(screen.getByText(/暂无监测归档/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'导出监测库数据'})).toBeDisabled();
});
it('reports export failure without clearing the saved directory',()=>{
 download.mockImplementation(()=>{throw Error('导出失败');});const study=archived();render(<FishMonitorLibrary study={study}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));fireEvent.click(screen.getByRole('button',{name:'导出监测库数据'}));
 expect(screen.getByRole('alert')).toHaveTextContent('导出失败');expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(2);
});
