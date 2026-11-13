import { useCallback, useEffect, useState } from 'react';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { FISH_INSTANT_MONITOR_KEY, INSTANT_TEMPLATE_MONITOR, instantMonitorTemplateIssue, readInstantMonitorSettings } from '@/lib/fish/instantMonitorSettings';
import type { QualityPlanTemplate } from '@/lib/fish/qualityPlanTemplates';
import type { QualityGroup } from '@/lib/fish/quality';
import { persistFishAccountPreference } from './useFishAccountSettings';

export function useInstantMonitorSettings(owner: string | undefined) {
  const [saved, setSaved] = useState(() => ({ owner, settings: owner ? readInstantMonitorSettings(owner) : undefined }));
  useEffect(() => {
    if (!owner) return;
    const key = getUserPrefix(owner) + FISH_INSTANT_MONITOR_KEY;
    const refresh = () => setSaved({ owner, settings: readInstantMonitorSettings(owner) });
    const onStorage = (event: StorageEvent) => { if (event.key === key) refresh(); };
    const unsubscribe = subscribePersistedStateHydration(key, refresh);
    window.addEventListener('storage', onStorage);
    refresh();
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage); };
  }, [owner]);
  const save = useCallback(async (template?: QualityPlanTemplate & { plan: QualityGroup }) => {
    if (!owner) throw new Error('请先登录后保存持仓监测设置');
    const issue = template && instantMonitorTemplateIssue(template);
    if (issue) throw new Error(issue);
    const settings = template ? {
      version: INSTANT_TEMPLATE_MONITOR, templateId: template.id, name: template.name, plan: structuredClone(template.plan),
    } : null;
    await persistFishAccountPreference(owner, FISH_INSTANT_MONITOR_KEY, settings);
  }, [owner]);
  return { settings: saved.owner === owner ? saved.settings : undefined, save };
}
