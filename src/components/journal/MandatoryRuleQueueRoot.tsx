/**
 * 全局挂载点：监听 'journal:reviewed' 事件，扫描 critical patterns
 * 并依次弹出 MandatoryRuleDialog，直到队列清空。
 */
import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCriticalPatternQueue } from '@/hooks/useCriticalPatternQueue';
import { MandatoryRuleDialog } from './MandatoryRuleDialog';

export function MandatoryRuleQueueRoot() {
  const { user } = useAuth();
  const { current, scan, resolveCurrent } = useCriticalPatternQueue(user?.id ?? null);

  useEffect(() => {
    if (!user) return;
    // 登录后做一次初次扫描
    scan();
    const handler = () => { scan(); };
    window.addEventListener('journal:reviewed', handler);
    return () => window.removeEventListener('journal:reviewed', handler);
  }, [user, scan]);

  if (!user || !current) return null;
  return (
    <MandatoryRuleDialog
      info={current}
      userId={user.id}
      onResolved={resolveCurrent}
    />
  );
}
