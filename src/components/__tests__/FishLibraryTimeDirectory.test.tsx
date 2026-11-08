import {useState} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishLibraryTimeDirectory,type FishDirectoryItem} from '../FishLibraryTimeDirectory';
import {newQualityStudy,type FishQualityStudy} from '@/lib/fish/quality';
afterEach(cleanup);
const snapshot=newQualityStudy(1),items:FishDirectoryItem[]=[{id:'one',at:1,label:'本轮',summary:'1 条记录',study:()=>snapshot}];
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
