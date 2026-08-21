import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRADING_PREFERENCES,
  clampPrefLeverage,
  resolveInitialSymbolSetup,
} from '@/lib/tradingPreferences';

describe('clampPrefLeverage', () => {
  it('夹在 1–50 之间并取整（与币安该面板的滑条范围一致）', () => {
    expect(clampPrefLeverage(0)).toBe(1);
    expect(clampPrefLeverage(-5)).toBe(1);
    expect(clampPrefLeverage(999)).toBe(50);
    expect(clampPrefLeverage(10.4)).toBe(10);
    expect(clampPrefLeverage(10.6)).toBe(11);
  });

  it('非有限数退回出厂默认，不产生 NaN 杠杆', () => {
    expect(clampPrefLeverage(Number.NaN)).toBe(DEFAULT_TRADING_PREFERENCES.defaultLeverage);
  });
});

describe('resolveInitialSymbolSetup', () => {
  const prefs = { ...DEFAULT_TRADING_PREFERENCES, useDefaultLeverage: true, defaultLeverage: 20 };

  it('已显式设置过的标的一律以其为准——默认设置不得覆盖既有选择', () => {
    expect(resolveInitialSymbolSetup(prefs, 5, 'cross')).toEqual({ leverage: 5, marginMode: 'cross' });
  });

  it('未设置过的标的采用默认杠杆', () => {
    expect(resolveInitialSymbolSetup(prefs, null, null).leverage).toBe(20);
  });

  it('开关关闭时不给杠杆，交回系统默认', () => {
    const off = { ...prefs, useDefaultLeverage: false };
    expect(resolveInitialSymbolSetup(off, null, null).leverage).toBeNull();
  });

  it('默认保证金模式出厂即逐仓——与「全仓是硬阻断」自洽', () => {
    expect(DEFAULT_TRADING_PREFERENCES.defaultMarginMode).toBe('isolated');
    expect(resolveInitialSymbolSetup(DEFAULT_TRADING_PREFERENCES, null, null).marginMode).toBe('isolated');
  });

  it('默认杠杆越界时也被夹住，不会把 999x 传给引擎', () => {
    const wild = { ...prefs, defaultLeverage: 999 };
    expect(resolveInitialSymbolSetup(wild, null, null).leverage).toBe(50);
  });
});
