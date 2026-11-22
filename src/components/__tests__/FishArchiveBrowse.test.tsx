import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishArchiveBrowse} from '../FishArchiveBrowse';
import type {BrowseRow,BrowseScope} from '@/lib/fish/libraryBrowse';

const calls=vi.hoisted(()=>({directory:vi.fn(),body:vi.fn(),local:vi.fn(),rebuild:vi.fn()}));
vi.mock('@/lib/fish/libraryBrowse',()=>({readBrowseCatalog:calls.directory,readBrowsePage:calls.body}));
vi.mock('@/lib/fish/preEntryPersistence',()=>({readScreenCatalog:calls.local}));
vi.mock('@/lib/fish/historicalScreenBrowse',()=>({rebuildHistoricalScreenCatalog:calls.rebuild}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});

it('falls back from an empty local index and rebuilds missing v5 history only on demand',async()=>{
  vi.stubGlobal('indexedDB',{});
  calls.local.mockResolvedValue({id:'empty',groups:[]});
  calls.directory.mockResolvedValue(undefined);
  render(<FishArchiveBrowse owner="alice" scope="screen" query=""/>);
  fireEvent.click(await screen.findByRole('button',{name:'查看 v5 历史目录'}));
  const rebuild=await screen.findByRole('button',{name:'从账号 v5 归档重建目录'});
  expect(calls.rebuild).not.toHaveBeenCalled();
  calls.rebuild.mockResolvedValue(undefined);
  calls.directory.mockResolvedValue({groups:[{id:'archived',title:'云端轮次',at:1,count:1,pages:['p']}]});
  fireEvent.click(rebuild);
  expect(await screen.findByRole('button',{name:/云端轮次/})).toBeVisible();
  expect(calls.rebuild).toHaveBeenCalledTimes(1);
  expect(calls.body).not.toHaveBeenCalled();
});

it('uses verified history when the only local round is hidden in the research directory',async()=>{
  vi.stubGlobal('indexedDB',{});
  calls.local.mockResolvedValue({id:'local',groups:[{id:'hidden',title:'隐藏轮次',at:2,count:1,pages:['hidden-page']}]});
  calls.directory.mockResolvedValue({groups:[{id:'visible',title:'可见轮次',at:1,count:2,pages:['valid-page']}]});
  render(<FishArchiveBrowse owner="alice" scope="screen" query="" edits={{hidden:{hidden:true,at:100}}}/>);
  expect(await screen.findByRole('button',{name:/可见轮次/})).toBeVisible();
  expect(screen.queryByText('隐藏轮次')).toBeNull();
  expect(calls.body).not.toHaveBeenCalled();
});
it.each<BrowseScope>(['filter','mining','screen'])('reads only the clicked page and drops late replies on switch and collapse (%s)',async scope=>{
  calls.directory.mockResolvedValue({groups:[
    {id:'older',title:'较早',at:1,count:1,pages:['a']},
    {id:'newer',title:'最近',at:2,count:2,pages:['b','c']},
  ]});
  let resolveOld!:(rows:BrowseRow[])=>void;
  calls.body.mockImplementation((_,page)=>page==='a'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve([['NEW',2,page,'id']]));
  const view=render(<FishArchiveBrowse owner="alice" scope={scope} query=""/>);
  const latest=await screen.findByRole('button',{name:/最近/}),old=screen.getByRole('button',{name:/较早/});
  expect(calls.body).toHaveBeenCalledTimes(0);
  expect(screen.getAllByRole('button')[0]).toBe(latest);
  fireEvent.click(old);fireEvent.click(latest);
  expect(calls.body.mock.calls[0][2].aborted).toBe(true);
  await act(async()=>resolveOld([['OLD',1,'old','id']]));
  await screen.findByText('NEW');
  expect(screen.queryByText('OLD')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'下一页'}));
  await screen.findByText('c');
  fireEvent.click(latest);
  expect(screen.queryByText('NEW')).toBeNull();
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['a','b','c']);
  view.unmount();
  await waitFor(()=>expect(calls.body.mock.calls.every(([, ,signal])=>signal.aborted)).toBe(true));
});
