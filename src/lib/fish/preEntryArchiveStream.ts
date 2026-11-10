import type {PreEntryLibrary} from './preEntryMonitor';
import {restorePreEntryRecord} from './preEntryArchive';
import {serializeAccountBlob,serializeAccountBlobChunks} from '../accountBlobCodec';

/** The page's private references never enter a public backup. Only one complete
 * history is reachable at a time; the snapshot and immutable body keys stay fixed
 * across all fingerprint/encoding passes, even if monitoring keeps saving. */
export async function* serializePreEntryLibraryChunks(library:PreEntryLibrary):AsyncGenerator<string>{
  yield '{';
  let first=true;
  for(const key of Object.keys(library)){
    if(key==='records'){
      yield `${first?'':','}"records":[`;first=false;
      for(let i=0;i<library.records.length;i++){
        if(i)yield ',';
        yield* serializeAccountBlobChunks(await restorePreEntryRecord(library.records[i]));
      }
      yield ']';
    }else{
      const value=serializeAccountBlob(library[key as keyof PreEntryLibrary]);
      if(value!==undefined){yield `${first?'':','}${JSON.stringify(key)}:${value}`;first=false;}
    }
  }
  yield '}';
}
