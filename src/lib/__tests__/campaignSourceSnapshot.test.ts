import { afterEach, describe, expect, it, vi } from 'vitest';
import { campaignSourceSnapshotStore, validateCampaignSourceSnapshot, CAMPAIGN_SOURCE_SNAPSHOT_READ_MS } from '@/lib/campaignSourceSnapshot';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('user-isolated campaign startup snapshot', () => {
  const rows = { campaigns: [{ id: 'c', user_id: 'u' }], journals: [{ id: 'j', user_id: 'u' }] };
  const saved = { version: 1, owner: 'u', rows };
  it('restores raw inputs only for their own user and schema version', () => {
    expect(validateCampaignSourceSnapshot(saved, 'u')).toBe(rows);
    expect(validateCampaignSourceSnapshot(saved, 'other')).toBeNull();
    expect(validateCampaignSourceSnapshot({ ...saved, version: 0 }, 'u')).toBeNull();
    expect(validateCampaignSourceSnapshot({ ...saved, rows: { campaigns: [{ id: 'c', user_id: 'other' }], journals: [] } }, 'u')).toBeNull();
    expect(validateCampaignSourceSnapshot({ ...saved, rows: { campaigns: [null], journals: [] } }, 'u')).toBeNull();
    expect(validateCampaignSourceSnapshot({ ...saved, rows: {} }, 'u')).toBeNull();
  });
  it('is optional when IndexedDB is unavailable or disabled', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await campaignSourceSnapshotStore.read('u')).toBeNull();
    await expect(campaignSourceSnapshotStore.write('u', rows)).resolves.toBeUndefined();
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('disabled'); } });
    expect(await campaignSourceSnapshotStore.read('u')).toBeNull();
  });
  it('reads committed raw rows and writes only into the current user key', async () => {
    const close = vi.fn();
    const put = vi.fn();
    const transaction: { oncomplete?: () => void; objectStore: () => unknown } = {
      objectStore: () => ({
        get: (key: string) => {
          expect(key).toBe('u');
          const read: { result: unknown; onsuccess?: () => void } = { result: saved };
          queueMicrotask(() => { read.onsuccess?.(); transaction.oncomplete?.(); });
          return read;
        },
        put: (value: unknown, key: string) => { put(value, key); queueMicrotask(() => transaction.oncomplete?.()); },
      }),
    };
    vi.stubGlobal('indexedDB', { open: () => {
      const request: { onsuccess?: () => void; result: unknown } = { result: { close, transaction: () => transaction } };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } });
    expect(await campaignSourceSnapshotStore.read('u')).toEqual(rows);
    await campaignSourceSnapshotStore.write('u', rows);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ owner: 'u', version: 1, rows }), 'u');
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('caps a blocked read at 300 ms and closes a database that opens late', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const request: { onsuccess?: () => void; result: unknown } = { result: { close } };
    vi.stubGlobal('indexedDB', { open: () => request });
    const read = campaignSourceSnapshotStore.read('u');
    await vi.advanceTimersByTimeAsync(CAMPAIGN_SOURCE_SNAPSHOT_READ_MS);
    expect(await read).toBeNull();
    request.onsuccess?.();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
