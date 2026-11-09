const TAG = '__veilType';
function replacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)[key];
  if (raw instanceof Map) return { [TAG]: 'Map', v: [...raw] };
  if (raw instanceof Set) return { [TAG]: 'Set', v: [...raw] };
  if (raw instanceof Date) return { [TAG]: 'Date', v: raw.getTime() };
  if (typeof raw === 'number' && !Number.isFinite(raw)) return { [TAG]: 'Num', v: String(raw) };
  return value;
}
export function reviveAccountBlobValue(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const tagged = value as { [TAG]?: unknown; v?: unknown };
  switch (tagged[TAG]) {
    case 'Map': return new Map(tagged.v as [unknown, unknown][]);
    case 'Set': return new Set(tagged.v as unknown[]);
    case 'Date': return new Date(tagged.v as number);
    case 'Num': return Number(tagged.v);
    default: return value;
  }
}
export const serializeAccountBlob = (value: unknown) => JSON.stringify(value, replacer);
export const deserializeAccountBlob = (text: string): unknown => JSON.parse(text, reviveAccountBlobValue);


/** 内容指纹（FNV-1a，两轮不同种子拼成 64 位），只用来判断「和上次传的是不是同一份」。 */
export function fingerprintAccountBlob(json: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ json.length;
  for (let i = 0; i < json.length; i += 1) {
    const c = json.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${json.length}`;
}

/** 只有普通对象和数组才拆开写；Map/Set/Date 等交给 replacer，与整串 JSON.stringify 的处理一致。 */
function splittable(value: unknown): value is object {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}
const SPLIT_DEPTH = 4;
/**
 * 与 serializeAccountBlob(value) 拼起来逐字相同，只是分段产出。
 * 研究存档的 JSON 动辄几千万字（含中文时每字 2 字节），一次拼成整串会在 Worker 里多占几百 MB；分段时峰值只是一段。
 */
export function* serializeAccountBlobChunks(value: unknown, depth = 0): Generator<string> {
  if (depth >= SPLIT_DEPTH || !splittable(value)) { const text = serializeAccountBlob(value); if (text !== undefined) yield text; return; }
  if (Array.isArray(value)) {
    yield '[';
    for (let i = 0; i < value.length; i += 1) {
      if (i) yield ',';
      const item = value[i];
      if (splittable(item)) yield* serializeAccountBlobChunks(item, depth + 1);
      else yield serializeAccountBlob(item) ?? 'null';
    }
    yield ']';
    return;
  }
  yield '{';
  let first = true;
  for (const key of Object.keys(value)) {
    const item = (value as Record<string, unknown>)[key];
    if (splittable(item)) { yield `${first ? '' : ','}${JSON.stringify(key)}:`; first = false; yield* serializeAccountBlobChunks(item, depth + 1); continue; }
    const text = serializeAccountBlob(item);
    if (text === undefined) continue;
    yield `${first ? '' : ','}${JSON.stringify(key)}:${text}`; first = false;
  }
  yield '}';
}
/** 把小段攒成约 1M 字一批再处理，省掉几十万次小调用。 */
function* batched(value: unknown): Generator<string> {
  let buffer = '';
  for (const piece of serializeAccountBlobChunks(value)) { buffer += piece; if (buffer.length >= 1_000_000) { yield buffer; buffer = ''; } }
  if (buffer) yield buffer;
}

/**
 * Shared worker payload codec; the wire format and content fingerprint stay unchanged.
 * 分三遍流式处理（总长度 → 指纹 → gzip），任何时候都不生成整份 JSON 字符串。
 */
export async function prepareAccountBlobEncoding(value:unknown,knownHash?:string):Promise<{hash:string;encoded?:{enc:'gzip'|'json';text:string;bytes:number}}>{
  const {hash, length} = await fingerprintAccountBlobValue(value);
  if (hash === knownHash) return { hash };
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new CompressionStream('gzip'), writer = stream.writable.getWriter();
      const packed = new Response(stream.readable).arrayBuffer();
      const encoder = new TextEncoder();
      for (const part of batched(value)) await writer.write(encoder.encode(part));
      await writer.close();
      const bytes = new Uint8Array(await packed);
      let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { hash, encoded: { enc: 'gzip', text: btoa(binary), bytes: length } };
    } catch { /* Preserve the existing uncompressed fallback. */ }
  }
  return { hash, encoded: { enc: 'json', text: serializeAccountBlob(value), bytes: length } };
}

/** Same content fingerprint, bounded intermediate strings and regular UI yields. */
export async function fingerprintAccountBlobValue(value: unknown): Promise<{hash: string; length: number}> {
  let yieldedAt = Date.now();
  const yieldIfNeeded = async () => { if (Date.now() - yieldedAt >= 32) { await new Promise(resolve => setTimeout(resolve, 0)); yieldedAt = Date.now(); } };
  let length = 0;
  for (const part of batched(value)) { length += part.length; await yieldIfNeeded(); }
  let a = 0x811c9dc5, b = 0x01000193 ^ length;
  for (const part of batched(value)) {
    for (let i = 0; i < part.length; i += 1) { const c = part.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995); }
    await yieldIfNeeded();
  }
  const hash = `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${length}`;
  return {hash, length};
}
