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

