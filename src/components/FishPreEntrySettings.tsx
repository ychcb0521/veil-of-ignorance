import type { FishQualityState } from '@/hooks/useFishQuality';
import { FishPreEntryThreeStageSettings } from './FishPreEntryThreeStageSettings';

/**
 * 动态筛选的条件设置面板：只剩三阶准入。
 * 旧版筛选（入选确认 / 三组否决 / 卖出排除）连同方案集下拉一起下线；
 * 已保存的旧方案由 FishPreEntryThreeStageSettings 自动转成「三阶副本」再编辑。
 */
export function FishPreEntrySettings(props: { state: FishQualityState; selectedCount: number; done: () => void }) {
  return <FishPreEntryThreeStageSettings key={props.state.preEntry?.library.settings?.updatedAt ?? 'new'} {...props} />;
}
