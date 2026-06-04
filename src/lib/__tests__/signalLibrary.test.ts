import { describe, it, expect } from 'vitest';
import {
  parseSignalTime,
  parseSignalText,
  mergeSignals,
  sortSignalsAlpha,
  type TradeSignal,
} from '@/lib/signalLibrary';

const UTC8 = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) - 8 * 3600_000;

describe('parseSignalTime', () => {
  it('reads a full datetime as UTC+8 wall clock', () => {
    expect(parseSignalTime('2024-01-15 16:00:00')).toBe(UTC8(2024, 1, 15, 16, 0, 0));
  });

  it('accepts slash dates and HH:mm (seconds optional)', () => {
    expect(parseSignalTime('2024/01/15 16:00')).toBe(UTC8(2024, 1, 15, 16, 0, 0));
    expect(parseSignalTime('2024-01-15T16:00')).toBe(UTC8(2024, 1, 15, 16, 0, 0));
  });

  it('returns null for unparseable input', () => {
    expect(parseSignalTime('not a time')).toBeNull();
    expect(parseSignalTime('')).toBeNull();
    expect(parseSignalTime('2024-01-15')).toBeNull();
  });
});

describe('parseSignalText', () => {
  it('parses comma-separated 标的+时间+兜底区', () => {
    const { signals, errors } = parseSignalText('BTCUSDT, 2024-01-15 16:00:00, 72000-74000');
    expect(errors).toHaveLength(0);
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe('BTCUSDT');
    expect(signals[0].timeMs).toBe(UTC8(2024, 1, 15, 16, 0, 0));
    expect(signals[0].fallbackZone).toBe('72000-74000');
  });

  it('normalizes symbol (uppercase, strips slash/space) and skips header + comments', () => {
    const text = [
      'symbol,time,zone',
      'eth/usdt, 2024-02-01 09:30, 2300',
      '# a comment',
      '',
    ].join('\n');
    const { signals, errors } = parseSignalText(text);
    expect(errors).toHaveLength(0);
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe('ETHUSDT');
    expect(signals[0].fallbackZone).toBe('2300');
  });

  it('supports whitespace-separated rows and dedupes same symbol@time', () => {
    const text = [
      'SOLUSDT 2024-03-03 12:00:00 95-98',
      'SOLUSDT,2024-03-03 12:00:00,95-98',
    ].join('\n');
    const { signals } = parseSignalText(text);
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe('SOLUSDT');
    expect(signals[0].fallbackZone).toBe('95-98');
  });

  it('reports an error for an unrecognizable time but keeps good rows', () => {
    const text = ['BTCUSDT, yesterday', 'ETHUSDT, 2024-01-01 00:00'].join('\n');
    const { signals, errors } = parseSignalText(text);
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe('ETHUSDT');
    expect(errors).toHaveLength(1);
  });
});

describe('mergeSignals', () => {
  it('appends new signals and dedupes by symbol@time', () => {
    const a: TradeSignal[] = [
      { id: '1', symbol: 'BTCUSDT', timeMs: 100, timeLabel: 't', fallbackZone: '' },
    ];
    const b: TradeSignal[] = [
      { id: '2', symbol: 'BTCUSDT', timeMs: 100, timeLabel: 't', fallbackZone: 'dup' },
      { id: '3', symbol: 'ETHUSDT', timeMs: 200, timeLabel: 't', fallbackZone: '' },
    ];
    const merged = mergeSignals(a, b);
    expect(merged).toHaveLength(2);
    expect(merged.map(s => s.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
});

describe('sortSignalsAlpha', () => {
  it('sorts by symbol asc then time asc', () => {
    const list: TradeSignal[] = [
      { id: '1', symbol: 'ETHUSDT', timeMs: 50, timeLabel: 't', fallbackZone: '' },
      { id: '2', symbol: 'BTCUSDT', timeMs: 200, timeLabel: 't', fallbackZone: '' },
      { id: '3', symbol: 'BTCUSDT', timeMs: 100, timeLabel: 't', fallbackZone: '' },
    ];
    const sorted = sortSignalsAlpha(list);
    expect(sorted.map(s => `${s.symbol}@${s.timeMs}`)).toEqual([
      'BTCUSDT@100',
      'BTCUSDT@200',
      'ETHUSDT@50',
    ]);
  });
});
