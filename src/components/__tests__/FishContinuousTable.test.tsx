import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {FishContinuousTable} from '../FishContinuousTable';
const items=Array.from({length:1000},(_,i)=>({id:String(i)}));
const props={getKey:(item:{id:string})=>item.id,columns:1,resetKey:'all',label:'连续列表',testId:'continuous',header:<tr><th>记录</th></tr>,estimate:72};
const row=(item:{id:string})=><tr><td><button>{item.id}</button><details><summary>详情 {item.id}</summary><p>完整历史公式</p></details></td></tr>;
beforeEach(()=>{
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){return {height:this.tagName==='TR'?(this.querySelector('details[open]')?400:72):400,width:800,top:0,bottom:400,left:0,right:800,x:0,y:0,toJSON(){}};});
 vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(400);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('uses a bounded number of rows while scrolling through 1,000 records without page controls',async()=>{
 render(<FishContinuousTable {...props} items={items} row={row}/>);const host=screen.getByTestId('continuous');
 expect(host.querySelector('table')).toHaveAttribute('aria-rowcount','1001');expect(host.querySelectorAll('[data-continuous-row]').length).toBeLessThan(40);
 for(const index of [60,500,990]){fireEvent.scroll(host,{target:{scrollTop:index*72}});await waitFor(()=>expect(host.querySelector(`[data-continuous-row="${index}"]`)).toBeInTheDocument());expect(host.querySelectorAll('[data-continuous-row]').length).toBeLessThan(40);}
 expect(host.querySelector('[data-continuous-row="999"]')).toBeInTheDocument();
});
it('resets scroll for a changed filter and handles an empty result',async()=>{
 const view=render(<FishContinuousTable {...props} items={items} row={row}/>),host=screen.getByTestId('continuous');fireEvent.scroll(host,{target:{scrollTop:500*72}});await waitFor(()=>expect(host.querySelector('[data-continuous-row="500"]')).toBeInTheDocument());
 view.rerender(<FishContinuousTable {...props} resetKey="search" items={items.slice(5,7)} row={row}/>);expect(host.scrollTop).toBe(0);expect(host.querySelectorAll('[data-continuous-row]')).toHaveLength(2);
 view.rerender(<FishContinuousTable {...props} resetKey="empty" items={[]} row={row} empty={<p>没有匹配记录</p>}/>);expect(screen.getByText('没有匹配记录')).toBeInTheDocument();expect(host.querySelectorAll('[data-continuous-row]')).toHaveLength(0);
});
it('keeps the same record at the same offset as earlier results arrive or are removed',async()=>{
 const view=render(<FishContinuousTable {...props} items={items} row={row}/>),host=screen.getByTestId('continuous');fireEvent.scroll(host,{target:{scrollTop:500*72+12}});await waitFor(()=>expect(host.querySelector('[data-continuous-row="500"]')).toBeInTheDocument());
 view.rerender(<FishContinuousTable {...props} items={[{id:'new'},...items]} row={row}/>);expect(host.scrollTop).toBe(501*72+12);
 view.rerender(<FishContinuousTable {...props} items={items.slice(1)} row={row}/>);expect(host.scrollTop).toBe(499*72+12);
});
it('preserves expanded history across scrolling and releases it when collapsed',async()=>{
 render(<FishContinuousTable {...props} items={items} row={row}/>);const host=screen.getByTestId('continuous'),detail=host.querySelector('[data-continuous-row="5"] details') as HTMLDetailsElement;detail.open=true;fireEvent(detail,new Event('toggle'));
 await waitFor(()=>expect(detail.open).toBe(true));fireEvent.scroll(host,{target:{scrollTop:500*72}});await waitFor(()=>expect(host.querySelector('[data-continuous-row="500"]')).toBeInTheDocument());expect(detail).toBeInTheDocument();expect(detail.open).toBe(true);
 detail.open=false;fireEvent(detail,new Event('toggle'));await waitFor(()=>expect(host.querySelector('[data-continuous-row="5"]')).not.toBeInTheDocument());
});
it('preserves keyboard focus beyond the scroll window and releases offscreen rows on blur',async()=>{
 render(<FishContinuousTable {...props} items={items} row={row}/>);const host=screen.getByTestId('continuous'),button=host.querySelector('[data-continuous-row="5"] button')!;fireEvent.focus(button);fireEvent.scroll(host,{target:{scrollTop:500*72}});await waitFor(()=>expect(host.querySelector('[data-continuous-row="500"]')).toBeInTheDocument());expect(button).toBeInTheDocument();
 fireEvent.blur(button,{relatedTarget:document.body});await waitFor(()=>expect(host.querySelector('[data-continuous-row="5"]')).not.toBeInTheDocument());
});
