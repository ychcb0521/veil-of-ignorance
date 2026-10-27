/** 2026-10-27：捕捞与批量挖掘共用的四项门槛，全部同时满足。仅含数据，供同步层安全导入。 */
export const FISH_DEFAULT_RULES = [
  { id: 'first', featureId: 'cbi2', statistic: 'avg_CBI2_2', threshold: '0.04' },
  { id: 'default-cba', featureId: 'cba', statistic: 'avg_CBA_2', threshold: '8' },
  { id: 'default-cbi2-avg', featureId: 'cbi2', statistic: 'avg_CBI2', threshold: '0.04' },
  { id: 'default-cba-avg', featureId: 'cba', statistic: 'avg_CBA', threshold: '8' },
] as const;
export const MINING_PRESET_REVISION = 2;
