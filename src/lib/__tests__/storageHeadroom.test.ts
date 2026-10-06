import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_RESERVE_KEY, AUTH_TOKEN_ROOM_CHARS, REBUILDABLE_CACHE_BUDGET_CHARS, STORAGE_RESERVE_CHARS,
  clearPersistedStateMemoryForTests, describeStorageUsage, ensureCriticalStorageHeadroom, ensureStorageReserve,
  installAuthTokenWriteGuard, measureRebuildableCaches, resetStorageReserveClockForTests, restoreAuthStorageReserve,
  writeRebuildableCache,
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
const TOKEN = 'sb-ref-auth-token';
const HISTORY = 'sim_u_trade_history';
let uninstall: (() => void) | null = null;

beforeEach(() => { localStorage.clear(); clearPersistedStateMemoryForTests(); resetStorageReserveClockForTests(); });
afterEach(() => { uninstall?.(); uninstall = null; vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

describe('给登录令牌腾位置', () => {
  it('有位置时什么都不动，探针不留痕迹', () => {
    localStorage.setItem('campaign-price-path-v3:u:1', 'derived');
    enforceQuota(100_000);
    expect(ensureCriticalStorageHeadroom()).toBe('ok');
    expect(Object.keys(localStorage)).toEqual(['campaign-price-path-v3:u:1']);
  });

  it('写满时先放出令牌预留：够用就一条缓存也不动', () => {
    const limit = 60_000;
    expect(restoreAuthStorageReserve()).toBe(true);
    localStorage.setItem('campaign-price-path-v3:u:1', 'x'.repeat(2_000));
    fill(HISTORY, limit - used());
    enforceQuota(limit);
    expect(ensureCriticalStorageHeadroom()).toBe('reclaimed');
    expect(localStorage.getItem(AUTH_RESERVE_KEY)).toBeNull();
    expect(localStorage.getItem('campaign-price-path-v3:u:1')).toHaveLength(2_000);
    expect(limit - used()).toBeGreaterThanOrEqual(AUTH_TOKEN_ROOM_CHARS);
  });

  it('没有预留时清图表缓存：从最大的清起、够用就停；不带版本号的旧缓存同样清', () => {
    const limit = 80_000;
    fill('campaign-unrealized-chart-v1:u', 20_000);
    fill('campaign-price-path-v2:u:old', 3_000);
    for (let index = 0; index < 10; index += 1) fill(`campaign-price-path-v3:u:${index}`, 500);
    localStorage.setItem(TOKEN, '{"expires_at":1}');
    fill(HISTORY, limit - used());
    enforceQuota(limit);
    expect(ensureCriticalStorageHeadroom()).toBe('reclaimed');
    // 最大的那一条先走，一条就够：其余小缓存都还在
    expect(localStorage.getItem('campaign-unrealized-chart-v1:u')).toBeNull();
    expect(measureRebuildableCaches().entries).toBe(11);
    expect(localStorage.getItem(TOKEN)).toBe('{"expires_at":1}');
    expect(localStorage.getItem(HISTORY)).not.toBeNull();
  });

  it('【事故】缓存早已清光、存储全是交易数据：再清消息记录与行情价缓存，交易数据一个字不动', () => {
    const limit = 60_000;
    fill('sim_u_notification_history', 9_000);
    fill('sim_u_price_map', 2_000);
    fill('sim_anon_notification_history', 1_000);
    for (const key of ['sim_u_positions_map', 'sim_u_filled_orders', 'journal_local_mirror_v1', 'veil.signalLibrary.v1']) fill(key, 2_000);
    fill(HISTORY, limit - used());
    const protectedBefore = Object.fromEntries(Object.keys(localStorage).filter(key => !/notification_history|price_map/.test(key)).map(key => [key, localStorage.getItem(key)]));
    enforceQuota(limit);
    expect(ensureCriticalStorageHeadroom()).toBe('reclaimed');
    expect(limit - used()).toBeGreaterThanOrEqual(AUTH_TOKEN_ROOM_CHARS);
    for (const [key, value] of Object.entries(protectedBefore)) expect(localStorage.getItem(key), key).toBe(value);
    expect(Object.keys(localStorage).some(key => key.includes('headroom-probe'))).toBe(false);
  });

  it('能清的都清了仍然不够时如实报告写满，交易数据不动', () => {
    const limit = 40_000;
    fill(HISTORY, limit - 100);
    enforceQuota(limit);
    const before = Object.keys(localStorage).sort();
    expect(ensureCriticalStorageHeadroom()).toBe('full');
    expect(Object.keys(localStorage).sort()).toEqual(before);
  });

  it('浏览器不让写本地存储时不删任何东西', () => {
    localStorage.setItem('campaign-price-path-v3:u:1', 'derived');
    localStorage.setItem('sim_u_notification_history', '[]');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(ensureCriticalStorageHeadroom()).toBe('unavailable');
    expect(Object.keys(localStorage).sort()).toEqual(['campaign-price-path-v3:u:1', 'sim_u_notification_history']);
  });
});

describe('令牌预留：平时占着位置，交易数据挤不进来', () => {
  it('占回预留；已经在就不重写；放不下时让缓存让位，仍放不下就算了', () => {
    const limit = 30_000;
    enforceQuota(limit);
    expect(restoreAuthStorageReserve()).toBe(true);
    expect(AUTH_RESERVE_KEY.length + localStorage.getItem(AUTH_RESERVE_KEY)!.length).toBe(AUTH_TOKEN_ROOM_CHARS);
    const writes = vi.mocked(Storage.prototype.setItem).mock.calls.length;
    expect(restoreAuthStorageReserve()).toBe(true);
    expect(vi.mocked(Storage.prototype.setItem).mock.calls.length).toBe(writes);

    localStorage.removeItem(AUTH_RESERVE_KEY);
    fill('campaign-unrealized-chart-v1:u', 12_000);
    fill(HISTORY, limit - used());
    expect(restoreAuthStorageReserve()).toBe(true);
    expect(localStorage.getItem('campaign-unrealized-chart-v1:u')).toBeNull();
    expect(localStorage.getItem(AUTH_RESERVE_KEY)).not.toBeNull();

    localStorage.removeItem(AUTH_RESERVE_KEY);
    fill('sim_u_filled_orders', limit - used());
    expect(restoreAuthStorageReserve()).toBe(false);
  });

  it('交易数据把存储写到满也挤不掉预留；令牌要写时放出来正好够', () => {
    const limit = 50_000;
    enforceQuota(limit);
    restoreAuthStorageReserve();
    fill(HISTORY, limit - used());
    expect(() => localStorage.setItem(HISTORY, localStorage.getItem(HISTORY)! + 'x')).toThrow();
    expect(ensureCriticalStorageHeadroom()).toBe('reclaimed');
    expect(() => localStorage.setItem(TOKEN, 't'.repeat(4_000))).not.toThrow();
  });
});

describe('【用户要求】缓存让出余量：要始终有位置可用', () => {
  it('启动时核对：合计超过上限的从最大的清起；剩余空间不足余量时继续清，直到够或缓存清完', () => {
    const limit = 3_000_000;
    fill('campaign-unrealized-chart-v1:u', 700_000);
    fill('campaign-unrealized-chart-v1:bin', 500_000);
    for (let index = 0; index < 40; index += 1) fill(`campaign-price-path-v3:u:${index}`, 2_000);
    fill(HISTORY, 1_000_000);
    enforceQuota(limit);
    expect(measureRebuildableCaches().chars).toBeGreaterThan(REBUILDABLE_CACHE_BUDGET_CHARS);
    expect(ensureStorageReserve()).toBe('ok');
    // 超上限：最大的那一条走了，其余还在
    expect(localStorage.getItem('campaign-unrealized-chart-v1:u')).toBeNull();
    expect(localStorage.getItem('campaign-unrealized-chart-v1:bin')).not.toBeNull();
    expect(measureRebuildableCaches().chars).toBeLessThanOrEqual(REBUILDABLE_CACHE_BUDGET_CHARS);

    // 交易数据长到只剩不足余量：缓存继续让位
    fill('sim_u_filled_orders', limit - used() - 10_000);
    expect(ensureStorageReserve()).toBe('reclaimed');
    expect(limit - used()).toBeGreaterThanOrEqual(STORAGE_RESERVE_CHARS);
    expect(localStorage.getItem(HISTORY)).toHaveLength(1_000_000 - HISTORY.length);
  });

  it('缓存清完仍不够余量时报写满，但不碰消息记录：那一层只留给登录令牌', () => {
    const limit = 200_000;
    fill('sim_u_notification_history', 5_000);
    fill(HISTORY, limit - used() - 1_000);
    enforceQuota(limit);
    expect(ensureStorageReserve()).toBe('full');
    expect(localStorage.getItem('sim_u_notification_history')).not.toBeNull();
  });

  it('缓存写入后按间隔核对余量：占掉余量时由最大的缓存先让位，令牌与交易数据随后仍写得进去', () => {
    vi.useFakeTimers();
    const limit = 400_000;
    fill(HISTORY, limit - STORAGE_RESERVE_CHARS - 30_000);
    enforceQuota(limit);
    expect(writeRebuildableCache('campaign-unrealized-chart-v1:u', 'x'.repeat(20_000))).toBe(true);
    // 间隔之内连着写的小缓存不逐条探：先都留下
    for (let index = 0; index < 20; index += 1) expect(writeRebuildableCache(`campaign-price-path-v3:u:${index}`, 'x'.repeat(900))).toBe(true);
    expect(limit - used()).toBeLessThan(STORAGE_RESERVE_CHARS);
    // 过了间隔的下一次写入核对余量：最大的缓存让位，刚写的这一条小的留着
    vi.advanceTimersByTime(2_001);
    expect(writeRebuildableCache('campaign-price-path-v3:u:last', 'x'.repeat(900))).toBe(true);
    expect(localStorage.getItem('campaign-unrealized-chart-v1:u')).toBeNull();
    expect(limit - used()).toBeGreaterThanOrEqual(STORAGE_RESERVE_CHARS);
    expect(() => localStorage.setItem(TOKEN, 't'.repeat(4_000))).not.toThrow();
  });

  it('本来就写不进的缓存不留、不报错', () => {
    enforceQuota(1_000);
    expect(writeRebuildableCache('campaign-price-path-v3:u:big', 'x'.repeat(5_000))).toBe(false);
    expect(localStorage.getItem('campaign-price-path-v3:u:big')).toBeNull();
  });
});

describe('令牌写不进去的那一刻当场腾位置', () => {
  it('【事故】存储写满时登录令牌仍然存得进去：清消息记录后再写一次', () => {
    const limit = 50_000;
    fill('sim_u_notification_history', 6_000);
    fill(HISTORY, limit - used());
    enforceQuota(limit);
    uninstall = installAuthTokenWriteGuard();
    expect(() => localStorage.setItem(TOKEN, 't'.repeat(3_000))).not.toThrow();
    expect(localStorage.getItem(TOKEN)).toHaveLength(3_000);
    expect(localStorage.getItem('sim_u_notification_history')).toBeNull();
    expect(localStorage.getItem(HISTORY)).not.toBeNull();
  });

  it('每小时刷新时令牌变长了几个字也写得进去；只接管令牌键，别的键照旧报错', () => {
    const limit = 50_000;
    restoreAuthStorageReserve();
    localStorage.setItem(TOKEN, 't'.repeat(3_000));
    fill(HISTORY, limit - used());
    enforceQuota(limit);
    uninstall = installAuthTokenWriteGuard();
    expect(() => localStorage.setItem(TOKEN, 't'.repeat(3_040))).not.toThrow();
    expect(localStorage.getItem(TOKEN)).toHaveLength(3_040);
    expect(() => localStorage.setItem('sim_u_orders_map', 'x'.repeat(20_000))).toThrow(/full/);
    expect(localStorage.getItem('sim_u_orders_map')).toBeNull();
  });

  it('实在腾不出位置时把原来的错误交回登录库；卸载后恢复原样', () => {
    const limit = 20_000;
    fill(HISTORY, limit - 50);
    const quota = enforceQuota(limit);
    uninstall = installAuthTokenWriteGuard();
    expect(() => localStorage.setItem(TOKEN, 't'.repeat(3_000))).toThrow(/full/);
    uninstall();
    uninstall = null;
    expect(Storage.prototype.setItem).toBe(quota);
  });
});

describe('占用明细与接线', () => {
  it('按类别报占用最大的几项，只读长度；令牌预留不算进去', () => {
    fill('sim_u1_trade_history', 30_000);
    fill('sim_u1_cancelled_orders', 8_000);
    fill('sim_u1_filled_orders', 5_000);
    fill('sim_u1_replay_timelines_v1', 2_000);
    fill('campaign-price-path-v3:u:1', 1_000);
    fill('some.other.key', 500);
    restoreAuthStorageReserve();
    const usage = describeStorageUsage(3);
    expect(usage.totalChars).toBe(46_500);
    expect(usage.categories).toEqual([
      { label: '成交历史', chars: 30_000 }, { label: '撤单快照', chars: 8_000 }, { label: '已成交委托', chars: 5_000 },
    ]);
  });

  it('启动入口在挂载界面之前装守卫、腾位置、核对余量；两处图表缓存都走让位写入', () => {
    const read = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');
    const main = read('main.tsx');
    const order = ['installAuthTokenWriteGuard();', 'ensureCriticalStorageHeadroom();', "ensureStorageReserve() === 'full'", 'createRoot('].map(text => main.indexOf(text));
    expect(order.every(index => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const hook of ['hooks/useCampaignPricePaths.ts', 'hooks/useUnrealizedChartSnapshot.ts']) {
      expect(read(hook), hook).toContain('writeRebuildableCache(');
      expect(read(hook), hook).not.toContain('localStorage.setItem');
    }
  });
});
