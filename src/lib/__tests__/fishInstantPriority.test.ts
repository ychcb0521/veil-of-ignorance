import { expect, it, vi } from 'vitest';
import { FishScanner } from '../fishScanner';
import { FishRequestPool } from '../fish/shared';

it.each(['trackScreenedCda', 'trackInstantMonitor', 'openInstantPosition', 'markInstantPosition', 'buildInstantCampaign', 'readInstantCampaignCandles'] as const)(
  '%s overtakes queued capture work and releases priority on failure', async method => {
    const scanner = new FishScanner();
    const pool = (scanner as unknown as { pool: FishRequestPool }).pool;
    const background = new AbortController().signal, live = new AbortController().signal;
    const events: string[] = [], finishes: (() => void)[] = [];
    const slow = () => pool.run(() => new Promise<void>(resolve => finishes.push(resolve)), background);
    const first = slow(), second = slow();
    const queued = pool.run(async () => { events.push('capture'); }, background);
    await Promise.resolve();
    let taskSignal: AbortSignal;
    vi.spyOn(scanner as any, 'qualityMarket').mockImplementation(async (_symbols: string[], signal: AbortSignal) => pool.run(async () => {
      taskSignal = signal;
      expect(pool.isPrioritized(signal)).toBe(true);
      events.push('instant');
      throw Error('test market failure');
    }, signal));
    const input: any = { source: { symbol: 'AAAUSDT' }, buyAt: 60000, sell: { at: 180000, value: -11 } };
    const sample: any = { source: input.source };
    const work = method === 'trackScreenedCda' ? scanner.trackScreenedCda([], {} as any, 180000, live, vi.fn())
      : method === 'trackInstantMonitor' ? scanner.trackInstantMonitor(sample, {} as any, 60000, 180000, live)
      : method === 'readInstantCampaignCandles' ? scanner.readInstantCampaignCandles(input.source, '1m', 60000, 180000, live)
      : scanner[method](input, live);
    await expect(work).rejects.toThrow('test market failure');
    expect(events).toEqual(['instant']);
    expect(pool.isPrioritized(taskSignal!)).toBe(false);
    finishes.shift()!(); await first; await queued;
    expect(events).toEqual(['instant', 'capture']);
    finishes.shift()!(); await second;
  });

it('keeps concurrent holdings prioritized independently and relays caller cancellation', async () => {
  const scanner = new FishScanner(), parent = new AbortController();
  const pool = (scanner as unknown as { pool: FishRequestPool }).pool;
  const tasks: { signal: AbortSignal; fail: (error: Error) => void }[] = [];
  vi.spyOn(scanner as any, 'qualityMarket').mockImplementation(async (_symbols: string[], signal: AbortSignal) =>
    new Promise((_resolve, reject) => {
      tasks.push({ signal, fail: reject });
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
  const input = { source: { id:'priority-test',symbol: 'AAAUSDT',timeMs:60000 }, buyAt: 60000 };
  const first = scanner.markInstantPosition(input, parent.signal);
  const second = scanner.markInstantPosition(input, parent.signal);
  expect(tasks[0].signal).not.toBe(tasks[1].signal);
  tasks[0].fail(Error('first finished'));
  await expect(first).rejects.toThrow('first finished');
  expect(pool.isPrioritized(tasks[0].signal)).toBe(false);
  expect(pool.isPrioritized(tasks[1].signal)).toBe(true);
  const cancelled = expect(second).rejects.toMatchObject({ name: 'AbortError' });
  parent.abort(); await cancelled;
  expect(pool.isPrioritized(tasks[1].signal)).toBe(false);
});
