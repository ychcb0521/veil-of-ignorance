import {readPreEntrySnapshot,readPreEntryReadModel,readPreEntryTableClears,readPreEntryCacheRevision,cachePreEntryReadModel} from './preEntryPersistence';
import {projectPreEntryRecords} from './preEntryArchive';
import {withPreEntryTableClears} from './preEntryTableClears';
import {serializePreEntryLibraryChunks} from './preEntryArchiveStream';
import {prepareAccountBlobChunkEncoding} from '../accountBlobChunkEncoding';
import type { PreparedAccountBlob } from '../accountBlobSync';

/** Streaming the serializer alone was insufficient: reading the entire archive
 * first still materialized every history in the renderer's worker heap. */
export async function encodeStoredPreEntry(owner: string|undefined, knownHash?: string, onSnapshot?:()=>void): Promise<PreparedAccountBlob | undefined> {
  const revision=await readPreEntryCacheRevision(owner);
  const cached=await readPreEntryReadModel(owner);
  const value=cached??await readPreEntrySnapshot(owner,true);
  if(!value)return undefined;
  if (cached) value.records = await projectPreEntryRecords(cached.records, owner);
  // Brand-new libraries may not yet have a complete directory. Rebuild it once,
  // rather than rereading the complete legacy graph on every timed backup.
  if(!cached){try{await cachePreEntryReadModel(owner,value,true,false,revision);}catch{/* Only a rebuildable cache; the immutable bodies are already durable. */}}
  const snapshot=withPreEntryTableClears(value,await readPreEntryTableClears(owner));
  onSnapshot?.();
  return prepareAccountBlobChunkEncoding(()=>serializePreEntryLibraryChunks(snapshot),knownHash);
}
