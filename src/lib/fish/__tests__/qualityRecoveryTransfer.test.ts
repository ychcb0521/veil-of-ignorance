import {afterEach, expect, it, vi} from 'vitest';
import {clearRecoveryParts, readQualityRecoveryParts} from '../../qualityRecoveryTransfer';
import {serializeAccountBlob} from '../../accountBlobCodec';
import {decodeQualityStudy} from '../qualityRestore';

afterEach(() => clearRecoveryParts());
const context = () => ({signal: new AbortController().signal, report: vi.fn()});
const keys = Array.from({length: 13}, (_, i) => 'chunk-' + i);
const rows = (keys: string[], rev: string) => keys.map(key => ({key, value: {rev, data: key}})).reverse();

it('reuses complete batches on retry, keeps order, and isolates owners and revisions', async () => {
  const read = vi.fn(async (batch: string[]) => rows(batch, 'r'));
  await expect(readQualityRecoveryParts('a', 'r', keys, async batch => {
    if (batch[0] === keys[4]) {
      await new Promise(r => setTimeout(r, 10));
      return rows(batch, 'stale');
    }
    return read(batch);
  }, context())).rejects.toThrow('版本');
  read.mockClear();
  expect(await readQualityRecoveryParts('a', 'r', keys, read, context())).toEqual(keys);
  expect(read.mock.calls.map(([batch]) => batch)).toEqual([keys.slice(4, 8)]);
  for (const [owner, rev] of [['b','r'], ['b','next']]) {
    const fetch = vi.fn(async (batch: string[]) => rows(batch, rev));
    expect(await readQualityRecoveryParts(owner, rev, keys, fetch, context())).toEqual(keys);
    expect(fetch).toHaveBeenCalledTimes(4);
  }
});

it('rejects missing parts and never mixes revisions', async () => {
  await expect(readQualityRecoveryParts('a', 'r', keys, async batch => rows(batch.slice(1), 'r'), context())).rejects.toThrow('缺失');
});

it('restores arbitrary gzip boundaries, shares identical records, and retains distinct Map keys', async () => {
  const frozen = {formula:'探测🚀'.repeat(80), version:1};
  const archive = {rows:[{frozen}, {frozen}], map:new Map([[{a:1},'first'],[{a:1},'second']]), set:new Set([{a:1},{a:1}])};
  const source = serializeAccountBlob(archive);
  const {gzipSync} = await import('node:zlib');
  const base64 = gzipSync(source).toString('base64');
  const result = await decodeQualityStudy('gzip',base64.match(/.{1,7}/g)!,context()) as typeof archive;
  expect(serializeAccountBlob(result)).toBe(source);
  expect(result.rows[0].frozen).toBe(result.rows[1].frozen);
});
