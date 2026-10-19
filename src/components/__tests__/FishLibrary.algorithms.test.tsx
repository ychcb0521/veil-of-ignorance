import {it,expect,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {FishLibrary} from '@/components/FishLibrary';
import {migrateFishSignal} from '@/lib/fish/records';
import type {TradeSignal} from '@/lib/signalLibrary';
it('鱼行标算法、按完整算法键筛选、工具条只加入当前筛选，并在悬停中给完整快照',()=>{
 const base:TradeSignal={id:'a',symbol:'AAAUSDT',timeMs:123,timeLabel:'2026-10-19 08:00:00',fallbackZone:'',fish:{average:.4,cbi2:.5,startAverage:.35,previousAverage:.25,cutoffMs:123,threshold:.3}};
 const rows=[base,{...base,id:'b',fish:{...base.fish!,threshold:.2}},{...base,id:'c',symbol:'BBBUSDT',fish:{...base.fish!,featureId:'custom',featureShort:'Z'}}],onAdd=vi.fn();
 render(<FishLibrary signals={rows} defaultOpen onAdd={onAdd} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>);
 expect(screen.getAllByText('AAAUSDT')).toHaveLength(2);fireEvent.change(screen.getByLabelText('鱼的算法'),{target:{value:migrateFishSignal(base).fish!.algorithmKey}});expect(screen.getAllByText('AAAUSDT')).toHaveLength(1);expect(screen.queryByText('BBBUSDT')).not.toBeInTheDocument();expect(screen.getByText('AAAUSDT').closest('.group')).toHaveAttribute('title',expect.stringContaining('完整快照'));expect(screen.getByText('CBI-2')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'全部加入信号库'}));expect(onAdd).toHaveBeenCalledWith(['a']);
});
