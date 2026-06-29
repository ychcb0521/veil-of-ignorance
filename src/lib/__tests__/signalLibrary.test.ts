import { describe, it, expect } from 'vitest';
import {
  parseSignalTime,
  parseSignalText,
  serializeSignals,
  mergeSignals,
  getDefaultSignals,
  loadSignals,
  saveSignals,
  sortSignalsAlpha,
  sortSignalsByTime,
  signalMonthKey,
  listSignalMonths,
  SIGNAL_LIBRARY_STORAGE_KEY,
  SIGNAL_LIBRARY_DEFAULT_VERSION,
  SIGNAL_LIBRARY_DEFAULT_VERSION_KEY,
  type TradeSignal,
} from '@/lib/signalLibrary';
import { DEFAULT_SIGNAL_LIBRARY_TEXT } from '@/lib/defaultSignalLibrary';

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

describe('sortSignalsByTime', () => {
  const mk = (id: string, symbol: string, timeMs: number): TradeSignal =>
    ({ id, symbol, timeMs, timeLabel: 't', fallbackZone: '' });

  it('defaults to newest-first (desc), tie-break by symbol asc', () => {
    const list = [
      mk('1', 'ETHUSDT', 100),
      mk('2', 'BTCUSDT', 300),
      mk('3', 'XRPUSDT', 200),
      mk('4', 'AAVEUSDT', 300),
    ];
    expect(sortSignalsByTime(list).map(s => `${s.symbol}@${s.timeMs}`)).toEqual([
      'AAVEUSDT@300',
      'BTCUSDT@300',
      'XRPUSDT@200',
      'ETHUSDT@100',
    ]);
  });

  it('asc puts earliest first', () => {
    const list = [
      mk('1', 'ETHUSDT', 100),
      mk('2', 'BTCUSDT', 300),
      mk('3', 'XRPUSDT', 200),
    ];
    expect(sortSignalsByTime(list, 'asc').map(s => s.timeMs)).toEqual([100, 200, 300]);
  });
});

describe('serializeSignals ↔ parseSignalText 互逆（导出可原样再导入）', () => {
  /** 比较两组信号在 {symbol,timeMs,fallbackZone} 上是否等价（忽略 id / timeLabel，按 symbol@time 排序）。 */
  const canon = (list: TradeSignal[]) =>
    [...list]
      .sort((a, b) => (a.timeMs - b.timeMs) || a.symbol.localeCompare(b.symbol))
      .map(s => `${s.symbol}@${s.timeMs}=${s.fallbackZone}`);

  it('空库序列化为空串', () => {
    expect(serializeSignals([])).toBe('');
  });

  it('导出后再解析，标的 / 时间 / 兜底区完全一致', () => {
    const mk = (symbol: string, t: string, zone: string): TradeSignal =>
      ({ id: symbol + t, symbol, timeMs: parseSignalTime(t)!, timeLabel: t, fallbackZone: zone });
    const original: TradeSignal[] = [
      mk('NAORISUSDT', '2026-04-29 18:27:00', '0.107'),
      mk('MOODENGUSDT', '2026-04-29 18:27:00', ''),          // 同一时间 → 同一表头
      mk('TACUSDT', '2026-04-28 21:00:30', '0.0127'),         // 带秒 → 不能丢
      mk('BTCUSDT', '2024-01-15 16:00:00', '72000-74000'),    // 带空格的区间
    ];
    const { signals: reparsed, errors } = parseSignalText(serializeSignals(original));
    expect(errors).toHaveLength(0);
    expect(reparsed).toHaveLength(original.length);
    expect(canon(reparsed)).toEqual(canon(original));
  });

  it('同一时间的多条信号归到一个日期表头下', () => {
    const mk = (symbol: string, t: string): TradeSignal =>
      ({ id: symbol, symbol, timeMs: parseSignalTime(t)!, timeLabel: t, fallbackZone: '' });
    const text = serializeSignals([
      mk('BUSDT', '2026-04-29 18:27:00'),
      mk('AUSDT', '2026-04-29 18:27:00'),
    ]);
    // 只有一个日期表头行（出现一次），组内按标的字母序
    const headerCount = text.split('\n').filter(l => /^\d{4}-/.test(l)).length;
    expect(headerCount).toBe(1);
    expect(text.indexOf('AUSDT')).toBeLessThan(text.indexOf('BUSDT'));
  });
});

describe('signalMonthKey', () => {
  it('groups by UTC+8 wall-clock month', () => {
    expect(signalMonthKey(parseSignalTime('2026-04-29 18:27')!)).toBe('2026-04');
    expect(signalMonthKey(parseSignalTime('2026-04-30 23:59')!)).toBe('2026-04');
    // 5/1 02:00 UTC+8 是 4/30 18:00 UTC，但月份按 UTC+8 墙钟 → 2026-05
    expect(signalMonthKey(parseSignalTime('2026-05-01 02:00')!)).toBe('2026-05');
    expect(signalMonthKey(parseSignalTime('2026-01-01 00:00')!)).toBe('2026-01');
  });
});

describe('listSignalMonths', () => {
  it('returns distinct months, most recent first (cross-year)', () => {
    const mk = (sym: string, t: string): TradeSignal => ({
      id: sym, symbol: sym, timeMs: parseSignalTime(t)!, timeLabel: t, fallbackZone: '',
    });
    const months = listSignalMonths([
      mk('A', '2026-03-10 10:00'),
      mk('B', '2026-04-29 18:27'),
      mk('C', '2026-04-01 09:00'),
      mk('D', '2025-12-31 23:00'),
    ]);
    expect(months).toEqual(['2026-04', '2026-03', '2025-12']);
  });
});

describe('default signal library', () => {
  it('parses the bundled default library from the provided source text', () => {
    const parsedDefault = parseSignalText(DEFAULT_SIGNAL_LIBRARY_TEXT);
    expect(parsedDefault.errors).toHaveLength(0);

    const defaults = getDefaultSignals();
    expect(defaults.length).toBe(parsedDefault.signals.length);
    expect(defaults.length).toBeGreaterThan(850);
    expect(defaults[0]).toMatchObject({
      id: expect.stringMatching(/^default-RAVEUSDT-/),
      symbol: 'RAVEUSDT',
      fallbackZone: '0.477',
    });
    expect(defaults.some(s => s.symbol === 'KGENUSDT' && s.timeLabel === '2026-06-28 02:36:00' && s.fallbackZone === '0.221')).toBe(true);
    expect(defaults.some(s => s.symbol === 'BLUAIUSDT' && s.timeLabel === '2026-06-06 17:09:00' && s.fallbackZone === '0.017')).toBe(true);
    expect(defaults.some(s => s.symbol === 'PUMPBTCUSDT' && s.timeLabel === '2025-09-22 18:33:00')).toBe(true);
    expect(defaults.some(s => s.symbol === 'PROMPTUSDT' && s.fallbackZone === '0.475')).toBe(true);
  });

  it('uses the bundled library only before the user has a local signal library', () => {
    window.localStorage.removeItem(SIGNAL_LIBRARY_STORAGE_KEY);
    window.localStorage.removeItem(SIGNAL_LIBRARY_DEFAULT_VERSION_KEY);
    expect(loadSignals().length).toBe(getDefaultSignals().length);

    saveSignals([]);
    expect(loadSignals()).toEqual([]);

    const custom: TradeSignal[] = [
      { id: 'custom-1', symbol: 'BTCUSDT', timeMs: 100, timeLabel: '2026-01-01 00:00:00', fallbackZone: '1' },
    ];
    saveSignals(custom);
    expect(loadSignals()).toEqual(custom);
  });

  it('migrates an old saved bundled library by merging in the updated defaults', () => {
    const oldBundled: TradeSignal[] = [
      {
        id: 'default-JTOUSDT-old',
        symbol: 'JTOUSDT',
        timeMs: parseSignalTime('2026-06-15 23:14:00')!,
        timeLabel: '2026-06-15 23:14:00',
        fallbackZone: '0.708',
      },
    ];
    window.localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(oldBundled));
    window.localStorage.removeItem(SIGNAL_LIBRARY_DEFAULT_VERSION_KEY);

    const migrated = loadSignals();

    expect(migrated.some(s => s.symbol === 'JTOUSDT' && s.timeLabel === '2026-06-15 23:14:00')).toBe(true);
    expect(migrated.some(s => s.symbol === 'RAVEUSDT' && s.timeLabel === '2026-06-29 16:19:00')).toBe(true);
    expect(window.localStorage.getItem(SIGNAL_LIBRARY_DEFAULT_VERSION_KEY)).toBe(SIGNAL_LIBRARY_DEFAULT_VERSION);
  });

  it('does not merge bundled defaults into a legacy custom-only library', () => {
    const custom: TradeSignal[] = [
      { id: 'custom-legacy', symbol: 'BTCUSDT', timeMs: 100, timeLabel: '2026-01-01 00:00:00', fallbackZone: '1' },
    ];
    window.localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(custom));
    window.localStorage.removeItem(SIGNAL_LIBRARY_DEFAULT_VERSION_KEY);

    expect(loadSignals()).toEqual(custom);
  });
});
