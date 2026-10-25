import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {FishLibrary} from '@/components/FishLibrary';
import type {TradeSignal} from '@/lib/signalLibrary';
const rows:TradeSignal[]=Array.from({length:100},(_,i)=>({id:`row-${i}`,symbol:`C${String(i).padStart(3,'0')}USDT`,timeMs:Date.UTC(2026,9,25)+i*300000,timeLabel:'2026-10-25',fallbackZone:'',fish:{featureId:'state',featureShort:'S',statistic:i%2?'state':'avg_state_2',average:.71,cbi2:.71,startAverage:.71,previousAverage:.69,cutoffMs:1,threshold:.7}}));
const jump=vi.fn();
const library=(key:string,title='新鱼',signals=rows)=><FishLibrary title={title} rememberViewKey={key} signals={signals} defaultOpen onJump={jump} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;
beforeEach(()=>{sessionStorage.clear();localStorage.clear();jump.mockClear();});
it.each(['新鱼','鱼舱'])('%s 返回时保留月份、搜索、算法筛选、降序排序和滚动位置',async title=>{
 const view=render(library(title,title));
 fireEvent.change(screen.getByLabelText(`${title}的月份`),{target:{value:'2026-10'}});
 fireEvent.change(screen.getByLabelText(`${title}的算法`),{target:{value:'S·avg₂'}});
 fireEvent.change(screen.getByLabelText(`筛选${title}信号`),{target:{value:'C'}});
 fireEvent.click(screen.getByTestId('signal-sort-标的'));fireEvent.click(screen.getByTestId('signal-sort-标的'));
 const list=screen.getByTestId('signal-library-scroller');list.scrollTop=505;fireEvent.scroll(list);
 await waitFor(()=>expect(screen.getByText('C058USDT')).toBeInTheDocument());fireEvent.click(screen.getByText('C058USDT'));
 expect(jump).toHaveBeenCalledWith('row-58');view.unmount();
 render(library(title,title));
 expect(screen.getByLabelText(`${title}的月份`)).toHaveValue('2026-10');expect(screen.getByLabelText(`${title}的算法`)).toHaveValue('S·avg₂');expect(screen.getByLabelText(`筛选${title}信号`)).toHaveValue('C');
 expect(screen.getByTestId('signal-sort-标的')).toHaveAttribute('aria-sort','descending');
 expect(screen.getByTestId('signal-library-scroller').scrollTop).toBe(505);expect(screen.getByText('C058USDT')).toBeInTheDocument();
});
it('返回时上面有新增行，仍定位到原来的鱼；新鱼与鱼舱、不同账号的视图不混用',async()=>{
 const view=render(library('alice-new'));
 const list=screen.getByTestId('signal-library-scroller');list.scrollTop=505;fireEvent.scroll(list);view.unmount();
 const newer={...rows[0],id:'new',symbol:'NEWUSDT',timeMs:rows.at(-1)!.timeMs+300000};
 const restored=render(library('alice-new','新鱼',[newer,...rows]));
 expect(screen.getByTestId('signal-library-scroller').scrollTop).toBe(530);restored.unmount();
 const other=render(library('alice-old','鱼舱'));expect(screen.getByTestId('signal-library-scroller').scrollTop).toBe(0);other.unmount();
 render(library('bob-new'));expect(screen.getByTestId('signal-library-scroller').scrollTop).toBe(0);
});
it('损坏的视图缓存不影响打开列表',()=>{
 sessionStorage.setItem('veil.fish.view.v1:bad','null');render(library('bad'));expect(screen.getByTestId('signal-library-scroller')).toBeInTheDocument();
});

it.each([['信号时间','time','descending'],['标的','symbol','ascending'],['评分','quality','descending'],['算法类型','algorithm','ascending']])('返回时仍使用原来的 %s 排序', (label,key,dir)=>{
 const view=render(library('sort'));
 if(key!=='time')fireEvent.click(screen.getByTestId(`signal-sort-${label}`));
 expect(screen.getByTestId(`signal-sort-${label}`)).toHaveAttribute('aria-sort',dir);view.unmount();
 render(library('sort'));expect(screen.getByTestId(`signal-sort-${label}`)).toHaveAttribute('aria-sort',dir);
});

it('列表次序未变时精确恢复像素位置，不因首次行高测量的舍入误差向上漂移',()=>{
 sessionStorage.setItem('veil.fish.view.v1:precise',JSON.stringify({open:true,sortKey:'time',sortDir:'desc',scroll:{top:505,anchorId:'row-79',index:20,offset:-5}}));
 render(library('precise'));expect(screen.getByTestId('signal-library-scroller').scrollTop).toBe(505);
});
