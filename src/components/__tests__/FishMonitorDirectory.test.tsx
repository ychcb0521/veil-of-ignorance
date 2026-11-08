import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {FishMonitorLibrary} from '../FishMonitorLibrary';
import {monitorArchiveFixture,ARCHIVE_T as T} from '@/lib/fish/__tests__/monitorArchive.fixture';
import {archiveQualityMonitorStudy} from '@/lib/fish/qualityMonitorLibrary';
import {editMonitorDirectory} from '@/lib/fish/qualityMonitorArchive';
afterEach(cleanup);
const archived=()=>archiveQualityMonitorStudy(monitorArchiveFixture(),T+4000000);
const renderStudy=()=> <p>冻结总表</p>;
it('keeps deletion in the hover menu, confirms before hiding, and offers restoration',async()=>{
 const study=archived(),id=study.monitorLibrary!.archives![0].id,hide=vi.fn().mockResolvedValue(true),view=render(<FishMonitorLibrary study={study} renderStudy={renderStudy} onSetHidden={hide}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));const menu=screen.getByRole('button',{name:'管理监测归档 '+id});expect(menu).toHaveClass('opacity-0');
 fireEvent.keyDown(menu,{key:'Enter'});fireEvent.click(await screen.findByRole('menuitem',{name:'删除目录'}));expect(hide).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认删除目录'}));await waitFor(()=>expect(hide).toHaveBeenCalledWith(id,true));
 view.rerender(<FishMonitorLibrary study={editMonitorDirectory(study,id,true)} renderStudy={renderStudy} onSetHidden={hide}/>);expect(screen.queryByRole('button',{name:'打开监测归档 '+id})).toBeNull();fireEvent.click(screen.getByRole('checkbox',{name:/显示已删除目录/}));
 fireEvent.keyDown(screen.getByRole('button',{name:'管理监测归档 '+id}),{key:'Enter'});fireEvent.click(await screen.findByRole('menuitem',{name:'恢复目录'}));await waitFor(()=>expect(hide).toHaveBeenCalledWith(id,false));
});
it('offers copying only within an opened entry and closes after a durable successful copy',async()=>{
 const study=archived(),snapshot=study.monitorLibrary!.archives![0],copy=vi.fn().mockResolvedValue(true);render(<FishMonitorLibrary study={study} renderStudy={renderStudy} onCopyStudy={copy}/>);fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));expect(screen.queryByRole('button',{name:'复制至组合表'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+snapshot.id}));
 expect(within(screen.getByTestId('monitor-archive-content')).getByText('冻结总表')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'复制至组合表'}));await waitFor(()=>expect(copy).toHaveBeenCalledWith(snapshot.study));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('keeps the archive open and reports an unsuccessful copy without claiming completion',async()=>{
 const study=archived(),copy=vi.fn().mockResolvedValue(false);render(<FishMonitorLibrary study={study} renderStudy={renderStudy} onCopyStudy={copy}/>);fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+study.monitorLibrary!.archives![0].id}));fireEvent.click(screen.getByRole('button',{name:'复制至组合表'}));expect(await screen.findByRole('alert')).toHaveTextContent('当前总表仍保留');expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('lists directory-only archives (body stored separately) without touching the body, and loads the body when opened',async()=>{
 const full=archived(),entry=full.monitorLibrary!.archives![0],{study:body,...stub}=entry,count=body!.results.length;
 const withCount={...full,monitorLibrary:{...full.monitorLibrary!,archives:[{...stub,resultCount:count}]}},bare={...full,monitorLibrary:{...full.monitorLibrary!,archives:[stub]}};
 const load=vi.fn().mockResolvedValue(body),view=render(<FishMonitorLibrary study={withCount} renderStudy={renderStudy} loadArchive={load}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开监测库'}));expect(screen.getByText(`${count} 项运行结果`)).toBeInTheDocument();expect(load).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'打开监测归档 '+stub.id}));expect(await screen.findByText('冻结总表')).toBeInTheDocument();expect(load).toHaveBeenCalledWith(expect.objectContaining({id:stub.id}));
 view.rerender(<FishMonitorLibrary study={bare} renderStudy={renderStudy} loadArchive={vi.fn().mockRejectedValue(new Error('这份归档的正文不在本机'))}/>);
 expect(screen.getByText('完整快照')).toBeInTheDocument();
});
