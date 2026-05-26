/**
 * 全局挂载点：监听 'journal:reviewed' 事件，扫描 critical patterns
 * 并依次弹出 MandatoryRuleDialog，直到队列清空。
 *
 * 仅在"决策记录模式"下生效。"直接交易模式"下完全停摆——不扫描、不渲染。
 */
import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useCriticalPatternQueue } from '@/hooks/useCriticalPatternQueue';
import { MandatoryRuleDialog } from './MandatoryRuleDialog';

export function MandatoryRuleQueueRoot() {
  const { user } = useAuth();
  const { tradingMode } = useTradingContext();
  const enabled = tradingMode !== 'direct';
  const { current, scan, resolveCurrent } = useCriticalPatternQueue(
    enabled ? user?.id ?? null : null,
  );

  useEffect(() => {
    if (!user || !enabled) return;
    // 登录后做一次初次扫描
    scan();
    const handler = () => { scan(); };
    window.addEventListener('journal:reviewed', handler);
    return () => window.removeEventListener('journal:reviewed', handler);
  }, [user, scan, enabled]);

  if (!user || !enabled || !current) return null;
  return (
    <MandatoryRuleDialog
      info={current}
      userId={user.id}
      onResolved={resolveCurrent}
    />
  );
}
