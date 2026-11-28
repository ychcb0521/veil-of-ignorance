import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FishMonitorLibrary} from '../FishMonitorLibrary';
import {monitorArchiveFixture} from '@/lib/fish/__tests__/monitorArchive.fixture';
import {newQualityStudy} from '@/lib/fish/quality';

const store=vi.hoisted(()=>({directory:vi.fn(),body:vi.fn(),folder:vi.fn(),settings:vi.fn(),rounds:vi.fn(),page:vi.fn(),getFileHandle:vi.fn()}));
vi.mock('@/lib/fish/qualityRecentLibraryStore',()=>({readRecentMonitorDirectory:store.directory,readRecentMonitorBody:store.body}));
vi.mock('@/lib/fish/localMonitorFiles',async original=>({...await original<typeof import('@/lib/fish/localMonitorFiles')>(),
  monitorFolder:store.folder,diskRounds:store.rounds,readDiskSettings:store.settings,readDiskPage:store.page}));
const at=1000, id='monitor-example', bodyId='recent-v1-'+'a'.repeat(64);
const disk={id,at,bodyId,count:19159,pageSize:32,pages:Array(Math.ceil(19159/32)).fill([0,1,'digest']),data:'sample.vmon'};
const handle={queryPermission:async()=>'granted',getFileHandle:store.getFileHandle};
beforeEach(()=>{
  vi.stubGlobal('showDirectoryPicker',vi.fn().mockResolvedValue(handle));
  store.folder.mockResolvedValue(handle);
  store.getFileHandle.mockResolvedValue({getFile:async()=>new File([],'test')});
  store.rounds.mockResolvedValue([disk]);
  store.body.mockResolvedValue(newQualityStudy(at));
  store.page.mockImplementation(async(_file,_round,page:number)=>[{id:String(page),source:{symbol:'PAGE-'+page,timeMs:at}}]);
  store.directory.mockResolvedValue({version:1,owner:'alice',sourceRevision:'r1',generatedAt:at,total:1,deletions:{},
    entries:[{id,at,bodyId,label:'监测轮次',summary:'已完成',templateDirectory:{id:'A',title:'监测_A'}}]});
});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
async function expand(){
  render(<FishMonitorLibrary study={newQualityStudy(at)} ready={false} account="alice"/>);
  fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
  fireEvent.click(await screen.findByRole('button',{name:'打开监测归档 '+id}));
}
it('opens the matching disk page immediately and defers the next page until scrolling',async()=>{
  await expand();
  const first=await screen.findByText('PAGE-0');
  expect(store.page.mock.calls.map(args=>args[2])).toEqual([0]);
  const viewport=first.closest('.overflow-y-auto')!;
  Object.defineProperty(viewport,'clientHeight',{value:288});
  fireEvent.scroll(viewport,{target:{scrollTop:920}});
  await screen.findByText('PAGE-1');
  expect(store.page.mock.calls.map(args=>args[2])).toEqual([0,1]);
  expect(store.body).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'载入完整归档'}));
  await waitFor(()=>expect(store.body).toHaveBeenCalledTimes(1));
});
it('binds from the expanded row and reads it without downloading the whole archive',async()=>{
  store.folder.mockResolvedValue(undefined);
  await expand();
  fireEvent.click(await screen.findByRole('button',{name:'绑定文件夹并读取本机明细'}));
  await screen.findByText('PAGE-0');
  expect(store.folder).toHaveBeenCalledWith('alice',handle);
  expect(store.body).not.toHaveBeenCalled();
});
it('keeps the original loader for a different immutable body',async()=>{
  store.rounds.mockResolvedValue([{...disk,bodyId:'recent-v1-other'}]);
  await expand();
  fireEvent.click(await screen.findByRole('button',{name:'载入所选目录'}));
  await waitFor(()=>expect(store.body).toHaveBeenCalledOnce());
  expect(store.page).not.toHaveBeenCalled();
});

it('projects disk records and their frozen metrics into the workspace table for each selected range', async () => {
  const library = monitorArchiveFixture().monitorLibrary!;
  store.settings.mockResolvedValue(library.settings);
  store.page.mockImplementation(async (_file, _round, page: number) =>
    page === 0 ? library.records : page === 8 ? library.records.slice(0, 1) : []);
  render(<FishMonitorLibrary study={newQualityStudy(at)} ready={false} account="alice"
    renderStudy={snapshot => <p>{snapshot.results.length} 项结果 · {snapshot.results[0]?.returnPct}%</p>}/>);
  fireEvent.click(screen.getByRole('button', {name:'打开监测库'}));
  fireEvent.click(await screen.findByRole('button', {name:'打开监测归档 '+id}));
  expect(await screen.findByText(library.records.length+' 项结果 · 10%')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', {name:'监测记录范围'}), {target:{value:'1'}});
  expect(await screen.findByText('1 项结果 · 10%')).toBeVisible();
  expect(store.settings).toHaveBeenCalledOnce();
  expect(store.body).not.toHaveBeenCalled();
});
