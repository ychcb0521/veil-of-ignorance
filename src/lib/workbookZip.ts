type ZipEntry = {
  method: number;
  packed: number;
  size: number;
  local: number;
};

const MAX_XML_BYTES = 32 * 1024 * 1024;

export function openZipBytes(buffer: ArrayBuffer, maxEntryBytes: number) {
  if (buffer.byteLength < 22) throw Error('ZIP 文件不完整');
  const view = new DataView(buffer);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const decoder = new TextDecoder();
  let end = buffer.byteLength - 22;
  const low = Math.max(0, end - 0xffff);
  while (end >= low && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== buffer.byteLength)) end--;
  if (end < low || u16(end + 4) || u16(end + 6)) throw new Error('无法识别 Excel 文件结构');
  const entries = new Map<string, ZipEntry>();
  let at = u32(end + 16);
  for (let i = 0; i < u16(end + 10); i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) throw new Error('Excel 文件目录损坏');
    const nameLength = u16(at + 28);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLength));
    if (at + 46 + nameLength > end || entries.has(name)) throw Error('ZIP 文件目录损坏');
    entries.set(name, { method: u16(at + 10), packed: u32(at + 20), size: u32(at + 24), local: u32(at + 42) });
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
  }

  return async (name: string): Promise<Uint8Array<ArrayBuffer> | undefined> => {
    const entry = entries.get(name);
    if (!entry) return undefined;
    if (entry.size > maxEntryBytes || entry.packed > maxEntryBytes) throw new Error('ZIP 条目超过大小限制');
    const { local, method } = entry;
    if (u32(local) !== 0x04034b50 || (method !== 0 && method !== 8)) throw new Error('Excel 文件压缩格式不受支持');
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    const packed = new Uint8Array(buffer, start, entry.packed);
    let bytes = packed;
    if (method === 8) {
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader();
      const output = new Uint8Array(entry.size);
      let offset = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (offset + value.length > output.length) throw new Error('Excel 工作表解压长度不符');
          output.set(value, offset);
          offset += value.length;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      bytes = output.subarray(0, offset);
    }
    if (bytes.length !== entry.size) throw new Error('Excel 文件数据不完整');
    return bytes;
  };
}

export function openWorkbookZip(buffer: ArrayBuffer) {
  const read = openZipBytes(buffer, MAX_XML_BYTES);
  return async (name: string): Promise<Document | undefined> => {
    const bytes = await read(name);
    if (!bytes) return undefined;
    const decoder = new TextDecoder();
    const xml = new DOMParser().parseFromString(decoder.decode(bytes), 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('Excel 工作表内容损坏');
    return xml;
  };
}
