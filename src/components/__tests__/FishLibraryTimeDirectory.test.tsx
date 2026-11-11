import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishLibraryTimeDirectory,type FishDirectoryItem} from '../FishLibraryTimeDirectory';
import {newQualityStudy,type FishQualityStudy} from '@/lib/fish/quality';
import type {LibraryDirectoryEdits} from '@/lib/fish/libraryDirectoryEdits';
afterEach(cleanup);
it('edits a directory without loading its snapshot, retains failed drafts, and persists a name across remounts',async()=>{
 const read=vi.fn(()=>newQualityStudy(1)),save=vi.fn(async()=>false);let durable:LibraryDirectoryEdits={};
 function Named(){const [edits,setEdits]=useState(durable);return <FishLibraryTimeDirectory name="过滤库" prefix="filter" description="测试" info={null} items={[{id:'one',at:1,label:'默认目录',summary:'1 条记录',study:read}]} edits={edits} recordCount={1} download={vi.fn()} empty="空" onRename={async(id,name)=>{if(!await save())return false;durable={...durable,[id]:{hidden:false,at:0,name,nameAt:1}};setEdits(durable);return true;}}/>;}
 const h=render(<Named/>);fireEvent.click(screen.getByLabelText('打开过滤库'));fireEvent.keyDown(screen.getByLabelText('管理过滤归档 one'),{key:'Enter'});fireEvent.click(await screen.findByRole('menuitem',{name:'编辑名称'}));
 fireEvent.change(screen.getByRole('textbox',{name:'目录名称'}),{target:{value:'  我的过滤结果  '}});fireEvent.click(screen.getByRole('button',{name:'保存名称'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('目录名称未保存'));expect(screen.getByRole('textbox')).toHaveValue('  我的过滤结果  ');
 save.mockResolvedValue(true);fireEvent.click(screen.getByRole('button',{name:'保存名称'}));await waitFor(()=>expect(screen.queryByRole('textbox')).toBeNull());expect(screen.getByText('我的过滤结果')).toBeInTheDocument();expect(read).not.toHaveBeenCalled();
 h.unmount();render(<Named/>);fireEvent.click(screen.getByLabelText('打开过滤库'));expect(screen.getByText('我的过滤结果')).toBeInTheDocument();
 fireEvent.keyDown(screen.getByLabelText('管理过滤归档 one'),{key:'Enter'});fireEvent.click(await screen.findByRole('menuitem',{name:'编辑名称'}));fireEvent.change(screen.getByRole('textbox',{name:'目录名称'}),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'保存名称'}));await waitFor(()=>expect(screen.getByText('默认目录')).toBeInTheDocument());
});
const snapshot=newQualityStudy(1),items:FishDirectoryItem[]=[{id:'one',at:1,label:'本轮',summary:'1 条记录',study:()=>snapshot}];
it('allows multiple directories or a single directory, applies only on confirmation, and restores checked choices on reopen',async()=>{
 const selected=vi.fn(async(_id:string,_study:FishQualityStudy,_ids?:string[])=>true),entries=[items[0],{...items[0],id:'two',at:2,label:'另一轮',study:()=>newQualityStudy(2)}];
 const props={name:'捕捞库',prefix:'mining',description:'测试',info:null,items:entries,recordCount:2,download:vi.fn(),empty:'空',onSelectDirectory:selected};
 const h=render(<FishLibraryTimeDirectory {...props} openRequest={{key:1,selectedIds:['one']}}/>);
 expect(screen.getByLabelText('选择捕捞库目录 本轮 one')).toBeChecked();
 fireEvent.click(screen.getByLabelText('选择捕捞库目录 另一轮 two'));expect(selected).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'应用所选目录（2）'}));await waitFor(()=>expect(selected).toHaveBeenCalledOnce());
 expect(selected.mock.calls[0][2]).toEqual(['two','one']);expect(screen.queryByRole('dialog')).toBeNull();
 h.rerender(<FishLibraryTimeDirectory {...props} openRequest={{key:2,selectedIds:['one','two']}}/>);
 expect(screen.getByLabelText('选择捕捞库目录 本轮 one')).toBeChecked();expect(screen.getByLabelText('选择捕捞库目录 另一轮 two')).toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'清空选择'}));expect(screen.getByRole('button',{name:'应用所选目录（0）'})).toBeDisabled();
 fireEvent.click(screen.getByLabelText('选择捕捞库目录 本轮 one'));fireEvent.click(screen.getByRole('button',{name:'应用所选目录（1）'}));
 await waitFor(()=>expect(selected).toHaveBeenCalledTimes(2));expect(selected.mock.calls[1][2]).toEqual(['one']);expect(snapshot).toEqual(newQualityStudy(1));
});

it('keeps the table when any selected directory fails to read and cancels a pending selection on close',async()=>{
 const selected=vi.fn(async()=>true),bad={...items[0],id:'bad',label:'坏目录',study:async()=>{throw Error('读取失败');}};
 const h=render(<FishLibraryTimeDirectory name="过滤库" prefix="filter" description="" info={null} items={[items[0],bad]} recordCount={2} download={vi.fn()} empty="空" onSelectDirectory={selected}/>);
 fireEvent.click(screen.getByLabelText('打开过滤库'));fireEvent.click(screen.getByLabelText('全选过滤库可见目录'));fireEvent.click(screen.getByRole('button',{name:'应用所选目录（2）'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('读取失败'));expect(selected).not.toHaveBeenCalled();
 h.unmount();let release!:(s:FishQualityStudy)=>void;const pending=new Promise<FishQualityStudy>(resolve=>{release=resolve;});
 render(<FishLibraryTimeDirectory name="过滤库" prefix="filter" description="" info={null} items={[{...items[0],study:()=>pending}]} recordCount={1} download={vi.fn()} empty="空" onSelectDirectory={selected}/>);
 fireEvent.click(screen.getByLabelText('打开过滤库'));fireEvent.click(screen.getByLabelText('全选过滤库可见目录'));fireEvent.click(screen.getByRole('button',{name:'应用所选目录（1）'}));
 fireEvent.click(screen.getByRole('button',{name:'关闭'}));await act(async()=>release(newQualityStudy(3)));expect(selected).not.toHaveBeenCalled();
});
function Harness({copy,hidden}:{copy?:(s:FishQualityStudy)=>Promise<boolean>;hidden:(id:string,value:boolean)=>void}){
 const [edits,setEdits]=useState<Record<string,{hidden:boolean;at:number}>>({});
 return <FishLibraryTimeDirectory name="过滤库" prefix="filter" description="测试" info={<p>说明</p>} items={items} edits={edits} recordCount={1} download={vi.fn()} empty="空目录" renderStudy={()=><p>冻结组合表</p>} onCopyStudy={copy} onSetHidden={async(id,value)=>{hidden(id,value);setEdits(e=>({...e,[id]:{hidden:value,at:1}}));return true;}}/>;
}
function menu(){fireEvent.keyDown(screen.getByLabelText('管理过滤归档 one'),{key:'Enter'});}
it('deletes only after confirmation, restores a directory and keeps its frozen combination table',async()=>{
 const hidden=vi.fn();render(<Harness hidden={hidden}/>);fireEvent.click(screen.getByLabelText('打开过滤库'));fireEvent.click(screen.getByLabelText('打开过滤归档 one'));expect(screen.getByText('冻结组合表')).toBeInTheDocument();
 menu();fireEvent.click(await screen.findByRole('menuitem',{name:'删除目录'}));expect(hidden).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认删除目录'}));
 await waitFor(()=>expect(screen.queryByTestId('filter-archive-item')).toBeNull());expect(hidden).toHaveBeenLastCalledWith('one',true);
 fireEvent.click(screen.getByRole('checkbox',{name:'显示已删除目录（1）'}));menu();fireEvent.click(await screen.findByRole('menuitem',{name:'恢复目录'}));await waitFor(()=>expect(hidden).toHaveBeenLastCalledWith('one',false));
 fireEvent.click(screen.getByLabelText('打开过滤归档 one'));expect(screen.getByText('冻结组合表')).toBeInTheDocument();expect(snapshot).toEqual(newQualityStudy(1));
});
it('reports a failed copy without closing the directory or discarding the selected snapshot',async()=>{
 const copy=vi.fn().mockResolvedValue(false);render(<Harness hidden={vi.fn()} copy={copy}/>);fireEvent.click(screen.getByLabelText('打开过滤库'));fireEvent.click(screen.getByLabelText('打开过滤归档 one'));fireEvent.click(screen.getByRole('button',{name:'复制至组合表'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('当前总表仍保留'));expect(screen.getByText('冻结组合表')).toBeInTheDocument();expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('ignores a late archive read after the user has selected another directory',async()=>{
 let resolve!:(s:FishQualityStudy)=>void;const pending=new Promise<FishQualityStudy>(r=>{resolve=r;});
 const entries=[{...items[0],study:()=>pending},{...items[0],id:'two',at:2,label:'另一轮',study:()=>newQualityStudy(2)}];
 render(<FishLibraryTimeDirectory name="筛选库" prefix="screen" description="测试" info={null} items={entries} recordCount={2} download={vi.fn()} empty="空" renderStudy={s=><p>冻结时间 {s.startedAt}</p>}/>);
 fireEvent.click(screen.getByLabelText('打开筛选库'));fireEvent.click(screen.getByLabelText('打开筛选归档 one'));fireEvent.click(screen.getByLabelText('打开筛选归档 two'));expect(screen.getByText('冻结时间 2')).toBeInTheDocument();resolve(newQualityStudy(99));
 await waitFor(()=>expect(screen.queryByText('冻结时间 99')).toBeNull());
});
