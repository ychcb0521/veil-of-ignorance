import { describe, expect, it } from 'vitest';
import { deserializeAccountBlob, serializeAccountBlob } from '../accountBlobCodec';
import { deserializeAccountBlobStream } from '../accountBlobStream';

function bytes(text: string, size = 7) {
  const encoded = new TextEncoder().encode(text); let offset = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === encoded.length) controller.close();
    else { controller.enqueue(encoded.subarray(offset, offset + size)); offset = Math.min(encoded.length, offset + size); }
  } });
}
describe('incremental account archive decoding', () => {
  it('matches the existing codec across UTF-8 boundaries and every special value', async () => {
    const original = { text: '无知之幕🚀\n"\\', nested: [{ a: null, b: true, c: false, n: -1.23e90 }],
      map: new Map([['中文', new Set([NaN, Infinity, -Infinity, new Date(12345)])]]), empty: {}, list: [] };
    const json = serializeAccountBlob(original);
    expect(await deserializeAccountBlobStream(bytes(json, 1))).toEqual(deserializeAccountBlob(json));
  });
  it.each(['null', 'false', '123', '"中文"', '[]', '{}'])('reads root %s', async json => {
    expect(await deserializeAccountBlobStream(bytes(json))).toEqual(JSON.parse(json));
  });
  it.each(['', '{"a":', '[1,', '{"a":1} garbage'])('rejects incomplete or invalid input %s', async json => {
    await expect(deserializeAccountBlobStream(bytes(json))).rejects.toThrow();
  });
  it('retains an own __proto__ field without mutating object prototypes', async () => {
    const json = '{"__proto__":{"polluted":true},"constructor":"kept"}';
    const value = await deserializeAccountBlobStream(bytes(json)) as object;
    expect(value).toEqual(JSON.parse(json)); expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
  it('shares equal frozen definitions without changing their serialized content', async () => {
    const json = JSON.stringify({ rows: [{ plan: { formula: 'C+1', version: 'v1' } }, { plan: { formula: 'C+1', version: 'v1' } }] });
    const value = await deserializeAccountBlobStream(bytes(json)) as { rows: { plan: object }[] };
    expect(serializeAccountBlob(value)).toBe(json); expect(value.rows[0].plan).toBe(value.rows[1].plan);
  });
  it('accepts a large stream without requiring an archive-sized source string', async () => {
    let index = 0; const chunk = new TextEncoder().encode(' '.repeat(64 * 1024));
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (index++ < 32) controller.enqueue(chunk);
      else if (index === 33) controller.enqueue(new TextEncoder().encode('{"kept":true}'));
      else controller.close();
    } });
    expect(await deserializeAccountBlobStream(stream)).toEqual({ kept: true });
  });
});
