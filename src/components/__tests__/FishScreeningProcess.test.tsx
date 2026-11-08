import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {ScreeningHeaders,ScreeningCells} from '../FishQualityScreeningResults';
import {FishScreeningProcessButton} from '../FishScreeningProcess';
import {emptyPreEntryLibrary} from '@/lib/fish/preEntryMonitor';
import {qualityScreeningResults,screeningResultsSheet} from '@/lib/fish/qualityScreeningResults';
const T=Date.UTC(2026,10,8);
const result=()=>qualityScreeningResults({}, {...emptyPreEntryLibrary(),rounds:[{id:'round',startedAt:T,updatedAt:T,filters:[],hours:48,state:'complete'}],records:[{id:'record',roundId:'round',sample:{id:'s',source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''},groups:[],basis:'signal',enteredAt:T,importedAt:T},status:'unmatched',startTime:T,cursor:T+60000,updatedAt:T,readings:[],detail:'最后摘要',exclusionProcess:{version:1,startedAt:T,entries:[{kind:'observation',stage:'exclusion',status:'blocked',from:T+60000,through:T+120000,count:2,reason:'冲高回落锁定',lastReason:'冲高回落锁定：尚未收复',readings:[{id:'r',label:'状态',at:T+60000,value:.4,met:false}]}]}}]});
afterEach(cleanup);
it('does not present a false optional OR admission route as a mandatory veto',()=>{
 const results=result();results[0].record.exclusionProcess!.entries[0].readings!.push({id:'optional',label:'可选准入',at:T+60000,value:.5,met:false,role:'admission'});
 render(<FishScreeningProcessButton results={results}/>);fireEvent.click(screen.getByLabelText('排除过程'));expect(screen.getAllByTestId('screening-process-unmet')).toHaveLength(1);expect(screen.getByText(/本路未满足（准入取或）/)).toBeInTheDocument();
});
it('places one quiet record icon after first-match time and opens the process without changing saved data',()=>{
 const results=result(),before=structuredClone(results);
 render(<table><thead><tr><ScreeningHeaders cell="" sort="" ascending onSort={vi.fn()}/></tr></thead><tbody><tr><ScreeningCells cell="" results={results}/></tr></tbody></table>);
 expect(screen.getAllByRole('columnheader').map(e=>e.textContent)).toEqual(['筛选方案','筛选结果','首次满足时间','排除过程']);
 expect(screen.getAllByRole('cell')).toHaveLength(4);
 fireEvent.click(screen.getByLabelText('排除过程'));expect(screen.getByTestId('screening-process-dialog')).toHaveTextContent('冲高回落锁定');
 expect(screen.getByText('观测读数 · 1 项未满足').closest('details')).toHaveAttribute('open');expect(screen.getByTestId('screening-process-unmet')).toHaveTextContent('状态 = 0.4 · 未满足');expect(screen.getByTestId('screening-process-item')).toHaveAttribute('data-negative','true');expect(results).toEqual(before);
 const sheet=screeningResultsSheet(results);expect(sheet.columns.map(c=>c.header)).toContain('排除过程');expect(sheet.rows[0].join(' ')).toContain('冲高回落锁定');
});
it('distinguishes unknown and pending readings from failed conditions and keeps chronological order',()=>{
 const results=result(),process=results[0].record.exclusionProcess!;
 process.entries.push({kind:'observation',stage:'necessary',status:'pending',from:T+180000,through:T+180000,count:1,reason:'等待读数',readings:[{id:'pending',at:T+180000,met:false,value:null,pending:'数据尚未就绪'}]});
 render(<FishScreeningProcessButton results={results}/>);fireEvent.click(screen.getByLabelText('排除过程'));
 expect(screen.getAllByTestId('screening-process-unmet')).toHaveLength(1);const items=screen.getAllByTestId('screening-process-item');expect(items[0]).toHaveTextContent('冲高回落锁定');expect(items[1]).toHaveAttribute('data-negative','false');expect(items[1]).toHaveTextContent('等待读数');
});
it('shows only the stored summary for a legacy record instead of inventing a historical process',()=>{
 const results=result();delete results[0].record.exclusionProcess;
 render(<FishScreeningProcessButton results={results}/>);fireEvent.click(screen.getByLabelText('排除过程'));
 expect(screen.getByRole('dialog')).toHaveTextContent('这条历史记录未保存完整排除过程');expect(screen.getByRole('dialog')).toHaveTextContent('最后摘要');expect(screen.queryByTestId('screening-process-item')).not.toBeInTheDocument();
});
