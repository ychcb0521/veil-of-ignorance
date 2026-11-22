import { afterEach, expect, it, vi } from 'vitest';
import { createInstantBalanceCalibration, freezeCalibratedLivePositionBudget, INSTANT_SETTLED_BALANCE } from '../instantBalanceCalibration';
import { DEFAULT_INSTANT_POSITION, sizeInstantEntry } from '../instantPositionSettings';
import type { UsdtLiveCampaign } from '../usdtLiveCampaign';

const sessions: ReturnType<typeof createInstantBalanceCalibration>[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); vi.useRealTimers(); });
const closed = (id = '1'): UsdtLiveCampaign => ({ symbol: 'AAAUSDT', positionSide: 'LONG', direction: 'long', asset: 'USDT',
  openedAt: 1000, closedAt: 2000, quantity: '0', fills: [{ id, orderId: id, action: 'open', side: 'BUY', at: 1000,
    price: '10', quantity: '1', positionQuantity: '1', realized: 0, commission: 0, commissionAsset: 'USDT' }] });
const setup = (owner: string, read = vi.fn().mockResolvedValue('1250'), binding = 'connection') => {
  const publish = vi.fn(), persist = vi.fn().mockResolvedValue(undefined);
  const session = createInstantBalanceCalibration(owner, binding, read, publish, persist);
  sessions.push(session);
  return { session, read, publish, persist };
};

it('freezes new entries without any balance request, then updates only after a fully closed real campaign', async () => {
  const { session, read, persist } = setup('cached');
  const original = structuredClone(DEFAULT_INSTANT_POSITION);
  await session.refresh();
  const first = freezeCalibratedLivePositionBudget('cached', DEFAULT_INSTANT_POSITION);
  expect(first).toMatchObject({ availableUsdt: 1250, balanceObservedAt: expect.any(Number), balancePolicy: INSTANT_SETTLED_BALANCE });
  expect(sizeInstantEntry(first).marginUsdt).toBe(62.5);
  expect(freezeCalibratedLivePositionBudget('cached', DEFAULT_INSTANT_POSITION)).toEqual(first);
  expect(read).toHaveBeenCalledTimes(1);
  session.campaigns([{ ...closed(), closedAt: undefined, quantity: '0.5' }]);
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValue('600');
  session.campaigns([closed()]);
  expect(() => freezeCalibratedLivePositionBudget('cached', DEFAULT_INSTANT_POSITION)).toThrow();
  await vi.waitFor(() => expect(session.state.ready).toBe(true));
  expect(sizeInstantEntry(freezeCalibratedLivePositionBudget('cached', DEFAULT_INSTANT_POSITION)).marginUsdt).toBe(30);
  expect(freezeCalibratedLivePositionBudget('cached', first)).toBe(first);
  session.campaigns([closed(), { ...closed(), closedAt: undefined, quantity: '1' }]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(persist).toHaveBeenCalledTimes(2);
  expect(DEFAULT_INSTANT_POSITION).toEqual(original);
  expect(freezeCalibratedLivePositionBudget('other', DEFAULT_INSTANT_POSITION).balanceObservedAt).toBeUndefined();
});

it('rechecks a settlement that arrives during calibration and never exposes the older response', async () => {
  let finish!: (value: string) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; })).mockResolvedValue('700');
  const { session, persist } = setup('racing', read);
  const pending = session.refresh();
  session.campaigns([closed()]);
  finish('1300');
  await pending;
  expect(read).toHaveBeenCalledTimes(2);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(freezeCalibratedLivePositionBudget('racing', DEFAULT_INSTANT_POSITION).availableUsdt).toBe(700);
});

it('uses a new executor closure immediately and deduplicates its later campaign archive', async () => {
  const { session, read } = setup('status-close');
  session.statuses([{ id: 'earlier', state: 'closed' }]);
  await session.refresh();
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValue('850');
  session.statuses([{ id: 'earlier', state: 'closed' }, { id: 'new', state: 'tracking' }]);
  expect(read).toHaveBeenCalledTimes(1);
  session.statuses([{ id: 'new', state: 'closed' }]);
  await vi.waitFor(() => expect(session.state.ready).toBe(true));
  session.campaigns([{ ...closed(), followId: 'new' }]);
  session.statuses([{ id: 'new', state: 'closed' }]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(freezeCalibratedLivePositionBudget('status-close', DEFAULT_INSTANT_POSITION).availableUsdt).toBe(850);
});

it('ignores an old connection response and keeps the replacement account cache separate', async () => {
  let finish!: (value: string) => void;
  const previous = setup('switching', vi.fn(() => new Promise<string>(resolve => { finish = resolve; })), 'old');
  const pending = previous.session.refresh();
  previous.session.dispose();
  const next = setup('switching', vi.fn().mockResolvedValue('900'), 'new');
  await next.session.refresh();
  finish('5000'); await pending;
  expect(previous.persist).not.toHaveBeenCalled();
  expect(next.persist.mock.calls[0][0]).toContain('/switching/new');
  expect(freezeCalibratedLivePositionBudget('switching', DEFAULT_INSTANT_POSITION).availableUsdt).toBe(900);
});

it('retries a failed background calibration and blocks unfunded new entries without changing frozen positions', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(Error('余额读取失败')).mockResolvedValue('800');
  const { session } = setup('retrying', read);
  await session.refresh();
  expect(session.state).toMatchObject({ ready: false, refreshing: false, issue: '余额读取失败' });
  expect(() => freezeCalibratedLivePositionBudget('retrying', DEFAULT_INSTANT_POSITION)).toThrow('余额读取失败');
  await vi.advanceTimersByTimeAsync(5000);
  expect(session.state.ready).toBe(true);
  const old = freezeCalibratedLivePositionBudget('retrying', DEFAULT_INSTANT_POSITION);
  read.mockResolvedValue('0');
  session.campaigns([closed()]);
  await vi.advanceTimersByTimeAsync(0);
  expect(session.state).toMatchObject({ ready: false, availableUsdt: 0 });
  expect(freezeCalibratedLivePositionBudget('retrying', old)).toBe(old);
  expect(() => freezeCalibratedLivePositionBudget('retrying', DEFAULT_INSTANT_POSITION)).toThrow('0');
});
