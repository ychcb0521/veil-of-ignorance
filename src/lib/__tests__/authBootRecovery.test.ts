import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_BOOT_AUTO_RELOAD_WINDOW_MS, authBootReason, claimAuthBootAutoReload, classifyAuthBootError,
  collectAuthBootDiagnostics, forgetStoredSession,
} from '@/lib/authBootRecovery';
import { BUILD_STAMP } from '@/lib/buildStamp';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });

const value = (rows: Array<{ label: string; value: string }>, label: string) => rows.find(row => row.label === label)?.value;

describe('登录态恢复失败的分类', () => {
  it('认得出登录锁被抢：发布包里类名被压缩，靠标记与文案', () => {
    // 线上那版登录库抛出的两种写法。
    expect(classifyAuthBootError(Object.assign(new Error('Lock "lock:sb-x-auth-token" was released because another request stole it'), { isAcquireTimeout: true }))).toBe('lock-stolen');
    expect(classifyAuthBootError(new Error('Lock "lock:sb-x-auth-token" was released because another request stole it'))).toBe('lock-stolen');
    expect(classifyAuthBootError(new Error('Acquiring an exclusive Navigator LockManager lock "lock:sb-x-auth-token" immediately failed'))).toBe('lock-stolen');
  });

  it('认得出本地存储写满，其余归为一般错误', () => {
    expect(classifyAuthBootError(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))).toBe('storage-full');
    expect(classifyAuthBootError(new DOMException('', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe('storage-full');
    expect(classifyAuthBootError(new Error("Failed to execute 'setItem' on 'Storage': Setting the value of 'sb-x-auth-token' exceeded the quota."))).toBe('storage-full');
    expect(classifyAuthBootError(new TypeError('Failed to fetch'))).toBe('error');
    expect(classifyAuthBootError(undefined)).toBe('error');
  });

  it('写满的说明区分「已腾出位置」与「无可清理」', () => {
    expect(authBootReason('storage-full', 'reclaimed')).toContain('重试即可');
    expect(authBootReason('storage-full', 'full')).toContain('没有可清理');
    expect(authBootReason('timeout')).toContain('回应一到会自动进入');
    expect(authBootReason('lock-stolen')).toContain('只留这一个');
  });
});

describe('自动重载的名额', () => {
  it('一分钟内只给一次，过了窗口才再给', () => {
    expect(claimAuthBootAutoReload(1_000_000)).toBe(true);
    expect(claimAuthBootAutoReload(1_000_000 + 5_000)).toBe(false);
    expect(claimAuthBootAutoReload(1_000_000 + AUTH_BOOT_AUTO_RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(claimAuthBootAutoReload(1_000_000 + AUTH_BOOT_AUTO_RELOAD_WINDOW_MS)).toBe(true);
  });

  it('记不下名额时不自动重载：否则每次重载都像第一次', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(claimAuthBootAutoReload(1_000_000)).toBe(false);
  });
});

describe('重新登录只清令牌', () => {
  it('清掉登录令牌及其附属键，交易数据与别的键不动', () => {
    localStorage.setItem('sb-ref-auth-token', '{}');
    localStorage.setItem('sb-ref-auth-token-code-verifier', 'v');
    localStorage.setItem('sb-ref-auth-token-user', '{}');
    localStorage.setItem('sim_user-1_trade_history', '[1]');
    localStorage.setItem('sim_user-1_positions_map', '{}');
    localStorage.setItem('journal_local_mirror_v1', '{}');
    expect(forgetStoredSession()).toBe(3);
    expect(Object.keys(localStorage).sort()).toEqual(['journal_local_mirror_v1', 'sim_user-1_positions_map', 'sim_user-1_trade_history']);
  });
});

describe('现场读数', () => {
  it('报版本、令牌到期、存储用量与错误，令牌内容不出现在读数里', async () => {
    const now = 1_800_000_000_000;
    localStorage.setItem('sb-ref-auth-token', JSON.stringify({ access_token: 'SECRET-ACCESS', refresh_token: 'SECRET-REFRESH', expires_at: now / 1000 - 37 * 60 }));
    localStorage.setItem('campaign-price-path-v3:u:1', 'x'.repeat(1_000));
    localStorage.setItem('sim_u_trade_history', 'y'.repeat(5_000));
    vi.stubGlobal('navigator', { onLine: true, locks: { query: async () => ({ held: [{ name: 'lock:sb-ref-auth-token' }, { name: 'other' }], pending: [{ name: 'lock:sb-ref-auth-token' }, { name: 'lock:sb-ref-auth-token' }] }) } });

    const { diagnostics, headroom } = await collectAuthBootDiagnostics(new TypeError('Failed to fetch'), now);
    expect(headroom).toBe('ok');
    expect(value(diagnostics, '版本')).toBe(BUILD_STAMP);
    expect(value(diagnostics, '网络')).toBe('在线');
    expect(value(diagnostics, '登录令牌')).toBe('已过期 37 分钟，需要刷新');
    expect(value(diagnostics, '登录锁')).toBe('持有 1 · 排队 2');
    expect(value(diagnostics, '本地存储')).toMatch(/^0\.01 MB（其中可重建缓存 0\.00 MB \/ 1 项）$/);
    expect(value(diagnostics, '存储余量')).toContain('充足');
    expect(value(diagnostics, '错误')).toBe('TypeError：Failed to fetch');
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET');
  });

  it('令牌未过期、没有令牌、读不到锁时各有说法', async () => {
    const now = 1_800_000_000_000;
    vi.stubGlobal('navigator', { onLine: false });
    expect(value((await collectAuthBootDiagnostics(undefined, now)).diagnostics, '登录令牌')).toBe('本机没有');
    localStorage.setItem('sb-ref-auth-token', JSON.stringify({ expires_at: now / 1000 + 95 * 60 }));
    const { diagnostics } = await collectAuthBootDiagnostics(undefined, now);
    expect(value(diagnostics, '登录令牌')).toBe('有效，还有 1 小时 35 分钟到期');
    expect(value(diagnostics, '登录锁')).toBe('读不出');
    expect(value(diagnostics, '网络')).toBe('浏览器报告离线');
    expect(diagnostics.some(row => row.label === '错误')).toBe(false);
  });
});
