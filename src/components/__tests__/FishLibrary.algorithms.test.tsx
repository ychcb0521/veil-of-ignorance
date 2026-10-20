import {it,expect,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {FishLibrary} from '@/components/FishLibrary';
import {migrateFishSignal} from '@/lib/fish/records';
import type {TradeSignal} from '@/lib/signalLibrary';
it.each(['新鱼','鱼'])('%s 行标算法、按完整算法键筛选，且不显示完整快照悬停框',(title)=>{
 const base:TradeSignal={id:'a',symbol:'AAAUSDT',timeMs:123,timeLabel:'2026-10-19 08:00:00',fallbackZone:'',fish:{average:.4,cbi2:.5,startAverage:.35,previousAverage:.25,cutoffMs:123,threshold:.3}};
 const rows=[base,{...base,id:'b',fish:{...base.fish!,threshold:.2}},{...base,id:'c',symbol:'BBBUSDT',fish:{...base.fish!,featureId:'custom',featureShort:'Z'}}],onAdd=vi.fn();
 render(<FishLibrary title={title} signals={rows} defaultOpen onAdd={onAdd} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>);
 expect(screen.getAllByText('AAAUSDT')).toHaveLength(2);fireEvent.change(screen.getByLabelText(`${title}的算法`),{target:{value:migrateFishSignal(base).fish!.algorithmKey}});expect(screen.getAllByText('AAAUSDT')).toHaveLength(1);expect(screen.queryByText('BBBUSDT')).not.toBeInTheDocument();expect(screen.getByText('AAAUSDT').closest('.group')).not.toHaveAttribute('title');expect(screen.getByText('CBI-2')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'全部加入信号库'})).not.toBeInTheDocument();expect(document.querySelector('[title*="完整快照"]')).toBeNull();expect(onAdd).not.toHaveBeenCalled();
});
