import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishLocalResultFiles,useOpenLocalResult} from '../FishLocalResultFiles';
const mock=vi.hoisted(()=>({folder:vi.fn(),index:vi.fn(),page:vi.fn(),cloud:vi.fn()}));
vi.mock('@/lib/fish/localMonitorFiles',()=>({monitorFolder:mock.folder,readBlock:vi.fn()}));
vi.mock('@/lib/fish/localResultFiles',()=>({localScopeName:{filter:'过滤库'},resultIndex:mock.index,resultPage:mock.page}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{const chain={select:()=>chain,eq:()=>chain,abortSignal:()=>chain,maybeSingle:mock.cloud};return chain;}}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});

function Load({revision,onFallback}:{revision:string;onFallback:()=>void}){
  const open=useOpenLocalResult();
  return <button onClick={()=>{if(!open('round',{filter:revision},1))onFallback();}}>载入所选目录</button>;
}

it('restores the shared folder while offline and only substitutes a verified matching revision for the normal directory',async()=>{
  vi.stubGlobal('showDirectoryPicker',vi.fn());
  mock.cloud.mockRejectedValue(Error('offline'));
  const file=new File([],'snapshot');
  const handle={queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFileHandle:vi.fn(async()=>({getFile:async()=>file}))};
  mock.folder.mockResolvedValue(handle);
  mock.index.mockResolvedValue({owner:'one',scope:'filter',savedAt:1,revisions:{filter:'f1'},revision:'f1',
    groups:[{id:'round',title:'本机轮次',count:1,data:'body',pages:[[0,1,'digest']]}]});
  mock.page.mockResolvedValue([{time:1,symbol:'TEST',summary:'满足',record:{id:'signal-one'}}]);
  const fallback=vi.fn();
  const view=(revision:string)=><FishLocalResultFiles owner="one" scope="filter" active>{toolbar=><>{toolbar}<Load revision={revision} onFallback={fallback}/></>}</FishLocalResultFiles>;
  const ui=render(view('older'));
  await screen.findByText(/本机轮次/);
  expect(mock.folder).toHaveBeenCalledWith('one');
  fireEvent.click(screen.getByText('载入所选目录'));
  expect(fallback).toHaveBeenCalledOnce();
  expect(handle.getFileHandle).not.toHaveBeenCalled();
  ui.rerender(view('f1'));
  fireEvent.click(screen.getByText('载入所选目录'));
  await waitFor(()=>expect(screen.getByRole('dialog')).toBeInTheDocument());
  fireEvent.click(await screen.findByText('TEST'));
  expect(screen.getByText(/signal-one/)).toBeInTheDocument();
  expect(handle.getFileHandle).toHaveBeenCalledOnce();
});
