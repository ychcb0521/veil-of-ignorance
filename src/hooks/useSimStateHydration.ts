import { useEffect, useState } from 'react';
import { hydrateSimState } from '@/lib/simStateSync';

export const SIM_STATE_HYDRATION_TIMEOUT_MS = 4_000;

/**
 * 首次挂载交易树前尽量恢复该账号；4 秒后仍放行，晚到的数据由恢复订阅接入。
 * 就绪属于本次登录的账号，不能把上个账号（或退出前）的就绪状态复用给新会话。
 */
export function useSimStateHydration(userId: string | null | undefined): boolean {
  const [readyUserId, setReadyUserId] = useState<string | null>(null);
  useEffect(() => {
    setReadyUserId(null);
    if (!userId) return;
    let cancelled = false;
    const markReady = () => { if (!cancelled) setReadyUserId(userId); };
    const timeout = setTimeout(markReady, SIM_STATE_HYDRATION_TIMEOUT_MS);
    // 同步失败不阻塞离线使用。成功/失败均处理，避免 finally 留下未处理的拒绝。
    const finish = () => {
      clearTimeout(timeout);
      markReady();
    };
    void hydrateSimState(userId).then(finish, finish);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [userId]);
  return !userId || readyUserId === userId;
}
