import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishMonitorLibrary} from '../FishMonitorLibrary';
import {newQualityStudy} from '@/lib/fish/quality';
import type {RecentMonitorDirectory} from '@/lib/fish/qualityRecentLibrary';
const store=vi.hoisted(()=>({directory:vi.fn(),body:vi.fn()}));
vi.mock('@/lib/fish/qualityRecentLibraryStore',()=>({readRecentMonitorDirectory:store.directory,readRecentMonitorBody:store.body}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const at=Date.UTC(2026,10,21);
function directory():RecentMonitorDirectory{return {version:1,owner:'alice',sourceRevision:'r1',generatedAt:at,total:14,deletions:{},entries:Array.from({length:14},(_,i)=>({id:'round-'+i,at:at-i*1000,label:'监测轮次',summary:'保存结果',bodyId:'body-'+i,templateDirectory:{id:'P',title:'监测_P'}}))};}
it('shows the latest 12 entries while the whole study is pending and reads only the selected body',async()=>{
 store.directory.mockResolvedValue(directory());store.body.mockResolvedValue(newQualityStudy(at));
 const props={study:newQualityStudy(at),ready:false,account:'alice',renderStudy:()=> <p>所选正文</p>,onCopyStudy:vi.fn()};
 const view=render(<FishMonitorLibrary {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 await waitFor(()=>expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(12));
 expect(store.body).not.toHaveBeenCalled();expect(screen.getByText(/展开时读取该项正文/)).toBeInTheDocument();
 expect(screen.getByText('共 14 项目录 · 已显示 12 项')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'导出监测库数据'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 round-0'}));
 await screen.findByText('所选正文');expect(store.body).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('button',{name:'复制至组合表'})).toBeNull();
 const viewport=screen.getByTestId('monitor-directory-scroll');
 Object.defineProperties(viewport,{clientHeight:{value:200},scrollHeight:{value:1000}});
 fireEvent.scroll(viewport,{target:{scrollTop:720}});expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(14);
 expect(store.body).toHaveBeenCalledTimes(1);
 view.rerender(<FishMonitorLibrary {...props} ready/>);
 expect(screen.getByText('所选正文')).toBeInTheDocument();expect(store.body).toHaveBeenCalledTimes(1);
});
it('offers a retry when the lightweight request fails without declaring the full library empty',async()=>{
 store.directory.mockRejectedValueOnce(Error('offline')).mockResolvedValue(directory());
 render(<FishMonitorLibrary study={newQualityStudy(at)} ready={false} account="alice"/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 fireEvent.click(await screen.findByRole('button',{name:'重试近期目录'}));
 await waitFor(()=>expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(12));
 expect(screen.queryByText(/暂无监测归档/)).toBeNull();
});
it('never keeps the previous account directory visible after switching accounts',async()=>{
 store.directory.mockImplementation(async owner=>owner==='alice'?directory():undefined);
 const view=render(<FishMonitorLibrary study={newQualityStudy(at)} ready={false} account="alice"/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));await waitFor(()=>expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(12));
 view.rerender(<FishMonitorLibrary study={newQualityStudy(at)} ready={false} account="bob"/>);
 await waitFor(()=>expect(store.directory).toHaveBeenCalledWith('bob'));expect(screen.queryAllByTestId('monitor-archive-item')).toHaveLength(0);
});
it('keeps recent entries usable after full-history recovery fails and offers its independent retry',async()=>{
 store.directory.mockResolvedValue(directory());const retry=vi.fn();
 render(<FishMonitorLibrary study={newQualityStudy(at)} ready={false} account="alice" loadError="full history failed" onRetry={retry}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));await waitFor(()=>expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(12));
 fireEvent.click(screen.getByRole('button',{name:'重试完整研究'}));expect(retry).toHaveBeenCalledOnce();expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(12);
});
it('still opens recent-first after the whole study is ready and keeps full-library management available',async()=>{
 store.directory.mockResolvedValue(directory());const rename=vi.fn();
 render(<FishMonitorLibrary study={newQualityStudy(at)} ready account="alice" onRename={rename}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));await waitFor(()=>expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(12));
 expect(store.body).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'管理监测归档 round-0'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'查看全部轮次'}));expect(screen.queryAllByTestId('monitor-archive-item')).toHaveLength(0);
 expect(screen.getByText(/暂无监测归档/)).toBeInTheDocument();expect(rename).not.toHaveBeenCalled();
});
it('shows a newly completed local round immediately instead of shadowing it with an older cloud catalog',()=>{
 const study=newQualityStudy(at);study.monitorLibrary={version:1,importedLegacy:false,settings:[],records:[],archives:[],rounds:[{id:'local-new',startedAt:at+60000,updatedAt:at+60001,state:'complete',recordIds:[]}]};
 render(<FishMonitorLibrary study={study} ready account="alice" renderStudy={()=> <p>最新本机轮次</p>}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 local-new'}));
 expect(screen.getByText('最新本机轮次')).toBeInTheDocument();expect(store.directory).not.toHaveBeenCalled();expect(store.body).not.toHaveBeenCalled();
});
it('retains a partial index after the automatic lookup fails and retries without reading bodies',async()=>{
 const partial={...directory(),entries:directory().entries.slice(0,12)};
 store.directory.mockResolvedValueOnce(partial).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(directory());
 render(<FishMonitorLibrary study={newQualityStudy(at)} ready={false} account="alice"/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));
 await waitFor(()=>expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(12));
 const viewport=screen.getByTestId('monitor-directory-scroll');
 Object.defineProperties(viewport,{clientHeight:{value:200},scrollHeight:{value:1000}});
 fireEvent.scroll(viewport,{target:{scrollTop:780}});
 const retry=await screen.findByRole('button',{name:'刷新目录索引'});
 expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(12);
 fireEvent.scroll(viewport);expect(store.directory).toHaveBeenCalledTimes(2);
 fireEvent.click(retry);
 await waitFor(()=>expect(screen.getAllByTestId('monitor-archive-item')).toHaveLength(14));
 expect(store.body).not.toHaveBeenCalled();
});
