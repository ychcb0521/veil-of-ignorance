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

  it('pads single-digit month/day/hour into a valid instant', () => {
    expect(parseSignalTime('2026-4-3 9:05')).toBe(UTC8(2026, 4, 3, 9, 5, 0));
    expect(parseSignalTime('2026-04-29 18:27')).toBe(UTC8(2026, 4, 29, 18, 27, 0));
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

describe('parseSignalText - 区块格式（日期表头 + 继承时间）', () => {
  it('日期表头下的多个标的继承同一时间，并自动补 USDT 后缀', () => {
    const text = ['2026-04-29 18:27', 'naoris 0.107', 'Moodeng 0.0608'].join('\n');
    const { signals, errors } = parseSignalText(text);
    expect(errors).toHaveLength(0);
    expect(signals).toHaveLength(2);
    expect(signals.map(s => s.symbol)).toEqual(['NAORISUSDT', 'MOODENGUSDT']);
    const t = UTC8(2026, 4, 29, 18, 27, 0);
    expect(signals.every(s => s.timeMs === t)).toBe(true);
    expect(signals[0].fallbackZone).toBe('0.107');
  });

  it('剥离「谢林兜底区」标签（无空格 / 标的紧贴 / 多空格变体），保留（无）注记', () => {
    const text = [
      '2026-04-20 21:40',
      'scrt 谢林兜底区0.112',
      'M谢林兜底区 3.4（无）',
      'siren 谢林兜底区  1.12',
    ].join('\n');
    const { signals, errors } = parseSignalText(text);
    expect(errors).toHaveLength(0);
    expect(signals.map(s => `${s.symbol}=${s.fallbackZone}`)).toEqual([
      'SCRTUSDT=0.112',
      'MUSDT=3.4（无）',
      'SIRENUSDT=1.12',
    ]);
  });

  it('剥离「补充」前缀，时间仍继承自上方日期表头', () => {
    const { signals, errors } = parseSignalText('2026-04-13 16:35\n补充on 谢林兜底区0.108');
    expect(errors).toHaveLength(0);
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe('ONUSDT');
    expect(signals[0].timeMs).toBe(UTC8(2026, 4, 13, 16, 35, 0));
    expect(signals[0].fallbackZone).toBe('0.108');
  });

  it('「无」日期行不产出信号也不报错', () => {
    const text = ['2026-04-30 19:59无', '2026-04-29 18:27', 'naoris 0.107', '2026-04-27 15:13无'].join('\n');
    const { signals, errors } = parseSignalText(text);
    expect(errors).toHaveLength(0);
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe('NAORISUSDT');
  });

  it('同一天不同时间是不同的快照锚点', () => {
    const text = [
      '2026-04-16 22:28',
      'baby 谢林兜底区 0.159',
      '2026-04-16 22:40',
      'Based 谢林兜底区 0.18',
    ].join('\n');
    const { signals } = parseSignalText(text);
    expect(signals).toHaveLength(2);
    expect(signals[0].timeMs).toBe(UTC8(2026, 4, 16, 22, 28, 0));
    expect(signals[1].timeMs).toBe(UTC8(2026, 4, 16, 22, 40, 0));
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
