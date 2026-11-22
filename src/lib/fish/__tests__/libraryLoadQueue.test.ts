import {expect, it, vi} from 'vitest';
import {prioritizeInstantScreening, readFishLibrary} from '../libraryLoadQueue';
import {ArchiveReadFailure,readArchiveBatch} from '../../accountArchiveRead';

it('runs only one restore per account, starts waiting libraries in priority order and continues after a failure', async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reads = (['mining','filter','screening','monitor','instant'] as const).map(priority =>
    readFishLibrary('primary', priority, async () => {
      order.push(priority);
      if (priority === 'instant') await gate;
      if (priority === 'screening') throw Error('incomplete snapshot');
    }));
  const results = Promise.allSettled(reads);
  await readFishLibrary('another', 'mining', async () => {});
  expect(order).toEqual(['instant']);
  release();
  expect((await results).filter(r => r.status === 'rejected')).toHaveLength(1);
  expect(order).toEqual(['instant','monitor','screening','filter','mining']);
});

it('starts a late instant read during a blocked archive, then resumes the ordered backlog', async () => {
  const order: string[] = [];
  let releaseArchive!: () => void, releaseInstant!: () => void;
  const archive = readFishLibrary('busy', 'monitor', () => new Promise<void>(resolve => {
    order.push('monitor'); releaseArchive = resolve;
  }));
  await Promise.resolve();
  const next = readFishLibrary('busy', 'mining', async () => { order.push('mining'); });
  const instant = readFishLibrary('busy', 'instant', () => new Promise<void>(resolve => {
    order.push('instant'); releaseInstant = resolve;
  }));
  await Promise.resolve();
  expect(order).toEqual(['monitor', 'instant']);
  releaseArchive(); await archive;
  expect(order).toEqual(['monitor', 'instant']);
  releaseInstant(); await Promise.all([instant, next]);
  expect(order).toEqual(['monitor', 'instant', 'mining']);
});

it('promotes the shared screening read when instant trading needs admission history', async () => {
  const order: string[] = [];
  const pending = (['monitor','screening','instant'] as const).map(p =>
    readFishLibrary('live', p, async () => { order.push(p); }));
  prioritizeInstantScreening('live', true);
  try {
    await Promise.all(pending);
    expect(order).toEqual(['instant','screening','monitor']);
  } finally { prioritizeInstantScreening('live', false); }
});

it('retries only the failed response in smaller batches and stops on cancellation', async () => {
  const keys = ['1','2','3','4'];
  const fetch = vi.fn(async (batch: string[]) => {
    if (batch.length === 4) throw Error('503');
    return batch;
  });
  expect(await readArchiveBatch(keys, undefined, fetch)).toEqual(keys);
  expect(fetch.mock.calls.map(([batch])=>batch)).toEqual([keys, keys.slice(0,2), keys.slice(2)]);
  const controller = new AbortController();
  const fail = vi.fn(async () => { controller.abort(); throw Error('cancelled'); });
  await expect(readArchiveBatch(keys, controller.signal, fail)).rejects.toThrow();
  expect(fail).toHaveBeenCalledOnce();
});

it('can reduce a failing two-part response to single parts without repeating a successful half', async () => {
  const fetch = vi.fn(async (batch: string[]) => {
    if (batch.length > 1 && batch[0] !== '3') throw Error('response too slow');
    return batch;
  });
  expect(await readArchiveBatch(['1','2','3','4'], undefined, fetch)).toEqual(['1','2','3','4']);
  expect(fetch.mock.calls.map(([batch]) => batch)).toEqual([['1','2','3','4'], ['1','2'], ['1'], ['2'], ['3','4']]);
});

it('retries a single transport failure once, and never retries version failures or empty work', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(Error('connection reset')).mockResolvedValueOnce(['1']);
  expect(await readArchiveBatch(['1'], undefined, fetch)).toEqual(['1']); expect(fetch).toHaveBeenCalledTimes(2);
  const invalid = vi.fn().mockRejectedValue(new ArchiveReadFailure('revision'));
  await expect(readArchiveBatch(['1'], undefined, invalid)).rejects.toMatchObject({ issue: 'revision' });
  expect(invalid).toHaveBeenCalledOnce(); expect(await readArchiveBatch([], undefined, invalid)).toEqual([]);
});
