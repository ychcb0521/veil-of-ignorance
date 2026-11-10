/** Encode an immutable snapshot whose bodies are read one at a time. The JSON,
 * fingerprint and gzip wire format are identical to the original account codec. */
export type AccountBlobChunkSource = () => AsyncIterable<string>;
const BATCH_CHARS = 262_144;

export async function* accountBlobChunkBatches(source: AccountBlobChunkSource): AsyncGenerator<string> {
  let buffer = '';
  for await (const piece of source()) {
    buffer += piece;
    while (buffer.length >= BATCH_CHARS) {
      let end = BATCH_CHARS;
      const last = buffer.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      yield buffer.slice(0, end);
      buffer = buffer.slice(end);
    }
  }
  if (buffer) yield buffer;
}

export async function prepareAccountBlobChunkEncoding(source: AccountBlobChunkSource, knownHash?: string) {
  let length = 0;
  for await (const part of accountBlobChunkBatches(source)) length += part.length;
  let a = 0x811c9dc5, b = 0x01000193 ^ length;
  for await (const part of accountBlobChunkBatches(source)) {
    for (let i = 0; i < part.length; i++) {
      const c = part.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ c, 0x5bd1e995);
    }
  }
  const hash = `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${length}`;
  if (hash === knownHash) return { hash };
  if (typeof CompressionStream !== 'function') {
    const parts: string[] = [];
    for await (const part of accountBlobChunkBatches(source)) parts.push(part);
    return { hash, encoded: { enc: 'json' as const, text: parts.join(''), bytes: length } };
  }
  const stream = new CompressionStream('gzip'), writer = stream.writable.getWriter();
  const packed = new Response(stream.readable).arrayBuffer();
  // Observe rejection immediately, including when a missing body aborts encoding.
  void packed.catch(() => undefined);
  try {
    const encoder = new TextEncoder();
    for await (const part of accountBlobChunkBatches(source)) await writer.write(encoder.encode(part));
    await writer.close();
    const bytes = new Uint8Array(await packed);
    const pieces: string[] = [];
    for (let i = 0; i < bytes.length; i += 0x8000) pieces.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
    return { hash, encoded: { enc: 'gzip' as const, text: btoa(pieces.join('')), bytes: length } };
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    throw error;
  }
}
