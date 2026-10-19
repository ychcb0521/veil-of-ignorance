import {it,expect,vi} from 'vitest';
import {render,screen,within,fireEvent} from '@testing-library/react';
import {SignalLibraryHeader,SIGNAL_LIBRARY_GRID} from '@/components/SignalLibraryHeader';
import {SignalLibraryList} from '@/components/SignalLibraryList';
import {FishLibrary} from '@/components/FishLibrary';
import type {TradeSignal} from '@/lib/signalLibrary';
const coin:TradeSignal={id:'coin',symbol:'COINUSDT',timeMs:1000,timeLabel:'2026-10-19 10:00:00',fallbackZone:'1.2 ~ 3.4'};
const stock:TradeSignal={...coin,id:'stock',market:'us_stock',underlying:'COIN',exchange:'bitget'};
it('信号库、鱼、新鱼同一市场列和列宽；美股跳转禁用，评分/删除/加入仍可操作',()=>{
 const onJump=vi.fn(),onDelete=vi.fn(),onRate=vi.fn(),onAdd=vi.fn(),props={tradedDayIndex:new Set<string>(),campaignDayIndex:new Set<string>(),jumpingSignalId:null,onJump,onDelete,onRate};
 render(<><section data-testid="main-library"><SignalLibraryHeader sortKey="symbol" sortDir="asc" onSort={()=>{}}/><SignalLibraryList rows={[coin,stock]} resetKey="market" {...props}/></section><FishLibrary signals={[coin,stock]} defaultOpen title="鱼" {...props} onAdd={onAdd}/><FishLibrary signals={[coin,stock]} defaultOpen title="新鱼" {...props} onAdd={onAdd}/></>);
 const headers=screen.getAllByTestId('signal-library-header');expect(headers).toHaveLength(3);for(const h of headers){expect(h.className).toContain(SIGNAL_LIBRARY_GRID);expect(h.children[2]).toHaveTextContent('兜底区');expect(h.children[3]).toHaveTextContent('市场');}
 const rows=screen.getAllByTestId('signal-library-row');expect(rows).toHaveLength(6);for(const r of rows)expect(r.className).toContain(SIGNAL_LIBRARY_GRID);
 const stocks=rows.filter(r=>within(r).queryByText('美股'));expect(stocks).toHaveLength(3);for(const r of stocks){const buttons=within(r).getAllByTitle('盘面只支持币安行情');expect(buttons).toHaveLength(2);for(const b of buttons){expect(b).toBeDisabled();fireEvent.click(b);}fireEvent.click(within(r).getByRole('radio',{name:'4 星'}));fireEvent.click(within(r).getByTitle('删除该信号'));}
 expect(onJump).not.toHaveBeenCalled();expect(onRate).toHaveBeenCalledWith('stock',4);expect(onDelete).toHaveBeenCalledWith('stock');fireEvent.click(within(stocks[1]).getByRole('button',{name:'加入信号库'}));expect(onAdd).toHaveBeenCalledWith('stock');
});
it('同一行从币改为美股会刷新市场与跳转状态，不复用同名币已交易标记',()=>{
 const props={tradedDayIndex:new Set(['COINUSDT@2026-10-19']),campaignDayIndex:new Set<string>(),jumpingSignalId:null,onJump:vi.fn(),onDelete:vi.fn(),onRate:vi.fn()};const view=render(<SignalLibraryList rows={[coin]} resetKey="same" {...props}/>);expect(screen.queryByText('美股')).not.toBeInTheDocument();view.rerender(<SignalLibraryList rows={[{...stock,id:'coin'}]} resetKey="same" {...props}/>);expect(screen.getByText('美股')).toBeVisible();expect(screen.getAllByTitle('盘面只支持币安行情').every(b=>(b as HTMLButtonElement).disabled)).toBe(true);expect(screen.queryByLabelText('信号当日已交易')).not.toBeInTheDocument();
});
