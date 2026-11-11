import { useState } from 'react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { FishPreEntryThreeStageSettings } from './FishPreEntryThreeStageSettings';
import {SettingsImageScope} from './SettingsImageExport';

/**
 * 动态筛选的条件设置面板：只剩三阶准入。
 * 旧版筛选（入选确认 / 三组否决 / 卖出排除）连同方案集下拉一起下线；
 * 已保存的旧方案由 FishPreEntryThreeStageSettings 自动转成「三阶副本」再编辑。
 */
export function FishPreEntrySettings(props: { state: FishQualityState; selectedCount: number; done: () => void }) {
  const savedRevision = props.state.preEntry?.library.settings?.updatedAt ?? 'new';
  // Keep a chosen template draft mounted when screening history finishes loading.
  const [draftRevision, setDraftRevision] = useState<number | string>();
  return <SettingsImageScope title="动态筛选条件">
    <FishPreEntryThreeStageSettings key={draftRevision ?? savedRevision} {...props}
      onUseTemplate={() => setDraftRevision(revision => revision ?? savedRevision)}/>
  </SettingsImageScope>;
}
