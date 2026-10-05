import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersistedStateMemoryForTests, getUnpersistedStateRaw,
  readPersistedStateRaw, removePersistedStateRaw, writePersistedStateRaw,
} from '@/lib/persistedStateStorage';

beforeEach(() => { localStorage.clear(); clearPersistedStateMemoryForTests(); });
afterEach(() => { vi.restoreAllMocks(); clearPersistedStateMemoryForTests(); });

describe('critical persisted state', () => {
  it.each([false, true])('does not resurrect deleted failed writes, blocked removal=%s', (blocked) => {
    const key = 'sim_test_document';
    localStorage.setItem(key, '"old"');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    writePersistedStateRaw(key, '"new"');
    if (blocked) vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    removePersistedStateRaw(key);
    expect(readPersistedStateRaw(key)).toBeNull();
    expect(localStorage.getItem(key)).toBe(blocked ? '"old"' : null);
  });

  it('reads current session data after an unsuccessful write without losing the previous durable value', () => {
    const key = 'sim_test_cancelled_orders';
    localStorage.setItem(key, '["old"]');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(writePersistedStateRaw(key, '["old","new"]')).toBe(false);
    expect(localStorage.getItem(key)).toBe('["old"]');
    expect(readPersistedStateRaw(key)).toBe('["old","new"]');
    expect(getUnpersistedStateRaw(key)).toBe('["old","new"]');
    expect(readPersistedStateRaw('sim_other_cancelled_orders')).toBeNull();
    set.mockRestore();
    expect(writePersistedStateRaw(key, '["saved"]')).toBe(true);
    expect(getUnpersistedStateRaw(key)).toBeUndefined();
    expect(readPersistedStateRaw(key)).toBe('["saved"]');
  });

  it('reclaims only rebuildable chart data and stops as soon as the critical write succeeds', () => {
    const disposable = 'campaign-unrealized-chart-v1:test';
    const laterCache = 'campaign-price-path-v3:test';
    const protectedKeys = ['sim_test_trade_history', 'sim_test_filled_orders', 'sim_test_cancelled_orders',
      'journal_local_mirror_v1', 'sb-test-auth-token', 'sim_test_balance', 'veil.signalLibrary.v1'];
    protectedKeys.forEach(key => localStorage.setItem(key, 'protected'));
    localStorage.setItem(disposable, 'derived');
    localStorage.setItem(laterCache, 'derived');
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, raw) {
      if (key === 'sim_test_orders_map' && localStorage.getItem(disposable)) throw new DOMException('full', 'QuotaExceededError');
      original.call(this, key, raw);
    });
    expect(writePersistedStateRaw('sim_test_orders_map', '{"TESTUSDT":[]}')).toBe(true);
    expect(localStorage.getItem(disposable)).toBeNull();
    expect(localStorage.getItem(laterCache)).toBe('derived');
    protectedKeys.forEach(key => expect(localStorage.getItem(key)).toBe('protected'));
    expect(getUnpersistedStateRaw('sim_test_orders_map')).toBeUndefined();
  });

  it('does not delete cache on security errors, and unavailable reads do not hide current state', () => {
    const cache = 'campaign-price-path-v3:keep';
    localStorage.setItem(cache, 'derived');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(writePersistedStateRaw('sim_test_orders_map', '{}')).toBe(false);
    expect(localStorage.getItem(cache)).toBe('derived');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(readPersistedStateRaw('sim_test_orders_map')).toBe('{}');
    expect(readPersistedStateRaw('missing')).toBeNull();
  });
});
