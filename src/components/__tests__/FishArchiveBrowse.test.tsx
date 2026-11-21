import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishArchiveBrowse} from '../FishArchiveBrowse';
import type {BrowseRow,BrowseScope} from '@/lib/fish/libraryBrowse';

const calls=vi.hoisted(()=>({directory:vi.fn(),body:vi.fn()}));
vi.mock('@/lib/fish/libraryBrowse',()=>({readBrowseCatalog:calls.directory,readBrowsePage:calls.body}));
vi.mock('@/lib/fish/preEntryPersistence',()=>({readScreenCatalog:async()=>undefined}));
afterEach(()=>{cleanup();vi.resetAllMocks();});

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
