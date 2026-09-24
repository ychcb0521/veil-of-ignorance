export type CampaignPngZipFile = { name: string; blob: Blob };

export type CampaignPngZipOptions = {
  exportedAt?: string;
  signal?: AbortSignal;
};

const ZIP32_LIMIT = 0xffffffff;
const ZIP16_LIMIT = 0xffff;
const CRC_CHUNK_SIZE = 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

/**
 * 「制作系统」写 Unix（高字节 3）、规范版本 2.0。写成 MS-DOS（0）时，macOS 自带的命令行 unzip（Info-ZIP 6.0，未编 Unicode 支持）
 * 会把文件名当 DOS 代码页转码，UTF-8 中文名被转坏，解压直接报「Illegal byte sequence」；写成 Unix 就按原字节落盘。
 */
const VERSION_MADE_BY_UNIX = (3 << 8) | 20;
/** 写成 Unix 后 unzip 按外部属性高 16 位取权限：给普通文件 rw-r--r--，否则解压出来的文件权限是 000。 */
const UNIX_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;
/** Info-ZIP Unicode Path 扩展字段（0x7075）：给只认它、不认通用标志位 11 的解压工具再备一份 UTF-8 文件名。 */
const UNICODE_PATH_EXTRA_ID = 0x7075;

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('已取消打包', 'AbortError');
}

async function blobCrc32(blob: Blob, signal?: AbortSignal): Promise<number> {
  let crc = 0xffffffff;
  for (let start = 0; start < blob.size; start += CRC_CHUNK_SIZE) {
    throwIfAborted(signal);
    const bytes = new Uint8Array(await blob.slice(start, start + CRC_CHUNK_SIZE).arrayBuffer());
    for (const value of bytes) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
    // 让取消点击、进度绘制有机会执行，不能只让步给连续的微任务。
    if ((start / CRC_CHUNK_SIZE + 1) % 4 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throwIfAborted(signal);
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 文件名含非 ASCII 字符时的 0x7075 扩展字段：版本 1 + 头里文件名的 CRC32 + UTF-8 文件名；纯 ASCII 的名字不需要。 */
function unicodePathExtra(name: Uint8Array): Uint8Array {
  if (name.every(value => value < 0x80)) return new Uint8Array(0);
  const extra = new Uint8Array(9 + name.length);
  const view = new DataView(extra.buffer);
  view.setUint16(0, UNICODE_PATH_EXTRA_ID, true);
  view.setUint16(2, 5 + name.length, true);
  view.setUint8(4, 1);
  view.setUint32(5, bytesCrc32(name), true);
  extra.set(name, 9);
  return extra;
}

function uniqueFileName(name: string, usedNames: Set<string>, suffixes: Map<string, number>): string {
  // ZIP 中只写平面文件名，不能包含路径、控制字符或平台保留分隔符。
  const clean = Array.from(name.normalize('NFC'), character => (
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || /[\\/:*?"<>|]/.test(character)
      ? '_' : character
  )).join('').trim().replace(/[. ]+$/, '') || '战役.png';
  const key = clean.toLowerCase();
  let candidate = clean;
  let suffix = suffixes.get(key) ?? 2;
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const extension = dot > 0 ? clean.slice(dot) : '';
  while (usedNames.has(candidate.toLowerCase())) candidate = `${stem} (${suffix++})${extension}`;
  suffixes.set(key, suffix);
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function zipTimestamp(exportedAt?: string): { date: number; time: number } {
  const date = exportedAt ? new Date(exportedAt) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error('导出时间无效');
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

/**
 * PNG 本身已压缩，使用标准 ZIP store，避免重复压缩阻塞页面。
 * 逐张分块算 CRC；Blob 直接拼接，不把所有 PNG 同时展开成 ArrayBuffer。
 * 超过经典 ZIP 的限制时明确拒绝，不能静默截断偏移、文件尺寸或条目数。
 */
export async function buildCampaignPngZip(
  files: CampaignPngZipFile[],
  options: CampaignPngZipOptions = {},
): Promise<Blob> {
  throwIfAborted(options.signal);
  if (files.length === 0) throw new Error('没有可打包的战役图片');
  if (files.length >= ZIP16_LIMIT) throw new Error('一次最多打包 65534 张图片，请分批下载');
  const usedNames = new Set<string>();
  const suffixes = new Map<string, number>();
  const encoder = new TextEncoder();
  const entries = files.map(file => {
    if (!Number.isSafeInteger(file.blob.size) || file.blob.size < 0 || file.blob.size >= ZIP32_LIMIT) {
      throw new Error('单张图片超过 ZIP 大小限制，请减少导出内容');
    }
    const name = encoder.encode(uniqueFileName(file.name, usedNames, suffixes));
    // 文件名与扩展字段（里面再存一份文件名）的长度都记在 16 位字段里
    if (name.length + 9 > ZIP16_LIMIT) throw new Error('图片文件名过长，请缩短名称');
    return { ...file, name, extra: unicodePathExtra(name) };
  });
  const localSize = entries.reduce((size, entry) => size + 30 + entry.name.length + entry.extra.length + entry.blob.size, 0);
  const directorySize = entries.reduce((size, entry) => size + 46 + entry.name.length + entry.extra.length, 0);
  if (localSize + directorySize + 22 >= ZIP32_LIMIT) throw new Error('压缩包超过 4 GB，请分批下载');

  const timestamp = zipTimestamp(options.exportedAt);
  const parts: BlobPart[] = [];
  const directory: BlobPart[] = [];
  let offset = 0;
  for (const entry of entries) {
    throwIfAborted(options.signal);
    const crc = await blobCrc32(entry.blob, options.signal);
    const local = new ArrayBuffer(30 + entry.name.length + entry.extra.length);
    const localView = new DataView(local);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 文件名
    localView.setUint16(8, 0, true); // store
    localView.setUint16(10, timestamp.time, true);
    localView.setUint16(12, timestamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.blob.size, true);
    localView.setUint32(22, entry.blob.size, true);
    localView.setUint16(26, entry.name.length, true);
    localView.setUint16(28, entry.extra.length, true);
    new Uint8Array(local, 30).set(entry.name);
    new Uint8Array(local, 30 + entry.name.length).set(entry.extra);
    parts.push(local, entry.blob);

    const central = new ArrayBuffer(46 + entry.name.length + entry.extra.length);
    const centralView = new DataView(central);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, VERSION_MADE_BY_UNIX, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, timestamp.time, true);
    centralView.setUint16(14, timestamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.blob.size, true);
    centralView.setUint32(24, entry.blob.size, true);
    centralView.setUint16(28, entry.name.length, true);
    centralView.setUint16(30, entry.extra.length, true);
    centralView.setUint32(38, UNIX_FILE_ATTRIBUTES, true);
    centralView.setUint32(42, offset, true);
    new Uint8Array(central, 46).set(entry.name);
    new Uint8Array(central, 46 + entry.name.length).set(entry.extra);
    directory.push(central);
    offset += local.byteLength + entry.blob.size;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  throwIfAborted(options.signal);
  const end = new ArrayBuffer(22);
  const endView = new DataView(end);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
