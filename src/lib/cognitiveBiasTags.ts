/**
 * 认知偏差标签 — 批次 24 芒格双轨分析
 * 痛苦/情绪标签是「情绪轨」（你能感觉到）；认知偏差是「认知轨」（你意识不到，更要主动查）。
 */

export interface CognitiveBiasTag {
  id: string;
  label: string;
  hint: string;
}

export const COGNITIVE_BIAS_TAGS = [
  { id: 'anchoring', label: '锚定', hint: '盯着成本价' },
  { id: 'sunk_cost', label: '沉没成本', hint: '已投入太多研究/时间' },
  { id: 'confirmation', label: '确认偏误', hint: '只读支持我观点的内容' },
  { id: 'social_proof', label: '社会认同', hint: '朋友/社群在做这个方向' },
  { id: 'narrative', label: '叙事谬误', hint: '被一个完美的故事吸引' },
  { id: 'none', label: '无', hint: '已自查，无明显认知偏差' },
] as const satisfies readonly CognitiveBiasTag[];

export type CognitiveBiasTagId = (typeof COGNITIVE_BIAS_TAGS)[number]['id'];

/** The "no bias" sentinel — mutually exclusive with every real bias tag. */
export const COGNITIVE_BIAS_NONE: CognitiveBiasTagId = 'none';

export const COGNITIVE_BIAS_LABELS: Record<string, string> = Object.fromEntries(
  COGNITIVE_BIAS_TAGS.map(tag => [tag.id, tag.label]),
);
