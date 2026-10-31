import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {Blob as NativeBlob} from 'node:buffer';
import {prepareAccountBlobEncoding,serializeAccountBlob,deserializeAccountBlob,fingerprintAccountBlob} from '../accountBlobCodec';
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:vi.fn(),auth:{getSession:vi.fn()}}}));
import {prepareAccountBlob,decodeAccountBlob} from '../accountBlobSync';
beforeEach(()=>vi.stubGlobal('Blob',NativeBlob));
afterEach(()=>vi.unstubAllGlobals());
it('preserves complex account values and the exact existing fingerprint through the worker wire format',async()=>{
 const value={map:new Map([['x',NaN]]),set:new Set([1,2]),date:new Date('2026-10-31T00:00:00Z'),inf:Infinity,rows:Array.from({length:2000},(_,i)=>({i,note:'档案'.repeat(30)}))};
 const result=await prepareAccountBlobEncoding(value);expect(result.hash).toBe(fingerprintAccountBlob(serializeAccountBlob(value)));expect(result.encoded!.enc).toBe('gzip');
 expect(await decodeAccountBlob(result.encoded!.enc,result.encoded!.text)).toEqual(value);expect(result.encoded!.bytes).toBe(serializeAccountBlob(value).length);
});
it('skips packing entirely for an unchanged save',async()=>{
 const value={archive:[1,2,3]},hash=fingerprintAccountBlob(serializeAccountBlob(value));expect(await prepareAccountBlobEncoding(value,hash)).toEqual({hash});
});
it('uses a dedicated encoder worker and releases it after receiving a valid result',async()=>{
 const created:URL[]=[],stopped=vi.fn();
 class Encoder {onmessage:any;onerror:any;constructor(url:URL){created.push(url);}terminate(){stopped();}postMessage(body:any){const copied=structuredClone(body);queueMicrotask(async()=>{this.onmessage({data:{ok:true,...await prepareAccountBlobEncoding(copied.value,copied.knownHash)}});});}}
 vi.stubGlobal('Worker',Encoder);const value={m:new Map([['n',3]]),nan:NaN},r=await prepareAccountBlob(value);
 expect(created[0].pathname).toMatch(/accountBlobEncoder.worker.ts$/);expect(stopped).toHaveBeenCalledTimes(1);expect(deserializeAccountBlob(serializeAccountBlob(await decodeAccountBlob(r.encoded!.enc,r.encoded!.text)))).toEqual(value);
});
it('rejects failed worker encoding and terminates the worker instead of uploading a partial blob',async()=>{
 const stopped=vi.fn();class Encoder{onmessage:any;onerror:any;terminate(){stopped();}postMessage(){queueMicrotask(()=>this.onmessage({data:{ok:false}}));}}
 vi.stubGlobal('Worker',Encoder);await expect(prepareAccountBlob({x:1})).rejects.toThrow('编码失败');expect(stopped).toHaveBeenCalledTimes(1);
});
