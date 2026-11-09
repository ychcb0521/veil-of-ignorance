import { readPreEntrySnapshot } from './preEntryPersistence';
import { prepareAccountBlobEncoding } from '../accountBlobCodec';
import type { PreparedAccountBlob } from '../accountBlobSync';

/** Existing schema, codec and fingerprint, with the large object staying in the worker. */
export async function encodeStoredPreEntry(owner: string, knownHash?: string): Promise<PreparedAccountBlob | undefined> {
  const value = await readPreEntrySnapshot(owner);
  return value === undefined ? undefined : prepareAccountBlobEncoding(value, knownHash);
}
