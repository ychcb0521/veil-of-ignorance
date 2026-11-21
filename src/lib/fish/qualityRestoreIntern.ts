/** Share identical immutable JSON nodes so IndexedDB's structured clone only writes
 * a frozen formula or record once. Hash collisions always get an exact comparison. */
export function qualityRestoreIntern() {
  const candidates = new Map<number, object[]>();
  const identities = new WeakMap<object, number>();
  const strings = new Map<string, string>();
  let stringChars = 0, nextId = 0;
  function mix(hash: number, n: number) { return Math.imul(hash ^ n, 16777619); }
  function textHash(s: string) {
    const n = s.length;
    let h = n;
    for (const i of [0, 1, n >>> 2, n >>> 1, n - 2, n - 1]) h = mix(h, s.charCodeAt(i));
    return h;
  }
  function valueHash(value: unknown): number {
    if (value && typeof value === 'object') {
      let id = identities.get(value);
      if (id === undefined) { id = ++nextId; identities.set(value, id); }
      return id;
    }
    if (typeof value === 'number') return mix(value | 0, (value * 0x100000) | 0);
    return textHash(String(value));
  }
  return (value: unknown): unknown => {
    if (typeof value === 'string' && value.length >= 96 && value.length <= 256_000) {
      const prior = strings.get(value);
      if (prior !== undefined) return prior;
      if (stringChars + value.length > 8_000_000) { strings.clear(); stringChars = 0; }
      stringChars += value.length;
      strings.set(value, value);
    }
    if (!value || typeof value !== 'object') return value;
    const array = Array.isArray(value);
    if (array ? value.length > 128 : Object.getPrototypeOf(value) !== Object.prototype) return value;
    const node = value as Record<string, unknown>;
    const keys = Object.keys(node);
    if (keys.length > 128) return value;
    let hash = array ? 1 : 2;
    for (const key of keys) hash = mix(mix(hash, textHash(key)), valueHash(node[key]));
    const bucket = candidates.get(hash) ?? [];
    for (const other of bucket) {
      if (array !== Array.isArray(other)) continue;
      const priorKeys = Object.keys(other);
      if (priorKeys.length === keys.length && keys.every((k, i) => k === priorKeys[i] && Object.is(node[k], (other as Record<string, unknown>)[k]))) return other;
    }
    if (bucket.length < 4) {
      bucket.push(node);
      candidates.set(hash, bucket);
      if (candidates.size > 100_000) candidates.delete(candidates.keys().next().value!);
    }
    return value;
  };
}
