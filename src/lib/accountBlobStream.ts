import { JSONParser } from '@streamparser/json';
import { reviveAccountBlobValue, serializeAccountBlob } from './accountBlobCodec';

/** Parse decompressed bytes without allocating one archive-sized JSON string.
 * Values and special tags retain the existing codec's exact semantics.
 */
export async function deserializeAccountBlobStream(stream: ReadableStream<Uint8Array>, projection?:{record:(value:unknown,path:readonly (string|number|undefined)[])=>unknown;flush:()=>Promise<void>}, visit?: (key:string|number|undefined,parent:string|number|undefined,value:unknown)=>void, intern?: (value:unknown)=>unknown): Promise<unknown> {
  const parser = new JSONParser({ keepStack: true, stringBufferSize: 64 * 1024 });
  const canonical = new Map<string, object>();
  let result: unknown, complete = false;
  parser.onValue = ({ value, key, parent, stack }) => {
    let next = value && typeof value==='object' ? reviveAccountBlobValue(String(key ?? ''), value) : value;
    // Equal-looking object keys in a tagged Map or Set must retain distinct identities.
    if (intern && !(value && typeof value === 'object' && (key === 'v' || stack.some(frame => frame.key === 'v')))) next = intern(next);
    if(visit)visit(key,stack[stack.length-1]?.key,next);
    if(projection)next=projection.record(next,[...stack.map(frame=>frame.key),key]);
    // IndexedDB can share these immutable frozen objects, avoiding thousands of
    // identical plan/formula copies after a cloud restore. Content is unchanged.
    if (!intern && ['plan', 'snapshot', 'detectors'].includes(String(key)) && next && typeof next === 'object') {
      const text = serializeAccountBlob(next);
      if (text.length <= 128 * 1024) {
        const previous = canonical.get(text);
        if (previous) next = previous;
        else { canonical.set(text, next); if (canonical.size > 128) canonical.delete(canonical.keys().next().value!); }
      }
    }
    if (parent !== undefined && key !== undefined && (next !== value || key === '__proto__' || intern && typeof value==='string' && value.length>=96)) {
      Object.defineProperty(parent, key, { value: next, enumerable: true, writable: true, configurable: true });
    }
    if (stack.length === 0) { result = next; complete = true; }
  };
  const reader = stream.getReader();
  let yieldedAt = Date.now();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      parser.write(item.value);
      await projection?.flush();
      if (Date.now() - yieldedAt >= 32) { await new Promise(resolve => setTimeout(resolve, 0)); yieldedAt = Date.now(); }
    }
    if (!parser.isEnded) parser.end();
    await projection?.flush();
    if (!complete) throw new Error('账号研究存档不完整，原数据仍保留');
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
