/**
 * 当前登录用户在 localStorage 里的键前缀（sim_<userId>_ / sim_anon_）。
 *
 * 从 usePersistedState 里抽出来单独成模块：消息中心这类非 React 的模块也要按用户分区，
 * 而不少测试会整体 mock 掉 usePersistedState——若前缀逻辑还住在那里，
 * 一个与本测试无关的 mock 就会把消息中心连带打坏。
 */
export function getUserId(): string | null {
  try {
    const storageKey = Object.keys(localStorage).find(k =>
      k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (storageKey) {
      const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const userId = data?.user?.id;
      if (userId) return userId;
    }
  } catch {}
  return null;
}

export function getUserPrefix(): string {
  const userId = getUserId();
  return userId ? `sim_${userId}_` : 'sim_anon_';
}
