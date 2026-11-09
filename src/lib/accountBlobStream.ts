import { JSONParser } from '@streamparser/json';
import { reviveAccountBlobValue, serializeAccountBlob } from './accountBlobCodec';

/** Parse decompressed bytes without allocating one archive-sized JSON string.
 * Values and special tags retain the existing codec's exact semantics.
 */
export async function deserializeAccountBlobStream(stream: ReadableStream<Uint8Array>): Promise<unknown> {
  const parser = new JSONParser({ keepStack: true, stringBufferSize: 64 * 1024 });
  const canonical = new Map<string, object>();
  let result: unknown, complete = false;
  parser.onValue = ({ value, key, parent, stack }) => {
    let next = reviveAccountBlobValue(String(key ?? ''), value);
    // IndexedDB can share these immutable frozen objects, avoiding thousands of
    // identical plan/formula copies after a cloud restore. Content is unchanged.
    if (['plan', 'snapshot', 'detectors'].includes(String(key)) && next && typeof next === 'object') {
      const text = serializeAccountBlob(next);
      if (text.length <= 128 * 1024) {
        const previous = canonical.get(text);
        if (previous) next = previous;
        else { canonical.set(text, next); if (canonical.size > 128) canonical.delete(canonical.keys().next().value!); }
      }
    }
    if (parent !== undefined && key !== undefined) {
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
      if (Date.now() - yieldedAt >= 32) { await new Promise(resolve => setTimeout(resolve, 0)); yieldedAt = Date.now(); }
    }
    if (!parser.isEnded) parser.end();
    if (!complete) throw new Error('账号研究存档不完整，原数据仍保留');
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
