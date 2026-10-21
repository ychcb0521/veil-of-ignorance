// 【用户要求】2026-10-21「鱼那里的数据只要没删除，就一直要保存，不能轻易删除」：× 紧挨跳转箭头，点一下只变成「确认删除」
import {it,expect,vi} from 'vitest';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {FishLibrary} from '@/components/FishLibrary';
import type {TradeSignal} from '@/lib/signalLibrary';
const s:TradeSignal={id:'a',symbol:'AAAUSDT',timeMs:123,timeLabel:'2026-10-19 08:00:00',fallbackZone:'',fish:{average:.4,cbi2:.5,startAverage:.35,previousAverage:.25,cutoffMs:123,threshold:.3}};
it('点 × 先变成「确认删除」，再点才删；3 秒不点、或点别处就恢复',()=>{
 vi.useFakeTimers();
 try{
  const onDelete=vi.fn();
  render(<FishLibrary title="鱼" signals={[s]} defaultOpen onJump={()=>{}} onDelete={onDelete} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>);
  fireEvent.click(screen.getByTitle('删除该信号'));expect(onDelete).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'确认删除 AAAUSDT'})).toBeInTheDocument();
  act(()=>{vi.advanceTimersByTime(3100);});expect(screen.queryByRole('button',{name:/^确认删除/})).toBeNull();
  fireEvent.click(screen.getByTitle('删除该信号'));fireEvent.blur(screen.getByRole('button',{name:'确认删除 AAAUSDT'}));expect(screen.queryByRole('button',{name:/^确认删除/})).toBeNull();
  fireEvent.click(screen.getByTitle('删除该信号'));fireEvent.click(screen.getByRole('button',{name:'确认删除 AAAUSDT'}));expect(onDelete).toHaveBeenCalledWith('a');
 }finally{vi.useRealTimers();}
});
