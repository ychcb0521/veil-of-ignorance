import { formatUTC8 } from './timeFormat';

/** Public REST limits apply to the IP, across accounts and app modules. */
export const BINANCE_COOLDOWN_KEY = 'veil.binance-public-cooldown.v1';
export interface BinanceCooldown { until: number; status: 418 | 429 }
let fallback: BinanceCooldown | null = null;
export function readBinanceCooldown(now = Date.now()): BinanceCooldown | null {
  let value: BinanceCooldown | null = fallback;
  try { if (typeof localStorage !== 'undefined') value = JSON.parse(localStorage.getItem(BINANCE_COOLDOWN_KEY) ?? 'null'); } catch { /* Storage may be unavailable. */ }
  return value && [418,429].includes(value.status) && Number.isFinite(value.until) && value.until > now ? value : null;
}
type RateResponse = { status: number; headers?: { get(name: string): string | null } };
/** Never cap a server-requested delay; accept delta seconds, HTTP dates and Binance's ban-until evidence. */
export function publicRateLimitDeadline(response: RateResponse, body?: unknown, now = Date.now()): number {
  const header = response.headers?.get('Retry-After')?.trim();
  let until = now + (response.status === 418 ? 120_000 : 60_000);
  if (header) {
    const seconds = Number(header), date = Date.parse(header);
    if (Number.isFinite(seconds) && seconds >= 0) until = Math.max(until, now + seconds * 1000);
    else if (Number.isFinite(date)) until = Math.max(until, date);
  }
  if (body && typeof body === 'object') {
    const b = body as { msg?: unknown; message?: unknown };
    const match = /banned until\s+(\d{10,13})/i.exec(String(b.msg ?? b.message ?? ''));
    if (match) { const stamp=Number(match[1]); until=Math.max(until,stamp < 1e12 ? stamp*1000 : stamp); }
  }
  return until;
}
export function noteBinanceRateLimit(response: RateResponse, body?: unknown): BinanceCooldown {
  if (response.status !== 418 && response.status !== 429) throw new Error('Not a Binance rate-limit response');
  const prior=readBinanceCooldown(), until=Math.max(prior?.until ?? 0,publicRateLimitDeadline(response,body));
  const value: BinanceCooldown={until,status:prior?.status===418?418:response.status};
  fallback=value;
  try { if(typeof localStorage!=='undefined')localStorage.setItem(BINANCE_COOLDOWN_KEY,JSON.stringify(value)); } catch { /* Keep this page protected even without storage. */ }
  return value;
}
export class BinanceRateLimitError extends Error {
  constructor(readonly cooldown: BinanceCooldown) { super(`币安 HTTP ${cooldown.status}：行情限频，等待至 ${formatUTC8(cooldown.until)}（UTC+8）后再试`); }
}
export function assertBinancePublicAllowed(): void {
  const cooldown=readBinanceCooldown();if(cooldown)throw new BinanceRateLimitError(cooldown);
}
