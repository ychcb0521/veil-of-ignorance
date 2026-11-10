import {readPreEntrySnapshot,readPreEntryReadModel,readPreEntryTableClears,readPreEntryCacheRevision,cachePreEntryReadModel} from './preEntryPersistence';
import {projectPreEntryRecord} from './preEntryArchive';
import {withPreEntryTableClears} from './preEntryTableClears';
import {serializePreEntryLibraryChunks} from './preEntryArchiveStream';
import {prepareAccountBlobChunkEncoding} from '../accountBlobChunkEncoding';
import type { PreparedAccountBlob } from '../accountBlobSync';

/** Streaming the serializer alone was insufficient: reading the entire archive
 * first still materialized every history in the renderer's worker heap. */
export async function encodeStoredPreEntry(owner: string|undefined, knownHash?: string, onSnapshot?:()=>void): Promise<PreparedAccountBlob | undefined> {
  const revision=await readPreEntryCacheRevision(owner);
  const cached=await readPreEntryReadModel(owner);
  const value=cached??await readPreEntrySnapshot(owner);
  if(!value)return undefined;
  // Legacy fallback only. Release each original as soon as its durable private
  // body is acknowledged. Never delete or rewrite the original canonical keys.
  for(let i=0;i<value.records.length;i++){
    const next=projectPreEntryRecord(value.records[i],owner);await next.saved;value.records[i]=next.record;
  }
  // Brand-new libraries may not yet have a complete directory. Rebuild it once,
  // rather than rereading the complete legacy graph on every timed backup.
  if(!cached){try{await cachePreEntryReadModel(owner,value,true,false,revision);}catch{/* Only a rebuildable cache; the immutable bodies are already durable. */}}
  const snapshot=withPreEntryTableClears(value,await readPreEntryTableClears(owner));
  onSnapshot?.();
  return prepareAccountBlobChunkEncoding(()=>serializePreEntryLibraryChunks(snapshot),knownHash);
}
