import { readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';

export const FISH_INSTANT_POSITION_KEY = 'fish-instant-position.v1';
export interface InstantPositionSettings {
  version: 1;
  availableUsdt: number;
  marginPct: number;
  leverage: number;
  /** Present only on an admission sized with a fresh read of the linked Binance account. */
  balanceObservedAt?: number;
  liveBalanceIssue?: string;
}

// 800 × 5% preserves the original default simulated margin of 40 USDT.
export const DEFAULT_INSTANT_POSITION: Readonly<InstantPositionSettings> = { version: 1, availableUsdt: 800, marginPct: 5, leverage: 5 };

type BalanceReader = (signal: AbortSignal) => Promise<string>;
const readers = new Map<string, BalanceReader>();

export function registerInstantBalanceReader(owner: string, reader: BalanceReader) {
  readers.set(owner, reader);
  return () => { if (readers.get(owner) === reader) readers.delete(owner); };
}

export async function freezeLivePositionBudget(owner: string, settings: InstantPositionSettings, signal: AbortSignal): Promise<InstantPositionSettings> {
  if (settings.balanceObservedAt || settings.liveBalanceIssue) return settings;
  const reader = readers.get(owner);
  try {
    if (!reader) throw Error('币安余额未连接');
    const availableUsdt = Number(await reader(signal));
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    const position = { ...settings, availableUsdt, balanceObservedAt: Date.now() };
    sizeInstantEntry(position);
    return position;
  } catch (cause) {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    return { ...settings, liveBalanceIssue: cause instanceof Error ? cause.message : '币安余额读取失败' };
  }
}

export function sizeInstantEntry(settings: InstantPositionSettings) {
  const { availableUsdt, marginPct, leverage } = settings;
  if (settings.version !== 1) throw Error('无法识别仓位设置版本');
  if (!Number.isFinite(availableUsdt) || availableUsdt <= 0) throw Error('可用资金须大于 0 USDT');
  if (!Number.isFinite(marginPct) || marginPct <= 0 || marginPct > 100) throw Error('保证金比例须大于 0 且不超过 100%');
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 125) throw Error('杠杆须为 1 至 125 的整数');
  const marginUsdt = availableUsdt * (marginPct / 100);
  const notional = marginUsdt * leverage;
  if (!Number.isFinite(notional) || marginUsdt <= 0) throw Error('首仓金额超出有效范围');
  return { marginUsdt, notional, leverage };
}

export function readInstantPositionSettings(owner: string): InstantPositionSettings | undefined {
  const raw = readPersistedStateRaw(getUserPrefix(owner) + FISH_INSTANT_POSITION_KEY);
  if (raw == null || raw === 'null') return { ...DEFAULT_INSTANT_POSITION };
  const settings = JSON.parse(raw) as InstantPositionSettings;
  sizeInstantEntry(settings);
  return { version: 1, availableUsdt: settings.availableUsdt, marginPct: settings.marginPct, leverage: settings.leverage };
}
