import{act,fireEvent,render,screen,waitFor,cleanup}from'@testing-library/react';import{afterEach,it,expect,vi}from'vitest';
const api=vi.hoisted(()=>({list:vi.fn(),read:vi.fn()}));vi.mock('@/lib/fish/qualityTemplateArchive',()=>({listQualityTemplateArchive:api.list,readQualityTemplateArchive:api.read}));
import{FishQualityTemplateArchive}from'../FishQualityTemplateArchive';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('loads independent system history even with an empty local catalog and restores a chosen revision only',async()=>{
 localStorage.clear();api.list.mockResolvedValue([{id:'revision',template_id:'t',template_name:'已删除的好组合',revision_hash:'h',created_at:'2026-11-04T08:00:00Z'}]);api.read.mockResolvedValue({id:'t',name:'已删除的好组合',plan:{frozenVersions:[{version:'old-v1'}]}});
 const restore=vi.fn();render(<FishQualityTemplateArchive owner="a" purpose="sell" restore={restore}/>);expect(api.list).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:/系统存档/}));expect(await screen.findByText('已删除的好组合')).toBeVisible();expect(api.list).toHaveBeenCalledWith('a','sell');expect(restore).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'恢复系统存档 已删除的好组合'}));await waitFor(()=>expect(restore).toHaveBeenCalledOnce());expect(api.read).toHaveBeenCalledWith('a','revision');expect(await screen.findByRole('status')).toHaveTextContent('已恢复');
});
it('reports read failure and ignores an old account restore after account switch',async()=>{
 const restoreA=vi.fn();api.list.mockRejectedValueOnce(new Error('offline'));const view=render(<FishQualityTemplateArchive owner="a" purpose="entry" restore={restoreA}/>);fireEvent.click(screen.getByRole('button',{name:/系统存档/}));expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
 api.list.mockResolvedValue([{id:'r',template_id:'t',template_name:'A模板',created_at:'2026-11-04Z'}]);fireEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByText('A模板');let resolve!:(v:any)=>void;api.read.mockImplementation(()=>new Promise(r=>resolve=r));const restoreB=vi.fn();
 fireEvent.click(screen.getByRole('button',{name:'恢复系统存档 A模板'}));view.rerender(<FishQualityTemplateArchive owner="b" purpose="entry" restore={restoreB}/>);await act(async()=>resolve({id:'t',name:'A模板',plan:{preEntryThreeStage:{}}}));expect(restoreA).not.toHaveBeenCalled();expect(restoreB).not.toHaveBeenCalled();expect(screen.queryByText('A模板')).toBeNull();
});
