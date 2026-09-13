import { describe, expect, it } from 'vitest';
import {
  ALL_CAMPAIGN_OPERATION_RANGE,
  beijingDayEnd,
  beijingDayKey,
  beijingDayStart,
  describeOperationRange,
  isAllRange,
  isWithinOperationRange,
  matchPreset,
  presetOperationRange,
  resolveRangeBounds,
  shiftDayKey,
} from '@/lib/campaignOperationRange';

const at = (text: string) => Date.parse(text);

describe('UTC+8 自然日边界', () => {
  it('起始日含 00:00:00.000，结束日含 23:59:59.999', () => {
    expect(beijingDayStart('2026-08-01')).toBe(at('2026-08-01T00:00:00.000+08:00'));
    expect(beijingDayEnd('2026-08-01')).toBe(at('2026-08-01T23:59:59.999+08:00'));
    expect(beijingDayKey(at('2026-08-01T23:59:59.999+08:00'))).toBe('2026-08-01');
    // 北京时间 00:00 整属于新的一天，而不是前一天的尾巴
    expect(beijingDayKey(at('2026-08-02T00:00:00.000+08:00'))).toBe('2026-08-02');
  });

  it('加减天数跨月跨年都对', () => {
    expect(shiftDayKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');   // 2026 不是闰年
    expect(shiftDayKey('2026-09-13', -29)).toBe('2026-08-15');
  });

  it('无效日期不炸，也不当成边界', () => {
    expect(beijingDayStart('2026-13-01')).toBeNull();
    expect(beijingDayStart('not-a-day')).toBeNull();
    expect(resolveRangeBounds({ from: 'oops', to: null })).toBeNull();
  });
});

describe('【用户要求】操作时间段筛选：默认全选', () => {
  it('默认值两端都不设界，任何战役都进——包括没有客观操作时间的', () => {
    expect(isAllRange(ALL_CAMPAIGN_OPERATION_RANGE)).toBe(true);
    expect(describeOperationRange(ALL_CAMPAIGN_OPERATION_RANGE)).toBe('全部');
    expect(isWithinOperationRange(at('2020-01-01T00:00:00+08:00'), ALL_CAMPAIGN_OPERATION_RANGE)).toBe(true);
    expect(isWithinOperationRange(null, ALL_CAMPAIGN_OPERATION_RANGE)).toBe(true);
  });

  it('设了界之后两端都含，边界那一毫秒也算在内', () => {
    const range = { from: '2026-08-01', to: '2026-08-31' };
    expect(isWithinOperationRange(at('2026-08-01T00:00:00.000+08:00'), range)).toBe(true);
    expect(isWithinOperationRange(at('2026-08-31T23:59:59.999+08:00'), range)).toBe(true);
    expect(isWithinOperationRange(at('2026-07-31T23:59:59.999+08:00'), range)).toBe(false);
    expect(isWithinOperationRange(at('2026-09-01T00:00:00.000+08:00'), range)).toBe(false);
  });

  it('一旦设了界，没有客观操作时间的战役就排除掉——它无从安放', () => {
    expect(isWithinOperationRange(null, { from: '2026-08-01', to: null })).toBe(false);
    expect(isWithinOperationRange(Number.NaN, { from: null, to: '2026-08-01' })).toBe(false);
  });

  it('只设一端时另一端不封口', () => {
    expect(isWithinOperationRange(at('2030-01-01T00:00:00+08:00'), { from: '2026-08-01', to: null })).toBe(true);
    expect(isWithinOperationRange(at('2000-01-01T00:00:00+08:00'), { from: '2026-08-01', to: null })).toBe(false);
    expect(isWithinOperationRange(at('2000-01-01T00:00:00+08:00'), { from: null, to: '2026-08-01' })).toBe(true);
  });

  it('起止写反了也按区间取，而不是给一个必然为空的结果', () => {
    const reversed = { from: '2026-08-31', to: '2026-08-01' };
    expect(isWithinOperationRange(at('2026-08-15T12:00:00+08:00'), reversed)).toBe(true);
    expect(describeOperationRange(reversed)).toBe('2026-08-01 ~ 2026-08-31');
  });

  it('区间描述', () => {
    expect(describeOperationRange({ from: '2026-08-01', to: '2026-09-13' })).toBe('2026-08-01 ~ 2026-09-13');
    expect(describeOperationRange({ from: '2026-08-01', to: null })).toBe('2026-08-01 起');
    expect(describeOperationRange({ from: null, to: '2026-09-13' })).toBe('至 2026-09-13');
  });
});

describe('预设区间', () => {
  const today = '2026-09-13';

  it('近 N 天含今天：近 7 天 = 09-07 ~ 09-13', () => {
    expect(presetOperationRange('last7', today)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(presetOperationRange('last30', today)).toEqual({ from: '2026-08-15', to: '2026-09-13' });
    expect(presetOperationRange('last90', today)).toEqual({ from: '2026-06-16', to: '2026-09-13' });
    expect(presetOperationRange('thisYear', today)).toEqual({ from: '2026-01-01', to: '2026-09-13' });
    expect(presetOperationRange('all', today)).toEqual({ from: null, to: null });
  });

  it('当前区间与预设一致时认得出来，自定义则为 null', () => {
    expect(matchPreset({ from: null, to: null }, today)).toBe('all');
    expect(matchPreset({ from: '2026-09-07', to: '2026-09-13' }, today)).toBe('last7');
    expect(matchPreset({ from: '2026-08-01', to: '2026-08-31' }, today)).toBeNull();
  });
});
