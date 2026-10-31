const TAG = '__veilType';
function replacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)[key];
  if (raw instanceof Map) return { [TAG]: 'Map', v: [...raw] };
  if (raw instanceof Set) return { [TAG]: 'Set', v: [...raw] };
  if (raw instanceof Date) return { [TAG]: 'Date', v: raw.getTime() };
  if (typeof raw === 'number' && !Number.isFinite(raw)) return { [TAG]: 'Num', v: String(raw) };
  return value;
}
function reviver(_key: string, value: unknown): unknown {
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
export const deserializeAccountBlob = (text: string): unknown => JSON.parse(text, reviver);


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

/** Shared worker payload codec; the wire format and content fingerprint stay unchanged. */
export async function prepareAccountBlobEncoding(value:unknown,knownHash?:string):Promise<{hash:string;encoded?:{enc:'gzip'|'json';text:string;bytes:number}}>{
  const json=serializeAccountBlob(value),hash=fingerprintAccountBlob(json);
  if(hash===knownHash)return {hash};
  let enc:'gzip'|'json'='json',text=json;
  if(typeof CompressionStream==='function'){
   try {
    const stream=new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    enc='gzip';text=btoa(binary);
   } catch { /* Preserve the existing uncompressed fallback. */ }
  }
  return {hash,encoded:{enc,text,bytes:json.length}};
}
