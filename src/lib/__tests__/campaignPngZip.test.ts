import { Blob as NodeBlob, Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCampaignPngZip } from '@/lib/campaignPngZip';

const exportedAt = '2026-09-20T12:34:56';

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 0x7075（Info-ZIP Unicode Path）：版本 1、头里文件名的 CRC32、UTF-8 文件名；没有这个字段时返回 null。 */
function parseUnicodePathExtra(extra: Uint8Array, headerName: Uint8Array): string | null {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let offset = 0; offset + 4 <= extra.length;) {
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    if (id === 0x7075) {
      expect(view.getUint8(offset + 4)).toBe(1);
      expect(view.getUint32(offset + 5, true)).toBe(crc32(headerName));
      expect(size).toBe(5 + headerName.length);
      return new TextDecoder().decode(extra.subarray(offset + 9, offset + 4 + size));
    }
    offset += 4 + size;
  }
  return null;
}

async function inspectZip(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const end = buffer.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 4, true)).toBe(0);
  expect(view.getUint16(end + 6, true)).toBe(0);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const directorySize = view.getUint32(end + 12, true);
  const directoryStart = view.getUint32(end + 16, true);
  expect(directoryStart + directorySize).toBe(end);
  let centralOffset = directoryStart;
  const entries = [];
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    // 制作系统写 Unix（3）、规范 2.0：macOS 命令行 unzip 才按原字节落盘 UTF-8 文件名；外部属性给普通文件 rw-r--r--
    expect(view.getUint16(centralOffset + 4, true)).toBe(0x0314);
    expect(view.getUint32(centralOffset + 38, true)).toBe((0o100644 << 16) >>> 0);
    expect(view.getUint16(centralOffset + 8, true)).toBe(0x0800);
    expect(view.getUint16(centralOffset + 10, true)).toBe(0);
    const crc = view.getUint32(centralOffset + 16, true);
    const size = view.getUint32(centralOffset + 20, true);
    expect(view.getUint32(centralOffset + 24, true)).toBe(size);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const nameBytes = new Uint8Array(buffer, centralOffset + 46, nameLength);
    const name = decoder.decode(nameBytes);
    const centralExtra = new Uint8Array(buffer, centralOffset + 46 + nameLength, extraLength);
    const local = view.getUint32(centralOffset + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 6, true)).toBe(0x0800);
    expect(view.getUint16(local + 8, true)).toBe(0);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(size);
    expect(view.getUint32(local + 22, true)).toBe(size);
    expect(view.getUint16(local + 26, true)).toBe(nameLength);
    expect(view.getUint16(local + 28, true)).toBe(extraLength);
    expect(decoder.decode(new Uint8Array(buffer, local + 30, nameLength))).toBe(name);
    expect([...new Uint8Array(buffer, local + 30 + nameLength, extraLength)]).toEqual([...centralExtra]);
    entries.push({ name, crc, size, bytes: new Uint8Array(buffer, local + 30 + nameLength + extraLength, size),
      date: view.getUint16(local + 12, true), time: view.getUint16(local + 10, true),
      unicodePath: parseUnicodePathExtra(centralExtra, nameBytes) });
    centralOffset += 46 + nameLength + extraLength;
  }
  expect(centralOffset).toBe(end);
  return entries;
}

describe('buildCampaignPngZip', () => {
  // jsdom 20 的 Blob 未实现 arrayBuffer；Node Blob 与浏览器标准 Blob API 一致。
  beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('writes standard ZIP store headers, CRC32, UTF-8 names, sizes and matching directory offsets', async () => {
    const files = [
      { name: '001 BTC 战役.png', blob: new Blob(['123456789']) },
      { name: '002 镜像止盈.png', blob: new Blob(['hello world']) },
      { name: '003 空.png', blob: new Blob([]) },
    ];
    const blob = await buildCampaignPngZip(files, { exportedAt });
    expect(blob.type).toBe('application/zip');
    const entries = await inspectZip(blob);
    expect(entries.map(entry => entry.name)).toEqual(files.map(file => file.name));
    // 中文文件名另带一份 0x7075 Unicode Path，内容与头里的 UTF-8 文件名相同
    expect(entries.map(entry => entry.unicodePath)).toEqual(files.map(file => file.name));
    expect(entries.map(entry => entry.crc)).toEqual([0xcbf43926, 0x0d4a1185, 0]);
    expect(entries.map(entry => new TextDecoder().decode(entry.bytes))).toEqual(['123456789', 'hello world', '']);
    expect(entries[0].date).toBe(((2026 - 1980) << 9) | (9 << 5) | 20);
    expect(entries[0].time).toBe((12 << 11) | (34 << 5) | 28);
    expect(files[0].name).toBe('001 BTC 战役.png');
  });

  it('preserves order and safely disambiguates identical names on case-insensitive filesystems', async () => {
    const names = ['A.png', 'a.png', 'A.png', 'a (2).png'];
    const entries = await inspectZip(await buildCampaignPngZip(names.map(name => ({ name, blob: new Blob(['x']) }))));
    expect(entries.map(entry => entry.name)).toEqual(['A.png', 'a (2).png', 'A (3).png', 'a (2) (2).png']);
    // 纯 ASCII 的文件名不带 0x7075
    expect(entries.map(entry => entry.unicodePath)).toEqual([null, null, null, null]);
  });

  it('removes traversal separators, controls, reserved characters and empty names', async () => {
    const names = ['../../x.png', '..\\evil.png', 'bad\u0000:name?.png', '... ', ''];
    const entries = await inspectZip(await buildCampaignPngZip(names.map(name => ({ name, blob: new Blob(['x']) }))));
    expect(entries.map(entry => entry.name)).toEqual(['.._.._x.png', '.._evil.png', 'bad__name_.png', '战役.png', '战役 (2).png']);
  });

  it('keeps CRC state across chunks', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 17).map((_, index) => index % 251);
    let referenceCrc = 0xffffffff;
    for (const byte of bytes) {
      referenceCrc ^= byte;
      for (let bit = 0; bit < 8; bit++) referenceCrc = (referenceCrc >>> 1) ^ ((referenceCrc & 1) ? 0xedb88320 : 0);
    }
    const [entry] = await inspectZip(await buildCampaignPngZip([{ name: 'large.png', blob: new Blob([bytes]) }]));
    expect(entry.crc).toBe((referenceCrc ^ 0xffffffff) >>> 0);
    expect(Buffer.compare(Buffer.from(entry.bytes), Buffer.from(bytes))).toBe(0);
  });

  it('rejects empty archives and invalid export timestamps', async () => {
    await expect(buildCampaignPngZip([])).rejects.toThrow('没有可打包');
    await expect(buildCampaignPngZip([{ name: 'x.png', blob: new Blob([]) }], { exportedAt: 'invalid' })).rejects.toThrow('导出时间无效');
  });

  it.each([0xffffffff, 2 ** 32, -1, Number.NaN, 1.5])('rejects invalid or ZIP64 individual sizes (%s) before reading', async size => {
    const slice = vi.fn();
    await expect(buildCampaignPngZip([{ name: 'x.png', blob: { size, slice } as unknown as Blob }])).rejects.toThrow('单张图片');
    expect(slice).not.toHaveBeenCalled();
  });

  it('checks combined directory and header sizes, not only image bytes', async () => {
    const slice = vi.fn();
    await expect(buildCampaignPngZip([{ name: 'x.png', blob: { size: 0xffffffff - 50, slice } as unknown as Blob }])).rejects.toThrow('4 GB');
    expect(slice).not.toHaveBeenCalled();
  });

  it('checks entry-count and UTF-8 filename byte limits', async () => {
    const file = { name: 'x.png', blob: new Blob([]) };
    await expect(buildCampaignPngZip(Array(65535).fill(file))).rejects.toThrow('65534');
    await expect(buildCampaignPngZip([{ ...file, name: '😀'.repeat(16384) }])).rejects.toThrow('文件名过长');
  });

  it('clamps dates outside the DOS date range without corrupting the header', async () => {
    const files = [{ name: 'x.png', blob: new Blob([]) }];
    const [old] = await inspectZip(await buildCampaignPngZip(files, { exportedAt: '1970-01-01T00:00:00' }));
    const [future] = await inspectZip(await buildCampaignPngZip(files, { exportedAt: '2200-12-31T23:59:59' }));
    expect(old.date >>> 9).toBe(0);
    expect(future.date >>> 9).toBe(127);
  });

  it('rejects an already-cancelled operation without reading input files', async () => {
    const controller = new AbortController();
    controller.abort();
    const slice = vi.fn();
    await expect(buildCampaignPngZip([{ name: 'x.png', blob: { size: 3, slice } as unknown as Blob }], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(slice).not.toHaveBeenCalled();
  });

  it('yields while processing large images so a cancel event can stop packaging', async () => {
    const controller = new AbortController();
    const result = buildCampaignPngZip([{ name: 'large.png', blob: new Blob([new Uint8Array(8 * 1024 * 1024)]) }], { signal: controller.signal });
    setTimeout(() => controller.abort(), 0);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
