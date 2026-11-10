import {afterEach,expect,it,vi} from 'vitest';
import {prepareAccountBlobChunkEncoding} from '../accountBlobChunkEncoding';
import {serializeAccountBlob,deserializeAccountBlob,fingerprintAccountBlob} from '../accountBlobCodec';

afterEach(()=>vi.unstubAllGlobals());
async function unpack(result:Awaited<ReturnType<typeof prepareAccountBlobChunkEncoding>>){
  const encoded=result.encoded!;
  if(encoded.enc==='json')return encoded.text;
  const bytes=Uint8Array.from(atob(encoded.text),c=>c.charCodeAt(0));
  return new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))).text();
}
it('preserves the exact wire fingerprint and Unicode when lazy bodies cross batch boundaries',async()=>{
  const value={rows:[{note:'a'.repeat(262_129)+'🚀中文',n:Infinity},{map:new Map([['n',NaN]]),set:new Set([2]),date:new Date(4)}]};
  const json=serializeAccountBlob(value);let passes=0;
  const source=async function*(){passes++;for(let i=0;i<json.length;i+=37)yield json.slice(i,i+37);};
  const encoded=await prepareAccountBlobChunkEncoding(source);
  expect(encoded.hash).toBe(fingerprintAccountBlob(json));expect(encoded.encoded!.bytes).toBe(json.length);
  expect(await unpack(encoded)).toBe(json);expect(deserializeAccountBlob(await unpack(encoded))).toEqual(value);expect(passes).toBe(3);
  passes=0;expect(await prepareAccountBlobChunkEncoding(source,encoded.hash)).toEqual({hash:encoded.hash});expect(passes).toBe(2);
});
it('retains the existing uncompressed format when gzip is unavailable',async()=>{
  vi.stubGlobal('CompressionStream',undefined);const json=serializeAccountBlob({rows:['原文',NaN]});
  const result=await prepareAccountBlobChunkEncoding(async function*(){yield json;});
  expect(result).toEqual({hash:fingerprintAccountBlob(json),encoded:{enc:'json',text:json,bytes:json.length}});
});
it('rejects missing bodies during any pass without returning a partial upload',async()=>{
  for(const failAt of [1,2,3]){
    let pass=0;
    await expect(prepareAccountBlobChunkEncoding(async function*(){pass++;yield '{"rows":[';if(pass===failAt)throw Error('正文缺失');yield '1]}';})).rejects.toThrow('正文缺失');
  }
});
