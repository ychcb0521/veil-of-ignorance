import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {FishLibraryDataManager} from '../FishLibraryDataManager';
import {FishLibraryDataButton} from '../FishLibraryTransferContext';
import {payload} from '@/lib/fish/__tests__/libraryTransfer.fixture';
import {makeLibraryPackage,EMPTY_COLLECTION} from '@/lib/fish/libraryTransfer';
import {newQualityStudy} from '@/lib/fish/quality';
const store=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),mining:vi.fn()}));
vi.mock('@/lib/fish/libraryTransferStore',()=>({loadLibraryCollection:store.load,importLibraryPackages:store.save,LIBRARY_TRANSFER_EVENT:'test-library-transfer'}));
vi.mock('@/lib/fish/miningLibraryStore',()=>({loadMiningLibraryForTransfer:store.mining}));
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);store.load.mockResolvedValue(EMPTY_COLLECTION());store.mining.mockResolvedValue(payload().mining);store.save.mockReset();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mount(){const p=payload(),study={...newQualityStudy(),filterLibrary:p.filter,monitorLibrary:p.monitor};return render(<FishLibraryDataManager account="destination-account" study={study} ready><FishLibraryDataButton/></FishLibraryDataManager>);}
async function upload(at=200){const p=await makeLibraryPackage('source-account','电脑B',payload(at,-4)),f=new File([''],'libraries.json',{type:'application/json'});Object.defineProperty(f,'text',{value:async()=>JSON.stringify(p)});fireEvent.change(screen.getByLabelText('上传鱼质量三库JSON数据包'),{target:{files:[f]}});await screen.findByTestId('fish-library-import-preview');return p;}
it('previews all three libraries, waits for confirmation, and saves only to the current destination account',async()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:'三库数据下载导入与汇总'}));await waitFor(()=>expect(screen.queryByText('正在读取完整三库…')).not.toBeInTheDocument());
 const p=await upload();expect(store.save).not.toHaveBeenCalled();expect(screen.getByTestId('fish-library-import-preview')).toHaveTextContent('更新3条');store.save.mockResolvedValue({version:1,packages:[p]});fireEvent.click(screen.getByRole('button',{name:'确认导入并汇总'}));
 await screen.findByText(/导入完成/);expect(store.save).toHaveBeenCalledWith('destination-account',[p]);expect(screen.queryByTestId('fish-library-import-preview')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('汇总数据来源账号'),{target:{value:'source-account'}});expect(screen.getAllByRole('table').at(-1)!).toHaveTextContent('电脑B');expect(screen.getAllByRole('table').at(-1)!).toHaveTextContent('-4.0000%');
});
it('keeps the preview and reports storage failure without claiming a completed import',async()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:'三库数据下载导入与汇总'}));await waitFor(()=>expect(screen.queryByText('正在读取完整三库…')).not.toBeInTheDocument());await upload();store.save.mockRejectedValue(Error('存储空间不足'));fireEvent.click(screen.getByRole('button',{name:'确认导入并汇总'}));expect(await screen.findByRole('alert')).toHaveTextContent('未完成导入：存储空间不足');expect(screen.getByTestId('fish-library-import-preview')).toBeInTheDocument();expect(screen.queryByText(/导入完成/)).not.toBeInTheDocument();
});
it('rejects an invalid JSON file before any write',async()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:'三库数据下载导入与汇总'}));await waitFor(()=>expect(screen.queryByText('正在读取完整三库…')).not.toBeInTheDocument());const f=new File([''],'wrong.json');Object.defineProperty(f,'text',{value:async()=>'{"format":"wrong"}'});fireEvent.change(screen.getByLabelText('上传鱼质量三库JSON数据包'),{target:{files:[f]}});expect(await screen.findByRole('alert')).toHaveTextContent('文件类型或版本不支持');expect(store.save).not.toHaveBeenCalled();
});
