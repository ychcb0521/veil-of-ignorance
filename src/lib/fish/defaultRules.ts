/** 2026-10-27：捕捞与批量挖掘共用的四项门槛，全部同时满足。仅含数据，供同步层安全导入。 */
export const FISH_DEFAULT_RULES = [
  { id: 'first', featureId: 'cbi2', statistic: 'avg_CBI2_2', threshold: '0.04' },
  { id: 'default-cba', featureId: 'cba', statistic: 'avg_CBA_2', threshold: '8' },
  { id: 'default-cbi2-avg', featureId: 'cbi2', statistic: 'avg_CBI2', threshold: '0.04' },
  { id: 'default-cba-avg', featureId: 'cba', statistic: 'avg_CBA', threshold: '8' },
] as const;
export const MINING_PRESET_REVISION = 2;
/**
 * 【用户要求】2026-10-28「鱼质量的批量挖掘那里，是默认算法的并集，而不是交集」：任一默认算法命中即挖到。
 * 已按交集扫过的档不重扫（用户选择保留进度），挖掘库按「算法 + 合并方式」分开记录，前后两段各成一条运行记录。
 */
export const MINING_COMBINATION: 'and' | 'or' = 'or';
