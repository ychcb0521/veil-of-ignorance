import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { QualitySellTiming } from '@/components/journal/QualitySellEvidence';
import type { TradeCampaign } from '@/types/journal';
afterEach(cleanup);
const evidence: NonNullable<TradeCampaign['comparison']>['sellEvidence'] = {
  formula:'state=C',definitionKey:'frozen',featureId:'state',metric:'state',version:'frozen',interval:'5m',halfLifeHours:6,avgHours:24,source:'account',
  direction:'<',threshold:.5,reading:.492941490,confirmedAt:Date.parse('2026-04-02T17:35:00+08:00'),
  executedAt:Date.parse('2026-04-02T17:35:00+08:00'),
};
it('distinguishes the plotted candle start from close confirmation and the execution minute',()=>{
  render(<QualitySellTiming evidence={evidence}/>);
  const text=screen.getByTestId('quality-sell-timing').textContent!;
  expect(text).toContain('5m 收盘确认');
  expect(text).toContain('2026-04-02 17:30:00 → 2026-04-02 17:35:00');
  expect(text).toContain('0.492941490 < 0.5');
  expect(text).toContain('指标连线不表示盘中首次达标');
  expect(text).toContain('2026-04-02 17:35:00 起的 1 分钟 K 线开盘价成交');
});
it('does not invent a trigger window for open positions or an unknown calendar interval',()=>{
  const view=render(<QualitySellTiming evidence={{...evidence,confirmedAt:undefined}}/>);
  expect(screen.queryByTestId('quality-sell-timing')).toBeNull();
  view.rerender(<QualitySellTiming evidence={{...evidence,interval:'1M'}}/>);
  expect(screen.queryByTestId('quality-sell-timing')).toBeNull();
});

it('shows the observed intrabar sample and distinguishes a confirmed trigger from a fill',()=>{
 const pending={...evidence,execution:'intrabar-1m' as const,confirmedAt:Date.parse('2026-04-02T17:34:00+08:00'),executedAt:undefined,barOpenAt:Date.parse('2026-04-02T17:30:00+08:00'),previousAt:Date.parse('2026-04-02T17:33:00+08:00'),previousReading:.677442381,reading:.497502894};
 const view=render(<QualitySellTiming evidence={pending}/>);
 expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('首次达标：2026-04-02 17:34:00');
 expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('前次：2026-04-02 17:33:00');
 expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('尚未记为成交');
 view.rerender(<QualitySellTiming evidence={{...pending,executedAt:pending.confirmedAt}}/>);
 expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('2026-04-02 17:34:00 起的 1 分钟 K 线开盘价成交');
 expect(screen.getByTestId('quality-sell-timing')).not.toHaveTextContent('尚未记为成交');
});
it('identifies a drawdown veto using its own threshold, rather than the unrelated primary indicator threshold',()=>{
 render(<QualitySellTiming evidence={{...evidence,execution:'intrabar-1m',reading:12,triggerCause:{id:'v',kind:'static-drawdown',label:'持仓过程静态最大回撤',direction:'>=',threshold:10}}}/>);
 const text=screen.getByTestId('quality-sell-timing');expect(text).toHaveTextContent('一票否决 · 持仓过程静态最大回撤');expect(text).toHaveTextContent('12.0000000 >= 10%');expect(text).not.toHaveTextContent('12.0000000 < 0.5');
});

it('labels minute fall vetoes with their rolling price window instead of the ordinary indicator period',()=>{
 render(<QualitySellTiming evidence={{...evidence,reading:4,triggerCause:{id:'fall',label:'5分钟内跌幅',kind:'drop-5m',direction:'>=',threshold:3},barOpenAt:Date.parse('2026-04-02T17:30:00+08:00')}}/>);
 expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('5分钟内跌幅 · 分钟收盘确认');
 expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('普通指标副图不用于核对这一跌幅读数');
});
