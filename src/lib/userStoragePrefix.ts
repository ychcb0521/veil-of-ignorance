/**
 * 当前登录用户在 localStorage 里的键前缀（sim_<userId>_ / sim_anon_）。
 *
 * 从 usePersistedState 里抽出来单独成模块：消息中心这类非 React 的模块也要按用户分区，
 * 而不少测试会整体 mock 掉 usePersistedState——若前缀逻辑还住在那里，
 * 一个与本测试无关的 mock 就会把消息中心连带打坏。
 */
let sessionKey: string | undefined;
let sessionSnapshot: string | null = null;
let sessionUserId: string | null = null;

export function getUserId(): string | null {
  try {
    let raw = sessionKey ? localStorage.getItem(sessionKey) : null;
    if (raw === null) {
      sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      raw = sessionKey ? localStorage.getItem(sessionKey) : null;
    }
    if (raw !== sessionSnapshot) {
      // The storage value also changes on same-tab logout, account switches and token refresh.
      sessionSnapshot = raw;
      sessionUserId = null;
      if (raw) {
        const id = JSON.parse(raw)?.user?.id;
        if (typeof id === 'string' && id) sessionUserId = id;
      }
    }
    return sessionUserId;
  } catch {
    return null;
  }
}

export function getUserPrefix(userId = getUserId()): string {
  return userId ? `sim_${userId}_` : 'sim_anon_';
}
