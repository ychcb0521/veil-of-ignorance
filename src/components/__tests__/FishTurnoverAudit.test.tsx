// 【用户要求】2026-10-21「捕捉到的一些标的存在 24 小时交易额小于 1000w USDT…请你想办法解决」：复核库里的鱼，列出不达标的，确认后删除
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FishTurnoverAudit } from '@/components/FishTurnoverAudit';
import { auditFishTurnover } from '@/lib/fish/turnoverAudit';
const T = Date.UTC(2026, 9, 20, 20, 55);
const fish = (symbol: string, exchange?: string) => ({ id: `fish-${symbol}`, symbol, timeMs: T, timeLabel: '', fallbackZone: '', ...(exchange ? { exchange } : {}) }) as any;
const w = (h24: number, h12 = 9e6, h1 = 2e6) => ({ 24: h24, 12: h12, 6: 0, 4: 0, 2: 0, 1: h1 });
const rows = [
  { symbol: 'CVXUSDT', timeMs: T, windows: w(9.04e6), hours: 24 },
  { symbol: 'OKUSDT', timeMs: T, windows: w(2e7), hours: 24 },
  { symbol: 'GATEUSDT', exchange: 'gate', timeMs: T, windows: w(2e7, 9e6, 5e5), hours: 24 },
  { symbol: 'NEWUSDT', timeMs: T, windows: w(2e7), hours: 6 },
  { symbol: 'ERRUSDT', timeMs: T, windows: null, hours: 0, reason: '请求失败' },
] as any[];
const list = [fish('CVXUSDT'), fish('OKUSDT'), fish('GATEUSDT', 'gate'), fish('NEWUSDT'), fish('ERRUSDT')];

it('按信号前 1h / 12h / 24h 门槛判定，按交易所对上号', () => {
  const v = auditFishTurnover(list, rows);
  expect(v.get('fish-CVXUSDT')).toEqual({ ok: false, text: '24h 成交额 904 万 < 1000 万' });
  expect(v.get('fish-OKUSDT')!.ok).toBe(true);
  expect(v.get('fish-GATEUSDT')).toEqual({ ok: false, text: '1h 成交额 50 万 < 100 万' });
  expect(v.get('fish-NEWUSDT')!.ok).toBe(false);
  expect(v.get('fish-ERRUSDT')).toEqual({ ok: null, text: '请求失败' });
});
it('点「复核成交额」不存进信号库统计；列出不达标的，两步确认后逐条删除', async () => {
  const onTurnover = vi.fn(async (o: any) => { o.onProgress({ status: 'complete', done: 5, total: 5, current: '' }); return { rows } as any; });
  const onDelete = vi.fn(), onJump = vi.fn();
  render(<FishTurnoverAudit fish={list} onTurnover={onTurnover} onDelete={onDelete} onJump={onJump} />);
  fireEvent.click(screen.getByRole('button', { name: '复核成交额' }));
  await waitFor(() => expect(screen.getByTestId('fish-turnover-audit-summary')).toHaveTextContent('查了 5 条，3 条信号前成交额不达标，1 条取不到数'));
  expect(onTurnover.mock.calls[0][0].save).toBe(false);
  expect(screen.getByTestId('fish-turnover-failed')).toHaveTextContent('CVXUSDT');
  fireEvent.click(screen.getByRole('button', { name: 'CVXUSDT' }));
  expect(onJump).toHaveBeenCalledWith('fish-CVXUSDT');
  fireEvent.click(screen.getByRole('button', { name: '删除这 3 条' }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认删除 3 条' }));
  expect(onDelete.mock.calls.map(c => c[0]).sort()).toEqual(['fish-CVXUSDT', 'fish-GATEUSDT', 'fish-NEWUSDT']);
});
