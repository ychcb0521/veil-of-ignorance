/** Repainting/zooming revisits the same timestamps. Cache formatting per timezone formatter. */
export function cacheChartDateFormatter<T extends object>(format: (formatter: T, timestamp: number, pattern: string) => string) {
  const caches = new WeakMap<T, Map<string, string>>();
  return (formatter: T, timestamp: number, pattern: string): string => {
    let values = caches.get(formatter);
    if (!values) { values = new Map(); caches.set(formatter, values); }
    const key = `${timestamp}|${pattern}`, hit = values.get(key);
    if (hit !== undefined) return hit;
    const result = format(formatter, timestamp, pattern);
    if (values.size >= 8192) values.delete(values.keys().next().value!);
    values.set(key, result);
    return result;
  };
}
