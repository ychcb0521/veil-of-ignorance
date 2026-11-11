import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FishWickDetails } from '../FishWickDetails';
import { initialFishProgress } from '@/lib/fishScanner';
import type { FishWickRejection } from '@/lib/fish/downwardWick';
const cut=Date.UTC(2026,9,29,2),time=cut-600000;
const evidence:FishWickRejection={symbol:'WICKUSDT',exchange:'binance',cutoffMs:cut,rule:{enabled:true,hours:48,atrMultiple:3},openTime:time,open:100,high:101,low:91,close:92,drop:9,atr:2,
 candles:[{openTime:time-300000,open:100,high:101,low:99,close:100},{openTime:time,open:100,high:101,low:91,close:92}]};
beforeEach(()=>vi.clearAllMocks());
it('opens frozen rejection details, the exact candle snapshot and the historical chart at its close',()=>{
 const onJump=vi.fn();render(<FishWickDetails progress={{...initialFishProgress(),wickSkipped:1,wickDetails:[evidence]}} onJump={onJump} jumpingSignalId={null}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看插针过滤详情（1 个）'}));
 expect(screen.getByText(/扫描中，明细持续更新/)).toBeInTheDocument();
 const table=screen.getByRole('table',{name:'插针过滤明细'});expect(within(table).getByText('−9.00%')).toBeInTheDocument();expect(within(table).getByText('4.50×')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'查看 WICKUSDT 币安 的触发 K 线'}));
 expect(screen.getByRole('img',{name:/WICKUSDT 币安 原始 5 分钟/})).toBeInTheDocument();
 expect(screen.getByTestId('fish-wick-reason')).toHaveTextContent('ATR(14) 2 × 3 = 6');
 fireEvent.click(screen.getByRole('button',{name:'打开历史盘面'}));
 expect(onJump).toHaveBeenCalledWith(expect.objectContaining({symbol:'WICKUSDT',exchange:'binance',timeMs:time+300000}));
 expect(onJump.mock.calls[0][0].fish).toBeUndefined();
});
it('reflects new live records, searches and uses frozen thresholds after settings change',()=>{
 const view=render(<FishWickDetails progress={{...initialFishProgress(),wickSkipped:1,wickDetails:[evidence]}} jumpingSignalId={null}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看插针过滤详情（1 个）'}));
 const other={...evidence,symbol:'OTHERUSDT',rule:{...evidence.rule,atrMultiple:1.5}};
 view.rerender(<FishWickDetails progress={{...initialFishProgress(),wickSkipped:2,wickDetails:[evidence,other]}} jumpingSignalId={null}/>);
 expect(screen.getByRole('table')).toHaveTextContent('OTHERUSDT');
 fireEvent.change(screen.getByLabelText('搜索插针过滤标的或交易所'),{target:{value:'OTHER'}});
 expect(screen.getByRole('table')).not.toHaveTextContent('WICKUSDT');
 fireEvent.click(screen.getByRole('button',{name:'查看 OTHERUSDT 币安 的触发 K 线'}));
 expect(screen.getByTestId('fish-wick-reason')).toHaveTextContent('2 × 1.5 = 3');
 const toggle=screen.getByRole('button',{name:'过滤门槛'});
 expect(toggle).toHaveAttribute('aria-expanded','false');
 fireEvent.click(toggle);
 const gates=within(screen.getByRole('region',{name:'过滤门槛'}));
 expect(gates.getByRole('list',{name:'插针门槛'})).toHaveTextContent('本轮回看 48 小时');
 expect(gates.getByRole('list',{name:'插针门槛'})).toHaveTextContent('ATR(14) × 1.5');
 expect(within(gates.getByRole('list',{name:'成交额门槛'})).getAllByRole('listitem').map(row=>row.textContent)).toEqual([
   '1 小时成交额≥ 100 万 USDT','12 小时成交额≥ 800 万 USDT','24 小时成交额≥ 1,000 万 USDT',
 ]);
 fireEvent.click(toggle);
 expect(screen.queryByRole('region',{name:'过滤门槛'})).toBeNull();
});
it('legacy counts never invent symbols or candle times',()=>{
 render(<FishWickDetails progress={{...initialFishProgress(),wickSkipped:20}} jumpingSignalId={null}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看插针过滤详情（20 个）'}));
 expect(screen.getByTestId('fish-wick-legacy')).toHaveTextContent('20 条旧版记录仅保存了过滤数量');
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('non-Binance snapshots identify their source; no mapped symbol never opens a different market',()=>{
 render(<FishWickDetails progress={{...initialFishProgress(),wickSkipped:1,wickDetails:[{...evidence,exchange:'okx',binanceSymbol:null}]}} onJump={vi.fn()} jumpingSignalId={null}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看插针过滤详情（1 个）'}));fireEvent.click(screen.getByRole('button',{name:'查看 WICKUSDT OKX 的触发 K 线'}));
 expect(screen.getByRole('img',{name:/OKX 原始/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/打开.*盘面/})).not.toBeInTheDocument();
 expect(screen.getByText(/此标的暂无可用的币安盘面/)).toBeInTheDocument();
});

it('switches to actual turnover readings, searches by symbol and marks every failed window',()=>{
 const details=[{
   symbol:'LOWUSDT',exchange:'binance' as const,stage:'signal-start' as const,at:cut,
   checks:[{hours:1,min:1e6,value:600_000,ok:false},{hours:12,min:8e6,value:9e6,ok:true},{hours:24,min:1e7,value:9.5e6,ok:false}],
   algorithms:['CBI-2·avg > 0.07'],
 }];
 render(<FishWickDetails progress={{...initialFishProgress(),wickSkipped:1,wickDetails:[evidence],thin:1,turnoverDetails:details}} jumpingSignalId={null}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看插针过滤详情（1 个）'}));
 const tabs=within(screen.getByRole('group',{name:'过滤类型'}));
 fireEvent.click(tabs.getByRole('button',{name:/成交额过滤/}));
 const table=within(screen.getByRole('table',{name:'成交额过滤'}));
 expect(table.getByText('LOWUSDT')).toBeInTheDocument();
 expect(table.getByText('信号起点')).toBeInTheDocument();
 expect(table.getByText('600,000')).toHaveAttribute('title','实际 600000 USDT · 门槛 ≥ 1000000 USDT');
 expect(table.getByText('1h、24h')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('搜索成交额过滤标的或交易所'),{target:{value:'no-match'}});
 expect(table.queryByText('LOWUSDT')).toBeNull();
 expect(screen.getByText('没有匹配的记录')).toBeInTheDocument();
});
it('opens a count-only turnover round directly without filling in missing amounts',()=>{
 render(<FishWickDetails progress={{...initialFishProgress(),thin:3}} jumpingSignalId={null}/>);
 expect(screen.queryByTestId('fish-wick-skipped')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'查看成交额过滤详情（3 个）'}));
 expect(screen.getByRole('note')).toHaveTextContent('3 个标的仅保存了过滤数量');
 expect(screen.queryByRole('table',{name:'成交额过滤'})).toBeNull();
});
