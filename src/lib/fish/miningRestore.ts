import { decodeAccountBlob } from '../accountBlobSync';
import { deserializeAccountBlobStream } from '../accountBlobStream';
import { serializeAccountBlob } from '../accountBlobCodec';
import { miningRecordInterner } from './miningDiskPages';
import type { FishMiningLibrary, FishMiningRecord } from './miningLibrary';

export async function decodeMiningArchive(enc:'gzip'|'json',pieces:readonly string[]) {
  if(pieces.length<2) return decodeAccountBlob(enc,pieces);
  const intern=miningRecordInterner();
  let index=0,carry='';
  const compressedBytes=()=>new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller){
      if(index===pieces.length){if(carry)throw Error('捕捞库分片编码不完整');controller.close();return;}
      const piece=pieces[index++];
      // The gzip branch receives base64 with possible splits between quartets.
      const text=carry+piece, end=index===pieces.length?text.length:text.length-text.length%4;
      carry=text.slice(end);
      const binary=atob(text.slice(0,end)),converted=new Uint8Array(binary.length);
      for(let i=0;i<converted.length;i++)converted[i]=binary.charCodeAt(i);
      controller.enqueue(converted);
    }
  });
  // Uncompressed legacy pieces may split a UTF-16 surrogate pair; keep the streaming text encoder.
  let jsonIndex=0;
  const stream=enc==='gzip'?compressedBytes().pipeThrough(new DecompressionStream('gzip')):new ReadableStream<string>({
    pull(c){if(jsonIndex===pieces.length)c.close();else c.enqueue(pieces[jsonIndex++]);}
  }).pipeThrough(new TextEncoderStream());
  return deserializeAccountBlobStream(stream,undefined,(key,parent,value)=>{
    if(typeof key==='number' && parent==='records' && value && typeof value==='object') intern(value as FishMiningRecord);
  });
}

/** A remote capture already containing the complete merge needs no upload. Compare by stable ID. */
export function containsMiningMerge(remote:FishMiningLibrary,merged:FishMiningLibrary) {
  if(remote.clearedAt!==merged.clearedAt || !!remote.adoptedHold!==!!merged.adoptedHold ||
     serializeAccountBlob(remote.deletedRecords??{})!==serializeAccountBlob(merged.deletedRecords??{}))return false;
  for(const kind of ['runs','records','anchors'] as const){
    const a=remote[kind],b=merged[kind];
    if(a.length!==b.length)return false;
    const lookup=new Map<string,unknown>(a.map(x=>[x.id,x] as const));
    for(const row of b){
      const match=lookup.get(row.id);
      if(!match || (match!==row && serializeAccountBlob(match)!==serializeAccountBlob(row)))return false;
    }
  }
  return true;
}
