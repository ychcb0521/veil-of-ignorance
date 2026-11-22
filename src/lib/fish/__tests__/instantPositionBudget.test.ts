import { expect, it, vi } from 'vitest';
import { DEFAULT_INSTANT_POSITION, freezeLivePositionBudget, registerInstantBalanceReader, sizeInstantEntry } from '../instantPositionSettings';

it('reads the available USDT on each new entry, freezes retries, and isolates owners', async () => {
  const read = vi.fn().mockResolvedValueOnce('1250').mockResolvedValueOnce('600');
  const remove = registerInstantBalanceReader('first', read);
  const signal = new AbortController().signal;
  try {
    const first = await freezeLivePositionBudget('first', DEFAULT_INSTANT_POSITION, signal);
    expect(sizeInstantEntry(first)).toEqual({marginUsdt:62.5, leverage:5, notional:312.5});
    expect(await freezeLivePositionBudget('first', first, signal)).toBe(first);
    const next = await freezeLivePositionBudget('first', DEFAULT_INSTANT_POSITION, signal);
    expect(sizeInstantEntry(next).marginUsdt).toBe(30);
    expect(read).toHaveBeenCalledTimes(2);
    const missing = await freezeLivePositionBudget('other', DEFAULT_INSTANT_POSITION, signal);
    expect(missing.balanceObservedAt).toBeUndefined();
    expect(missing.liveBalanceIssue).toBeTruthy();
    for (const value of ['0','-1','Infinity','unavailable']) {
      read.mockResolvedValueOnce(value);
      const invalid = await freezeLivePositionBudget('first', DEFAULT_INSTANT_POSITION, signal);
      expect(invalid.balanceObservedAt).toBeUndefined();
      expect(invalid.liveBalanceIssue).toBeTruthy();
    }
  } finally { remove(); }
});
