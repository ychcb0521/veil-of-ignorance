import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CRITICAL_STORAGE_HEADROOM_CHARS, clearPersistedStateMemoryForTests, ensureCriticalStorageHeadroom,
  measureRebuildableCaches, writeRebuildableCache,
} from '@/lib/persistedStateStorage';

/** 让 localStorage 像真浏览器一样有总量上限：只在变大且超限时拒绝，sessionStorage 不受影响。 */
function enforceQuota(limit: number) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === localStorage) {
      let others = 0;
      for (let index = 0; index < this.length; index += 1) {
        const existing = this.key(index)!;
        if (existing !== key) others += existing.length + (this.getItem(existing)?.length ?? 0);
      }
      const previous = this.getItem(key);
      const grows = previous === null || value.length > previous.length;
      if (grows && others + key.length + value.length > limit) throw new DOMException('full', 'QuotaExceededError');
    }
    original.call(this, key, value);
  });
}

const used = () => Object.keys(localStorage).reduce((sum, key) => sum + key.length + localStorage.getItem(key)!.length, 0);
const fill = (key: string, chars: number) => localStorage.setItem(key, 'd'.repeat(chars - key.length));

beforeEach(() => { localStorage.clear(); clearPersistedStateMemoryForTests(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('给登录令牌留的存储余量', () => {
  it('有余量时什么都不动，探针不留痕迹', () => {
    localStorage.setItem('campaign-price-path-v3:u:1', 'derived');
    enforceQuota(100_000);
    expect(ensureCriticalStorageHeadroom()).toBe('ok');
    expect(Object.keys(localStorage)).toEqual(['campaign-price-path-v3:u:1']);
  });

  it('写满时只清可重建的图表缓存，清到够用为止，交易数据与令牌原样保留', () => {
    const limit = 60_000;
    fill('sim_u_trade_history', 30_000);
    localStorage.setItem('sb-ref-auth-token', '{"expires_at":1}');
    for (let index = 0; index < 20; index += 1) fill(`campaign-price-path-v3:u:${index}`, 1_000);
    fill('campaign-unrealized-chart-v1:u', limit - used());
    expect(used()).toBe(limit);
    enforceQuota(limit);

    expect(ensureCriticalStorageHeadroom()).toBe('reclaimed');
    expect(limit - used()).toBeGreaterThanOrEqual(CRITICAL_STORAGE_HEADROOM_CHARS);
    expect(localStorage.getItem('sim_u_trade_history')).toHaveLength(30_000 - 'sim_u_trade_history'.length);
    expect(localStorage.getItem('sb-ref-auth-token')).toBe('{"expires_at":1}');
    // 够用就停：不是把缓存一把清光。
    expect(measureRebuildableCaches().entries).toBeGreaterThan(0);
    expect(Object.keys(localStorage).some(key => key.includes('headroom-probe'))).toBe(false);
  });

  it('没有缓存可清时如实报告写满，不碰任何别的键', () => {
    const limit = 40_000;
    fill('sim_u_trade_history', limit - 'sb-ref-auth-token'.length - 4);
    localStorage.setItem('sb-ref-auth-token', 'full');
    enforceQuota(limit);
    const before = Object.keys(localStorage).sort();
    expect(ensureCriticalStorageHeadroom()).toBe('full');
    expect(Object.keys(localStorage).sort()).toEqual(before);
  });

  it('浏览器不让写本地存储时不删缓存', () => {
    localStorage.setItem('campaign-price-path-v3:u:1', 'derived');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(ensureCriticalStorageHeadroom()).toBe('unavailable');
    expect(localStorage.getItem('campaign-price-path-v3:u:1')).toBe('derived');
  });

  it('缓存写入会让出最后一段空间：占掉余量的那一条不留，令牌随后仍写得进去', () => {
    const limit = 50_000;
    fill('sim_u_trade_history', limit - CRITICAL_STORAGE_HEADROOM_CHARS - 2_000);
    enforceQuota(limit);
    expect(writeRebuildableCache('campaign-price-path-v3:u:small', 'x'.repeat(500))).toBe(true);
    expect(writeRebuildableCache('campaign-unrealized-chart-v1:u', 'x'.repeat(1_600))).toBe(false);
    expect(localStorage.getItem('campaign-unrealized-chart-v1:u')).toBeNull();
    expect(localStorage.getItem('campaign-price-path-v3:u:small')).toHaveLength(500);
    // 一枚比旧令牌更长的新令牌仍然存得进去。
    expect(() => localStorage.setItem('sb-ref-auth-token', 't'.repeat(4_000))).not.toThrow();
  });

  it('启动入口在挂载界面之前探余量，两处图表缓存都走让位写入', () => {
    const read = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');
    const main = read('main.tsx');
    expect(main.indexOf('ensureCriticalStorageHeadroom()')).toBeGreaterThan(-1);
    expect(main.indexOf('ensureCriticalStorageHeadroom()')).toBeLessThan(main.indexOf('createRoot('));
    for (const hook of ['hooks/useCampaignPricePaths.ts', 'hooks/useUnrealizedChartSnapshot.ts']) {
      expect(read(hook), hook).toContain('writeRebuildableCache(');
      expect(read(hook), hook).not.toContain('localStorage.setItem');
    }
  });
});
