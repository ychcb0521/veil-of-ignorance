import {it,expect} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {FishLibrary} from '@/components/FishLibrary';
import type {TradeSignal} from '@/lib/signalLibrary';
// 【用户要求】2026-10-20「标的的名称不能缩略…把具体是哪个算法捕捞到的专门开设一列（算法类型），替换掉兜底区」「算法类型那一列要能够实现选择和排序功能」
it.each(['新鱼','鱼舱'])('%s：标的列只放完整标的名；「算法类型」列写捕到它的算法，可按算法类型筛选与排序；不显示完整快照悬停框',(title)=>{
 const base:TradeSignal={id:'a',symbol:'AAAUSDT',timeMs:123,timeLabel:'2026-10-19 08:00:00',fallbackZone:'',fish:{average:.4,cbi2:.5,startAverage:.35,previousAverage:.25,cutoffMs:123,threshold:.3}};
 const union:TradeSignal={...base,id:'u',symbol:'UUUUSDT',timeMs:200,fish:{...base.fish!,combination:'or',hitAlgorithms:[2],algorithmKey:'any(x)',algorithms:[{...base.fish!,featureShort:'CBI-2'},{...base.fish!,featureShort:'CBA'}]}};
 const both:TradeSignal={...base,id:'n',symbol:'NNNUSDT',timeMs:300,fish:{...base.fish!,combination:'and',algorithmKey:'x&y',algorithms:[{...base.fish!,featureShort:'CBI-2'},{...base.fish!,featureShort:'BSS'}]}};
 const rows=[base,{...base,id:'c',symbol:'BBBUSDT',fish:{...base.fish!,featureId:'custom',featureShort:'Z'}},union,both];
 render(<FishLibrary title={title} signals={rows} defaultOpen onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>);
 const types=()=>screen.getAllByTestId('fish-algorithm-type').map(e=>e.textContent);
 expect(screen.getByText('UUUUSDT').textContent).toBe('UUUUSDT');
 // 默认按信号时间，最近的在上面（2026-10-21）
 expect(screen.getAllByTestId('fish-algorithm-type').map(e=>e.closest('.group')!.textContent!.slice(0,7))).toEqual(['NNNUSDT','UUUUSDT','AAAUSDT','BBBUSDT'].map(x=>x.slice(0,7)));
 expect(types()).toEqual(['CBI-2 · BSS','CBA','CBI-2','Z']);
 const select=screen.getByLabelText(`${title}的算法`);expect([...select.querySelectorAll('option')].map(o=>o.textContent)).toEqual(['全部算法类型','BSS','CBA','CBI-2','Z']);
 fireEvent.change(select,{target:{value:'CBI-2'}});expect(types()).toEqual(['CBI-2 · BSS','CBI-2']);
 fireEvent.change(select,{target:{value:''}});fireEvent.click(screen.getByTestId('signal-sort-算法类型'));expect(types()).toEqual(['CBA','CBI-2','CBI-2 · BSS','Z']);
 fireEvent.click(screen.getByTestId('signal-sort-算法类型'));expect(types()).toEqual(['Z','CBI-2 · BSS','CBI-2','CBA']);
 expect(screen.getByText('AAAUSDT').closest('.group')).not.toHaveAttribute('title');
 // 2026-10-21「我不喜欢这个黑框」：算法类型格不再弹系统提示；列表开关不画焦点框
 for(const c of screen.getAllByTestId('fish-algorithm-type'))expect(c).not.toHaveAttribute('title');
 expect(screen.getByRole('button',{name:new RegExp(`^${title}`)}).className).toContain('outline-none');expect(document.querySelector('[title*="完整快照"]')).toBeNull();expect(screen.queryByRole('button',{name:'加入信号库'})).not.toBeInTheDocument();
});

it('新鱼中的原值 S、avg_S 及同时命中都明确区分，并可分别筛选',()=>{
 localStorage.clear();
 const row=(statistic:string,id:string):TradeSignal=>({id,symbol:`${id}USDT`,timeMs:1,timeLabel:'',fallbackZone:'',fish:{featureId:'state',featureShort:'S',statistic,average:.71,cbi2:.71,startAverage:.71,previousAverage:.69,cutoffMs:1,threshold:.7}});
 const raw=row('state','RAW'),avg=row('avg_state_2','AVG');
 const both={...raw,id:'both',symbol:'BOTHUSDT',fish:{...raw.fish!,algorithms:[raw.fish!,avg.fish!],combination:'or' as const,hitAlgorithms:[1,2]}};
 render(<FishLibrary title="新鱼" signals={[raw,avg,both]} defaultOpen onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>);
 const types=()=>screen.getAllByTestId('fish-algorithm-type').map(e=>e.textContent);
 expect(types().sort()).toEqual(['S 原值','avg_S','S 原值 · avg_S'].sort());
 fireEvent.change(screen.getByLabelText('新鱼的算法'),{target:{value:'avg_S'}});
 expect(types().sort()).toEqual(['avg_S','S 原值 · avg_S'].sort());
 fireEvent.change(screen.getByLabelText('新鱼的算法'),{target:{value:'S 原值'}});
 expect(types().sort()).toEqual(['S 原值','S 原值 · avg_S'].sort());
});
