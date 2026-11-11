import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {FishQuality} from '../FishQuality';
import {importQualityLibrary,newQualityStudy,qualityDisplayRows} from '@/lib/fish/quality';
import type {FishQualityState} from '@/hooks/useFishQuality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import type {XlsxSheet} from '@/lib/xlsxWorkbook';
const capture=vi.hoisted(()=>({download:vi.fn(),restore:vi.fn(()=>new Promise(()=>{}))}));
vi.mock('@/lib/fish/qualityTableExport',async original=>({...await original<object>(),downloadQualityTableSheet:capture.download}));
vi.mock('@/lib/fish/preEntryArchive',async original=>({...await original<object>(),restorePreEntryStudy:capture.restore}));
const T=Date.UTC(2026,10,10);
function state(count=140):FishQualityState{
 const study=enableQualityComparison(importQualityLibrary(newQualityStudy(T),Array.from({length:count},(_,i)=>({id:'s'+i,symbol:`COIN${String(i).padStart(3,'0')}USDT`,timeMs:T-i*60000,timeLabel:'',fallbackZone:'',quality:i===0?4:undefined}))));
 const noop=vi.fn();return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:noop,restart:noop,cancel:noop,startFilter:noop,cancelFilter:noop,setRule:noop,setCombo:noop,setObserveHours:noop,selectSell:noop,setSelectedRows:noop,setPriority:noop,setScope:noop,setFilters:noop,setHoldingVetoes:noop,setSellPlans:noop};
}
beforeEach(()=>{capture.download.mockReset();capture.restore.mockClear();});
afterEach(cleanup);
it('places export beside the table title, disables an empty selection, and removes three-library data',()=>{
 const s=state(3);s.study.selectedRowIds=[];render(<FishQuality state={s}/>);
 const bar=screen.getByTestId('quality-combination-toolbar');expect(within(bar).getByText('组合表')).toBeInTheDocument();expect(within(bar).getByRole('button',{name:'导出已选组合表数据'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:/三库数据/})).toBeNull();expect(screen.queryByLabelText('上传鱼质量三库JSON数据包')).toBeNull();expect(capture.download).not.toHaveBeenCalled();
});
it('exports selected offscreen rows exactly once in display order with original row numbers, never restoring histories',async()=>{
 const s=state(),all=qualityDisplayRows(s.study);s.study.selectedRowIds=[all[0].id,all[90].id];render(<FishQuality state={s}/>);
 const live=screen.getByTestId('quality-fish-table');expect(within(live).getAllByTestId('quality-fish-row').length).toBeLessThan(140);
 fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));await waitFor(()=>expect(capture.download).toHaveBeenCalledTimes(1));
 const sheet=capture.download.mock.calls[0][0] as XlsxSheet;expect(sheet.name).toBe('组合表');expect(sheet.rows).toHaveLength(2);expect(sheet.rows.map(row=>row[0])).toEqual([1,91]);expect(sheet.rows.map(row=>row[1])).toEqual([all[0].source.symbol,all[90].source.symbol]);
 expect(sheet.headerRows?.[0][0]).toEqual({text:'入场信息',span:5});expect(sheet.columns.slice(0,5).map(c=>c.header)).toEqual(['行号','标的','信号时间','市场','评分']);
 for(const label of ['加仓次数','几何仓位','相对涨幅','盈亏比','静态最大回撤','峰值涨幅','首仓涨幅','半仓镜像','持仓时间'])expect(sheet.columns.map(c=>c.header)).toContain(label);expect(sheet.columns.map(c=>c.header)).not.toContain('跳转');
 const rating=sheet.columns.findIndex(c=>c.header==='评分');expect(sheet.rows[0][rating]).toBe('★★★★☆');expect(capture.restore).not.toHaveBeenCalled();expect(screen.queryByTestId('quality-export-batch')).toBeNull();
});
it('uses bounded batches without changing the virtual table or exporting unchecked rows',async()=>{
 const s=state(),all=qualityDisplayRows(s.study);s.study.selectedRowIds=all.slice(0,125).map(row=>row.id);render(<FishQuality state={s}/>);
 const live=screen.getByTestId('quality-fish-table'),before=within(live).getAllByTestId('quality-fish-row').length;live.scrollLeft=77;
 fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));expect(within(screen.getByTestId('quality-export-batch')).getAllByTestId('quality-fish-row')).toHaveLength(40);
 expect(within(live).getAllByTestId('quality-fish-row')).toHaveLength(before);await waitFor(()=>expect(capture.download).toHaveBeenCalledTimes(1),{timeout:10000});expect(capture.download.mock.calls[0][0].rows).toHaveLength(125);expect(live.scrollLeft).toBe(77);
});
it('does not export selected rows outside the current table filter',async()=>{
 const s=state(5);s.study.selectedRowIds=qualityDisplayRows(s.study).map(row=>row.id);render(<FishQuality state={s}/>);
 fireEvent.change(screen.getByPlaceholderText('筛选标的…'),{target:{value:'COIN003'}});fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));await waitFor(()=>expect(capture.download).toHaveBeenCalledTimes(1));expect(capture.download.mock.calls[0][0].rows).toHaveLength(1);expect(capture.download.mock.calls[0][0].rows[0][1]).toBe('COIN003USDT');
});
it('shows download errors and allows a retry instead of silently remaining busy',async()=>{
 const s=state(2);s.study.selectedRowIds=qualityDisplayRows(s.study).map(row=>row.id);capture.download.mockImplementationOnce(()=>{throw Error('下载失败测试');});render(<FishQuality state={s}/>);
 fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));await waitFor(()=>expect(screen.getByText('下载失败测试')).toBeInTheDocument());expect(screen.getByRole('button',{name:'导出已选组合表数据'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));await waitFor(()=>expect(capture.download).toHaveBeenCalledTimes(2));
});
it('exports only the column groups currently shown in the combination table',async()=>{
 const s=state(3);s.study.selectedRowIds=qualityDisplayRows(s.study).map(row=>row.id);render(<FishQuality state={s}/>);
 fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));await waitFor(()=>expect(capture.download).toHaveBeenCalledTimes(1));expect(capture.download.mock.calls[0][0].columns.map(c=>c.header)).toContain('探测算法');
 fireEvent.click(screen.getByRole('button',{name:'隐藏组合表中的静态过滤结果'}));fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));await waitFor(()=>expect(capture.download).toHaveBeenCalledTimes(2));expect(capture.download.mock.calls[1][0].columns.map(c=>c.header)).not.toContain('探测算法');expect(capture.download.mock.calls[1][0].rows).toHaveLength(3);
});
it('exports the actual capture time column only when it appears on the table',async()=>{
 const s=state(3);s.study.samples[0].source={...s.study.samples[0].source,mined:{anchorMs:T-86400000},caughtAt:T};s.study.samples[1].source={...s.study.samples[1].source,caughtAt:T+60_000};s.study.selectedRowIds=qualityDisplayRows(s.study).map(row=>row.id);render(<FishQuality state={s}/>);
 expect(screen.getByTestId('quality-mined-at-column')).toHaveTextContent('捕捞时间');fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));await waitFor(()=>expect(capture.download).toHaveBeenCalledTimes(1));const sheet=capture.download.mock.calls[0][0] as XlsxSheet,at=sheet.columns.findIndex(c=>c.header==='捕捞时间');expect(at).toBeGreaterThan(0);expect(sheet.rows.map(row=>row[at])).toEqual(expect.arrayContaining(['2026-11-10 08:00:00','2026-11-10 08:01:00']));
 cleanup();render(<FishQuality state={state(3)}/>);expect(screen.queryByTestId('quality-mined-at-column')).toBeNull();
});

it('exports one cabin row across different entries and sorts it by the latest actual capture time',async()=>{
 const s=state(3),first=s.study.samples[0];
 s.study.samples=s.study.samples.map((row,i)=>({...row,origin:'fish',origins:['fish'],source:{...row.source,caughtAt:T+60000*(i+1)}}));
 s.study.samples.push({...s.study.samples[0],id:'recapture',enteredAt:first.enteredAt!+60_000,source:{...first.source,id:'recapture',caughtAt:T+240000}});
 s.study.selectedRowIds=qualityDisplayRows(s.study).map(row=>row.id);render(<FishQuality state={s}/>);
 fireEvent.click(screen.getByRole('combobox',{name:'鱼质量的来源'}));fireEvent.click(screen.getByRole('option',{name:/^鱼舱/}));
 const order=()=>screen.getAllByTestId('quality-fish-row').map(row=>row.textContent!.match(/COIN\d{3}USDT/)![0]);
 const sort=screen.getByRole('button',{name:'按捕捞时间排序'});
 fireEvent.click(sort);expect(order()).toEqual(['COIN000USDT','COIN002USDT','COIN001USDT']);
 fireEvent.click(sort);expect(order()).toEqual(['COIN001USDT','COIN002USDT','COIN000USDT']);
 fireEvent.click(screen.getByRole('button',{name:'导出已选组合表数据'}));
 await waitFor(()=>expect(capture.download).toHaveBeenCalledOnce());
 const sheet=capture.download.mock.calls[0][0] as XlsxSheet,at=sheet.columns.findIndex(c=>c.header==='捕捞时间');
 expect(sheet.rows.map(row=>row[1])).toEqual(order());expect(sheet.rows[2][at]).toBe('2026-11-10 08:04:00');
});