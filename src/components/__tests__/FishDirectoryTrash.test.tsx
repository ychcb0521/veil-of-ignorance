import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FishLibraryTimeDirectory} from '../FishLibraryTimeDirectory';
import {newQualityStudy} from '@/lib/fish/quality';
import type {DirectoryMark,DirectoryScope} from '@/lib/fish/directoryTrash';
import {changeDirectory,readDirectoryMarks} from '@/lib/fish/directoryTrash';
import {readBrowseCatalog,readBrowsePage} from '@/lib/fish/libraryBrowse';

vi.mock('@/lib/fish/directoryTrash',async original=>({
  ...await original<typeof import('@/lib/fish/directoryTrash')>(),changeDirectory:vi.fn(),readDirectoryMarks:vi.fn()
}));
vi.mock('@/lib/fish/libraryBrowse',async original=>({
  ...await original<typeof import('@/lib/fish/libraryBrowse')>(),readBrowseCatalog:vi.fn(),readBrowsePage:vi.fn()
}));
const owner='11111111-1111-4111-8111-111111111111';
const names={filter:'过滤库',screen:'筛选库',mining:'捕捞库',monitor:'监测库'};
const groups=[{id:'one',title:'一轮',at:1000,count:176,pages:['a']},{id:'two',title:'二轮',at:2000,count:43,pages:['b']}];
let marks:Map<string,DirectoryMark>;
const body=vi.fn(()=>newQualityStudy()),load=vi.fn(),remove=vi.fn(async()=>true);
beforeEach(()=>{
  vi.resetAllMocks();marks=new Map();
  body.mockImplementation(()=>newQualityStudy());remove.mockResolvedValue(true);
  vi.mocked(readDirectoryMarks).mockImplementation(async()=>new Map(marks));
  vi.mocked(readBrowseCatalog).mockImplementation(async(owner,scope)=>({version:1,owner,scope,revisions:{},groups}));
  vi.mocked(readBrowsePage).mockResolvedValue([['TEST',1000,'合成信号','shared']]);
  vi.mocked(changeDirectory).mockImplementation(async(account,scope,item,action,token)=>{
    expect(account).toBe(owner);
    expect(token).toBe(marks.get(item.id)?.token);
    if(action==='restore'){marks.delete(item.id);return {state:'active'};}
    const state=action==='begin'?'purging':action==='finish'?'purged':'trash';
    const mark={...item,state,token:action+item.id} as DirectoryMark;
    marks.set(item.id,mark);return mark;
  });
});
afterEach(cleanup);
function directory(scope:DirectoryScope,ready=true,account=owner){
  return <FishLibraryTimeDirectory name={names[scope]} prefix={scope} description="" info="" empty="空目录"
    recordCount={0} download={vi.fn()} trashAccount={{owner:account,scope}}
    cleanupDirectory={scope==='monitor'||scope==='filter'?{ready,load,remove}:undefined}
    browseArchive={scope==='monitor'?undefined:{scope,owner:account,directoryOnly:true,loadFull:load}}
    items={groups.map(g=>({id:g.id,at:g.at,label:g.title,summary:g.count+' 条',study:body}))}/>;
}
async function click(name:string|RegExp){fireEvent.click(await screen.findByRole('button',{name}));}
it.each(['mining','filter','screen','monitor'] as const)('%s deletes and restores from its cold directory and purges only a confirmed item',async scope=>{
  render(directory(scope));await click('打开'+names[scope]);
  await click('删除目录 一轮');await click('取消');expect(changeDirectory).not.toHaveBeenCalled();
  await click('删除目录 一轮');await click('确认删除目录');
  await click('已删除目录（1）');await click('恢复目录');await screen.findByText('没有已删除的目录。');
  await click('返回目录');await click('删除目录 一轮');await click('确认删除目录');
  await click('已删除目录（1）');await click('彻底删除');await click('取消');
  expect(remove).not.toHaveBeenCalled();await click('彻底删除');await click('确认彻底删除');
  await screen.findByText('没有已删除的目录。');await click('返回目录');await screen.findByRole('button',{name:'删除目录 二轮'});
  expect(screen.queryByRole('button',{name:'删除目录 一轮'})).toBeNull();
  expect(vi.mocked(changeDirectory).mock.calls.map(v=>[v[1],v[2].id,v[3]])).toEqual(['trash','restore','trash','begin','finish'].map(action=>[scope,'one',action]));
  expect(body).not.toHaveBeenCalled();expect(readBrowsePage).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();
  if(scope==='monitor'||scope==='filter')expect(remove).toHaveBeenCalledWith(owner,'one');
  else expect(remove).not.toHaveBeenCalled();
  if(scope!=='monitor'){
    await click(/二轮.*43 条/);await screen.findByText('合成信号');
    expect(vi.mocked(readBrowsePage).mock.calls.map(call=>call[1])).toEqual(['b']);
  }
});
it('waits for source verification, leaves a protected round recoverable and resumes an interrupted purge',async()=>{
  marks.set('one',{...groups[0],state:'trash',token:'old'});
  const view=render(directory('filter',false));await click('打开过滤库');await click('已删除目录（1）');
  await click('彻底删除');expect(load).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'确认彻底删除'})).toBeDisabled();
  remove.mockResolvedValueOnce(false);view.rerender(directory('filter'));
  await click('确认彻底删除');await screen.findByText(/受保护或仍在运行/);
  expect(marks.get('one')?.state).toBe('trash');
  remove.mockRejectedValueOnce(Error('模拟网络中断'));
  await click('确认彻底删除');await screen.findByText('模拟网络中断');
  expect(screen.queryByRole('button',{name:'恢复目录'})).toBeNull();
  await click('继续彻底删除');await click('确认彻底删除');await screen.findByText('没有已删除的目录。');
  expect(marks.get('one')?.state).toBe('purged');expect(readBrowsePage).not.toHaveBeenCalled();
});
it('shows a retry on failed verification and discards the previous account’s trash on account change',async()=>{
  vi.mocked(readDirectoryMarks).mockRejectedValueOnce(Error('offline'));
  const view=render(directory('monitor'));await click('打开监测库');await screen.findByText(/目录删除状态暂时无法核对/);
  expect(body).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'删除目录 一轮'})).toBeNull();
  await click('重试');await click('删除目录 一轮');await click('确认删除目录');await click('已删除目录（1）');
  marks.clear();const next='22222222-2222-4222-8222-222222222222';
  view.rerender(directory('monitor',true,next));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'恢复目录'})).toBeNull());
  await screen.findByRole('button',{name:'已删除目录（0）'});
});
