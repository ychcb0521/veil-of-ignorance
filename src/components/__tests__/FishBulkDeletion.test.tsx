import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {TooltipProvider} from '../ui/tooltip';
import {FishLibrary} from '../FishLibrary';
import {FishBulkDeletionProvider,FishBulkDeleteContext} from '../FishBulkDeletion';
import {FishMiningLibrary} from '../FishMiningLibrary';
import {payload} from '@/lib/fish/__tests__/libraryTransfer.fixture';
import {newQualityStudy} from '@/lib/fish/quality';
const storage=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('@/lib/fish/miningLibraryStore',()=>({loadMiningLibrary:storage.load,MINING_LIBRARY_EVENT:'test-mining-event',updateMiningLibrary:vi.fn()}));
afterEach(cleanup);
it('selects filtered cabin rows, previews downstream counts, and deletes nothing until confirmed',async()=>{
 const p=payload(),signals=[p.monitor!.records[0].source,{...p.monitor!.records[0].source,id:'two',symbol:'OTHERUSDT'}],remove=vi.fn(),cascade=vi.fn().mockResolvedValue(undefined),state={study:{...newQualityStudy(),filterLibrary:p.filter,monitorLibrary:p.monitor},ready:true,account:'a',deleteSources:cascade} as any;
 render(<TooltipProvider><FishBulkDeletionProvider state={state} removeFish={remove}><FishLibrary signals={signals as any} defaultOpen tradedDayIndex={new Set()} campaignDayIndex={new Set()} jumpingSignalId={null} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}}/></FishBulkDeletionProvider></TooltipProvider>);
 fireEvent.change(screen.getByLabelText('筛选鱼舱信号'),{target:{value:'TEST'}});fireEvent.click(screen.getByRole('button',{name:'全选当前筛选（1）'}));expect(screen.getByRole('checkbox',{name:/选择鱼 TEST/})).toBeChecked();fireEvent.click(screen.getByRole('button',{name:'删除所选（1）'}));expect(screen.getByRole('dialog')).toHaveTextContent('关联过滤库 1 条；监测库 1 条');expect(remove).not.toHaveBeenCalled();expect(cascade).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认删除及关联结果'}));await waitFor(()=>expect(remove).toHaveBeenCalledWith(['signal-id']));expect(cascade).toHaveBeenCalledOnce();
});
it('selects every filtered mining row beyond the visible scroll window, preserving all underlying merged record IDs',async()=>{
 const p=payload(),base=p.mining!.records[0],records=Array.from({length:61},(_,i)=>({...base,id:'r'+i,signal:{...base.signal,id:'s'+i,symbol:'COIN'+i+'USDT'}}));storage.load.mockResolvedValue({...p.mining,records,anchors:[{...p.mining!.anchors[0],recordIds:records.map(r=>r.id)}]});const request=vi.fn();
 render(<TooltipProvider><FishBulkDeleteContext.Provider value={request}><FishMiningLibrary account="a"/></FishBulkDeleteContext.Provider></TooltipProvider>);fireEvent.click(screen.getByRole('button',{name:'打开挖掘库'}));await screen.findByRole('button',{name:'全选当前筛选（61）'});fireEvent.click(screen.getByRole('button',{name:'全选当前筛选（61）'}));const table=screen.getByTestId('挖掘库-table');fireEvent.scroll(table,{target:{scrollTop:50*104}});await waitFor(()=>expect(table.querySelector('tr[aria-rowindex="52"]')).toBeInTheDocument());expect(screen.queryByRole('button',{name:'下一页'})).toBeNull();expect(screen.getAllByRole('checkbox').every(e=>(e as HTMLInputElement).checked)).toBe(true);fireEvent.click(screen.getByRole('button',{name:'删除所选（61）'}));expect(request.mock.calls[0][0].ids).toHaveLength(61);expect(request.mock.calls[0][0].targets).toHaveLength(61);
});
