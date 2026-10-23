import type { DeepDigFeatureDef } from '@/lib/deepDig/features';

/** Shared presentation groups for the custom indicator menu and Deep dig directory. */
export const CUSTOM_INDICATOR_GROUPS = [
  { key: 'balance', featureIds: ['cbi2', 'cdi2', 'drift-speed-z', 'seller-control', 'state', 'state2'], title: '当下的多空平衡', ids: ['CBI2', 'CDI2', 'DSP_Z', 'SELLER_CONTROL', 'STATE', 'STATE2'], note: '0：模型多空方向分界；状态 S / S2 使用 0–1 刻度。' },
  { key: 'history', featureIds: ['bss', 'dss'], title: '与过去24 小时相比', ids: ['BSS', 'DSS'], note: '0：相对历史与主动性的综合中性点。', detail: '动量与相对量分量以过去 24 小时为基线标准化，并叠加主动买卖分量；0 不等于各分量都与过去完全相同。' },
  { key: 'advantage', featureIds: ['cba', 'cda'], title: '是否保住单边优势', ids: ['CBA', 'CDA'], note: '0：净保留的单边优势为零。' },
] as const;

export function groupDeepDigFeatures(defs: readonly DeepDigFeatureDef[]) {
  const visible = defs.filter(d => !d.removed), assigned = new Set<string>();
  const groups = CUSTOM_INDICATOR_GROUPS.map(g => ({ key:g.key, title:g.title, items:g.featureIds.flatMap(id => {
    const def = visible.find(d => d.id === id);
    if (!def) return [];
    assigned.add(id); return [def];
  }) })).filter(g => g.items.length);
  const other = visible.filter(d => !assigned.has(d.id));
  return other.length ? [...groups,{key:'other',title:'其他特征值',items:other}] : groups;
}
