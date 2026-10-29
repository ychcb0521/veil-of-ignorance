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
