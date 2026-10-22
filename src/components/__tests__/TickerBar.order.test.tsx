// 【用户要求】2026-10-22「24 小时成交量和 24 小时成交额，与 24 小时最高和 24 小时最低的位置换一下」
import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
vi.mock('@/contexts/TradingContext',()=>({useTradingContext:()=>({getSymbolSettlementMode:()=>'usdt'})}));
const {TickerBar}=await import('@/components/TickerBar');
it('24h 统计顺序：涨跌 → 成交量 → 成交额 → 最高 → 最低',()=>{
 const T=Date.UTC(2026,9,22);
 const bars=Array.from({length:10},(_,i)=>({time:T+i*3e5,open:1,high:1.2,low:0.9,close:1.1,volume:100}));
 render(<TickerBar symbol="ARIAUSDT" currentPrice={1.1} visibleData={bars as any} pricePrecision={4} effectiveSimTime={T}/>);
 const labels=['24h 涨跌','24h 成交量(ARIA)','24h 成交额(USDT)','24h 最高','24h 最低'].map(t=>screen.getByText(t));
 for(let i=1;i<labels.length;i++)expect(labels[i-1].compareDocumentPosition(labels[i])&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('24h 成交量 = 各根币量之和（价格低于 1 时不再和成交额显示成同一个数）',()=>{
 const T=Date.UTC(2026,9,22);
 const bars=Array.from({length:10},(_,i)=>({time:T+i*3e5,open:0.06,high:0.07,low:0.05,close:0.06,volume:1_000_000}));
 render(<TickerBar symbol="ARIAUSDT" currentPrice={0.06} visibleData={bars as any} pricePrecision={4} effectiveSimTime={T}/>);
 expect(screen.getByText('24h 成交量(ARIA)').nextElementSibling).toHaveTextContent('10.00M');
 expect(screen.getByText('24h 成交额(USDT)').nextElementSibling).toHaveTextContent('600.00K');
});
