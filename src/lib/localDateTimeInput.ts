/**
 * `<input type="datetime-local">` 的读写：输入框里的字是**本地**墙钟时间（精确到分钟），不带时区。
 *
 * 不能用 `toISOString().slice(0, 16)` 预填：那是 UTC 墙钟，而 `new Date('YYYY-MM-DDTHH:mm')` 按本地时间解析，
 * 东八区里一来一回就早了 8 小时（结束战役对话框曾因此把 closed_at 存得比模拟时钟早 8 小时）。
 */

/** 时刻（ISO 字符串或毫秒）→ 输入框里的本地墙钟 `YYYY-MM-DDTHH:mm`；无效时刻给空串。 */
export function toLocalDateTimeInputValue(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => `${part}`.padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 输入框里的本地墙钟 → ISO 字符串；空串或解析不了时给 fallback。 */
export function fromLocalDateTimeInputValue(value: string, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
