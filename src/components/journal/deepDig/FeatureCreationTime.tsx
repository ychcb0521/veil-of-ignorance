import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { featureCreation } from '@/lib/deepDig/featureCreation';
import { formatUTC8 } from '@/lib/timeFormat';

export function FeatureCreationTime({def}:{def:DeepDigFeatureDef}) {
 const creation=featureCreation(def);
 const full=creation?formatUTC8(creation.at):null;
 const detail=creation?.source==='version-history'
  ? `北京时间 ${full}（UTC+8）。原始创建时刻未记录，此处采用该内置特征首次加入项目版本的时间；提交 ${creation.commit}。不是最近修改、恢复或账号同步时间。`
  : creation?`北京时间 ${full}（UTC+8），本特征记录的创建时间，后续编辑不改变此时间。`:'历史记录没有可靠的创建时间，不以本次查看、保存或同步时间补填。';
 return <span className="ml-auto shrink-0 text-[10px] font-normal tabular-nums text-muted-foreground max-sm:ml-0 max-sm:basis-full" title={detail} data-testid={`deep-dig-created-${def.id}`} data-source={creation?.source??'unknown'}>
  {creation?<><span>创建于 </span><time dateTime={new Date(creation.at).toISOString()} aria-label={`创建时间，北京时间 ${full}`}>{full!.slice(0,16)}</time>{creation.source==='version-history'&&<span className="ml-1 text-muted-foreground/70">· 版本记录</span>}</>:'创建时间未记录'}
 </span>;
}
