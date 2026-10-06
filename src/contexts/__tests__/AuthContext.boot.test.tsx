import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));
const reloadPage = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth,
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock('@/lib/authBootRecovery', async (original) => ({
  ...(await original<typeof import('@/lib/authBootRecovery')>()),
  reloadPage,
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { AUTH_BOOT_TIMEOUT_MS } from '@/lib/authBootRecovery';
import { AuthBootRecoveryScreen } from '@/components/AuthBootRecoveryScreen';

type AuthValue = ReturnType<typeof useAuth>;
let latest: AuthValue;
function Probe() {
  latest = useAuth();
  if (latest.loading && latest.bootIssue) return <AuthBootRecoveryScreen issue={latest.bootIssue} />;
  return <div data-testid="state">{latest.loading ? 'loading' : latest.user ? 'signed-in' : 'signed-out'}</div>;
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>);
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const stolen = () => Object.assign(new Error('Lock "lock:sb-ref-auth-token" was released because another request stole it'), { isAcquireTimeout: true });
const session = { user: { id: 'user-1', email_confirmed_at: '2026-01-01' }, access_token: 'a', refresh_token: 'r' };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  Object.values(auth).forEach(mock => mock.mockReset());
  auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
  reloadPage.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });

describe('登录态恢复不再无限转圈', () => {
  it('正常恢复：进入应用，没有任何提示', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    const view = mount();
    await flush();
    expect(view.getByTestId('state').textContent).toBe('signed-in');
    expect(latest.bootIssue).toBeNull();
    await flush(AUTH_BOOT_TIMEOUT_MS * 2);
    expect(latest.bootIssue).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('登录锁被抢：自动重载一次；重载后还是被抢，就摆出原因与现场读数', async () => {
    auth.getSession.mockRejectedValue(stolen());
    const first = mount();
    await flush();
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(latest.bootIssue).toBeNull();
    first.unmount();

    // 同一个标签页重载之后（sessionStorage 还在）。
    const second = mount();
    await flush();
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(latest.loading).toBe(true);
    expect(latest.bootIssue?.kind).toBe('lock-stolen');
    const screen = second.getByTestId('auth-boot-recovery');
    expect(screen.textContent).toContain('登录态没能恢复');
    expect(screen.textContent).toContain('登录锁被另一个无知之幕标签页抢走了');
    expect(screen.textContent).toContain('another request stole it');
    expect(screen.textContent).toContain('veil-build:');
  });

  it('本地存储写满：先清可重建缓存腾位置，再自动重载', async () => {
    localStorage.setItem('campaign-price-path-v3:u:1', 'x'.repeat(40_000));
    localStorage.setItem('sim_user-1_trade_history', '[1]');
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      // 缓存还在时一个字也写不进去。
      if (this === localStorage && localStorage.getItem('campaign-price-path-v3:u:1') !== null) throw new DOMException('full', 'QuotaExceededError');
      original.call(this, key, value);
    });
    auth.getSession.mockRejectedValue(new DOMException('exceeded the quota', 'QuotaExceededError'));
    mount();
    await flush();
    expect(localStorage.getItem('campaign-price-path-v3:u:1')).toBeNull();
    expect(localStorage.getItem('sim_user-1_trade_history')).toBe('[1]');
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('写满且无缓存可清：不重载，直接说明', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage) {
      if (this === localStorage) throw new DOMException('full', 'QuotaExceededError');
    });
    auth.getSession.mockRejectedValue(new DOMException('exceeded the quota', 'QuotaExceededError'));
    const view = mount();
    await flush();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(latest.bootIssue?.kind).toBe('storage-full');
    const screen = view.getByTestId('auth-boot-recovery').textContent ?? '';
    expect(screen).toContain('剩下的全是交易数据');
    // 说明与同屏读数说的是同一件事（处理器里探到的那次结果）
    expect(screen).toContain('写不下登录令牌，且已没有可清理的缓存');
  });

  it('刷新令牌的请求一直不回：到点摆出提示并继续等，回应一到自动进入', async () => {
    let resolve!: (value: unknown) => void;
    auth.getSession.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = mount();
    await flush(AUTH_BOOT_TIMEOUT_MS - 1);
    expect(view.getByTestId('state').textContent).toBe('loading');
    expect(latest.bootIssue).toBeNull();
    await flush(1);
    expect(latest.bootIssue?.kind).toBe('timeout');
    expect(view.getByTestId('auth-boot-recovery').textContent).toContain('登录态还没恢复出来');
    expect(reloadPage).not.toHaveBeenCalled();

    resolve({ data: { session }, error: null });
    await flush();
    expect(view.getByTestId('state').textContent).toBe('signed-in');
    expect(latest.bootIssue).toBeNull();
  });

  it('一般错误也不转圈：给出错误原文', async () => {
    auth.getSession.mockRejectedValue(new TypeError('Failed to fetch'));
    const view = mount();
    await flush();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(latest.bootIssue?.kind).toBe('error');
    expect(view.getByTestId('auth-boot-recovery').textContent).toContain('TypeError：Failed to fetch');
  });

  it('卸载后迟到的失败不再触发任何动作', async () => {
    let reject!: (error: unknown) => void;
    auth.getSession.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    const view = mount();
    await flush();
    view.unmount();
    reject(stolen());
    await flush(AUTH_BOOT_TIMEOUT_MS * 2);
    expect(reloadPage).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
});

describe('恢复界面的两条出路', () => {
  it('重试只重载；重新登录先清令牌再重载，交易数据不动', async () => {
    auth.getSession.mockRejectedValue(new TypeError('Failed to fetch'));
    localStorage.setItem('sb-ref-auth-token', '{}');
    localStorage.setItem('sim_user-1_trade_history', '[1]');
    const view = mount();
    await flush();
    act(() => { view.getByText('重试').click(); });
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sb-ref-auth-token')).toBe('{}');
    act(() => { view.getByText('重新登录').click(); });
    expect(reloadPage).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('sb-ref-auth-token')).toBeNull();
    expect(localStorage.getItem('sim_user-1_trade_history')).toBe('[1]');
  });
});

describe('登录时令牌存不进去', () => {
  /** 让 localStorage 有总量上限（只在变大且超限时拒绝）。 */
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
        if ((previous === null || value.length > previous.length) && others + key.length + value.length > limit) throw new DOMException('exceeded the quota', 'QuotaExceededError');
      }
      original.call(this, key, value);
    });
  }
  /** 登录库的行为：签发成功后把令牌写进本地存储，写不进就抛出配额错误。 */
  const storesToken = async () => {
    localStorage.setItem('sb-ref-auth-token', 't'.repeat(3_000));
    return { data: {}, error: null };
  };
  const used = () => Object.keys(localStorage).reduce((sum, key) => sum + key.length + localStorage.getItem(key)!.length, 0);
  const signedOut = async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mount();
    await flush();
  };

  it('【事故】存储写满、缓存早已清光：登录前先清消息记录腾位置，一次就登得进去，交易数据不动', async () => {
    const limit = 40_000;
    localStorage.setItem('sim_user-1_notification_history', 'n'.repeat(6_000));
    localStorage.setItem('sim_user-1_trade_history', 'h'.repeat(limit - used() - 'sim_user-1_trade_history'.length));
    const history = localStorage.getItem('sim_user-1_trade_history');
    enforceQuota(limit);
    await signedOut();
    auth.signInWithPassword.mockImplementation(storesToken);
    await expect(latest.signIn('a@b.c', 'pw')).resolves.toEqual({ error: null });
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sb-ref-auth-token')).toHaveLength(3_000);
    expect(localStorage.getItem('sim_user-1_notification_history')).toBeNull();
    expect(localStorage.getItem('sim_user-1_trade_history')).toBe(history);
  });

  it('实在腾不出位置：再试一次仍存不进去，就把原因和占用最大的几项直接交给登录页', async () => {
    const limit = 30_000;
    localStorage.setItem('sim_user-1_trade_history', 'h'.repeat(limit - 'sim_user-1_trade_history'.length - 10));
    enforceQuota(limit);
    await signedOut();
    auth.signInWithPassword.mockImplementation(storesToken);
    const result = await latest.signIn('a@b.c', 'pw');
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(result.error).toContain('浏览器给本站的本地存储已写满，登录令牌存不进去');
    expect(result.error).toContain('成交历史 0.03 MB');
  });

  it('别的异常变成错误文案而不是一直转圈；登录服务的拒绝原样交回', async () => {
    await signedOut();
    auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(latest.signIn('a@b.c', 'pw')).resolves.toEqual({ error: 'Failed to fetch' });
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } });
    await expect(latest.signIn('a@b.c', 'pw')).resolves.toEqual({ error: 'Invalid login credentials' });
  });

  it('令牌落盘之后把给令牌留的位置占回去：恢复出登录态时、登录成功时、退出之后', async () => {
    const RESERVE = 'veil.storage.auth-reserve';
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    mount();
    expect(localStorage.getItem(RESERVE)).toBeNull();
    await flush();
    expect(localStorage.getItem(RESERVE)).not.toBeNull();

    localStorage.removeItem(RESERVE);
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } });
    await latest.signIn('a@b.c', 'pw');
    expect(localStorage.getItem(RESERVE)).toBeNull();
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: null });
    await latest.signIn('a@b.c', 'pw');
    expect(localStorage.getItem(RESERVE)).not.toBeNull();

    localStorage.removeItem(RESERVE);
    auth.signOut.mockResolvedValue({ error: null });
    await act(async () => { await latest.signOut(); });
    expect(localStorage.getItem(RESERVE)).not.toBeNull();
  });
});
