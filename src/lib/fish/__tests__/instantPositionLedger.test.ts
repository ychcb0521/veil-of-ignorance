import { expect, it, vi } from 'vitest';
import { readActiveInstantRecordIds, readInstantCampaignJob, readInstantPositionLedger, readOpenInstantPositions, readPendingInstantCampaignJobs } from '../instantCampaignStore';

const records = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../fishPreferencesDb', () => ({
  readFishPreferenceEntries: async (prefix: string, include: (value: unknown) => boolean) =>
    [...records].filter(([key, value]) => key.startsWith(prefix) && include(value)),
  readFishPreferences: async (keys: string[]) => keys.map(key => records.get(key)),
}));

it.each([false, true])('uses confirmed exits across both queues without hiding a later entry in the same contract (%s)', async archivedInTemplate => {
  const owner = 'demo';
  const legacy = 'idb:instant-campaign-v1/demo/';
  const template = 'idb:instant-template-jobs-v1/demo/';
  const position = { id: 'first', recordId: 'signal-1', buyAt: 60_000, source: { symbol: 'YBUSDT' }, entryPrice: 10 };
  const closed = { ...position, sell: { at: 120_000, closePrice: 9 }, exitPrice: 9 };
  const next = { ...position, id: 'second', recordId: 'signal-2', buyAt: 180_000 };
  records.clear();
  records.set((archivedInTemplate ? template : legacy) + 'first', { input: closed, snapshot: closed, synced: true });
  records.set((archivedInTemplate ? legacy : template) + 'first', { input: position, opened: position });
  records.set(template + 'second', { input: next, opened: next });
  records.set(legacy + 'second', { input: next });
  const ledger = await readInstantPositionLedger(owner);
  expect(ledger.positions).toEqual([next]);
  expect(ledger.history).toEqual([{ id:'first', symbol:'YBUSDT', buyAt:60_000, sellAt:120_000, entryPrice:10, exitPrice:9 }]);
  expect((await readInstantCampaignJob(owner, 'first'))?.snapshot).toEqual(closed);
  expect(await readOpenInstantPositions(owner)).toEqual([next]);
  expect(await readActiveInstantRecordIds(owner)).toEqual(['signal-2']);
  expect(await readPendingInstantCampaignJobs(owner, true)).toEqual([]);
});
