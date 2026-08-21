import { describe, expect, it } from 'vitest';
import {
  buildCampaignDayIndex,
  hasCampaignOnSignalDay,
  normalizeSymbolKey,
  utc8DateKey,
} from '@/lib/signalCampaignIndex';
import type { TradeCampaign } from '@/types/journal';

const campaign = (symbol: string, openedAt: string): TradeCampaign =>
  ({ symbol, opened_at: openedAt } as TradeCampaign);

/** 2026-08-11 22:47 UTC+8 = 14:47Z */
const SIGNAL = { symbol: 'VELVETUSDT', timeMs: Date.parse('2026-08-11T14:47:00Z') };

describe('utc8DateKey', () => {
  it('按 UTC+8 折日，与信号时间的解释口径一致', () => {
    expect(utc8DateKey(Date.parse('2026-08-11T14:47:00Z'))).toBe('2026-08-11');
    // UTC 的 16:00 已经是 UTC+8 的次日 00:00
    expect(utc8DateKey(Date.parse('2026-08-11T16:00:00Z'))).toBe('2026-08-12');
    // UTC+8 当日最后一刻仍属当天
    expect(utc8DateKey(Date.parse('2026-08-11T15:59:59Z'))).toBe('2026-08-11');
  });

  it('非有限数返回 null', () => {
    expect(utc8DateKey(Number.NaN)).toBeNull();
  });
});

describe('normalizeSymbolKey', () => {
  it('大写并剥离分隔符，多种写法都能对上', () => {
    for (const s of ['RUNEUSDT', 'rune/usdt', 'RUNE-USDT', 'Rune_Usdt']) {
      expect(normalizeSymbolKey(s)).toBe('RUNEUSDT');
    }
    expect(normalizeSymbolKey(null)).toBe('');
  });
});

describe('hasCampaignOnSignalDay', () => {
  it('同标的同日 → 命中', () => {
    const index = buildCampaignDayIndex([campaign('VELVETUSDT', '2026-08-11T02:15:00Z')]);
    expect(hasCampaignOnSignalDay(index, SIGNAL)).toBe(true);
  });

  it('同标的不同日 → 不命中', () => {
    const index = buildCampaignDayIndex([campaign('VELVETUSDT', '2026-08-10T02:15:00Z')]);
    expect(hasCampaignOnSignalDay(index, SIGNAL)).toBe(false);
  });

  it('同日不同标的 → 不命中', () => {
    const index = buildCampaignDayIndex([campaign('LUNA2USDT', '2026-08-11T02:15:00Z')]);
    expect(hasCampaignOnSignalDay(index, SIGNAL)).toBe(false);
  });

  it('标的写法不同也能对上', () => {
    const index = buildCampaignDayIndex([campaign('velvet/usdt', '2026-08-11T02:15:00Z')]);
    expect(hasCampaignOnSignalDay(index, SIGNAL)).toBe(true);
  });

  it('跨零点：UTC 当日 16:00 后开的战役算次日，不会错配给前一天的信号', () => {
    // 战役开在 UTC+8 的 2026-08-12 00:30
    const index = buildCampaignDayIndex([campaign('VELVETUSDT', '2026-08-11T16:30:00Z')]);
    expect(hasCampaignOnSignalDay(index, SIGNAL)).toBe(false);
    // 而次日的信号能命中
    expect(hasCampaignOnSignalDay(index, {
      symbol: 'VELVETUSDT', timeMs: Date.parse('2026-08-12T01:00:00Z'),
    })).toBe(true);
  });

  it('缺字段的战役被跳过，不炸也不误命中', () => {
    const index = buildCampaignDayIndex([
      { symbol: '', opened_at: '2026-08-11T02:00:00Z' } as TradeCampaign,
      { symbol: 'VELVETUSDT', opened_at: '' } as TradeCampaign,
      { symbol: 'VELVETUSDT', opened_at: 'not-a-date' } as TradeCampaign,
    ]);
    expect(index.size).toBe(0);
    expect(hasCampaignOnSignalDay(index, SIGNAL)).toBe(false);
  });

  it('同标的同日多场战役只登记一次', () => {
    const index = buildCampaignDayIndex([
      campaign('VELVETUSDT', '2026-08-11T02:00:00Z'),
      campaign('VELVETUSDT', '2026-08-11T09:00:00Z'),
    ]);
    expect(index.size).toBe(1);
  });
});
