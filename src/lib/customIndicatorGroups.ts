import { SELLER_RETENTION_SPECS } from '@/lib/sellerRetention';
import {SELLER_FOCUS_FEATURES,type DeepDigFeatureDef} from '@/lib/deepDig/features';

/** Shared presentation groups for the custom indicator menu and Deep dig directory. */
export const CUSTOM_INDICATOR_GROUPS = [
  { key: 'balance', featureIds: ['cbi2', 'mbi', 'mbi2', 'mbi2-bear', 'mbi-bear', 'ctba', 'ctba_12h', 'ctba_12h-bear', 'ctba-bear', 'cdi2', 'drift-speed', 'drift-speed-z', 'seller-control', 'state', 'state2'], title: '当下的多空平衡', ids: ['CBI2', 'MBI', 'MBI2', 'MBI2_BEAR', 'MBI_BEAR', 'CTBA', 'CTBA_12H', 'CTBA_12H_BEAR', 'CTBA_BEAR', 'CDI2', 'DSP_VA', 'DSP_Z', 'SELLER_CONTROL', 'STATE', 'STATE2'], note: '0：模型多空方向分界；状态 S / S2 使用 0–1 刻度。' },
  { key: 'history', featureIds: ['bss', 'dss'], title: '与过去24 小时相比', ids: ['BSS', 'DSS'], note: '0：相对历史与主动性的综合中性点。', detail: '动量与相对量分量以过去 24 小时为基线标准化，并叠加主动买卖分量；0 不等于各分量都与过去完全相同。' },
  { key: 'advantage', featureIds: ['cba', 'cda'], title: '是否保住单边优势', ids: ['CBA', 'CDA'], note: '0：净保留的单边优势为零。' },
  {key:'seller-retention',featureIds:SELLER_RETENTION_SPECS.map(s=>s.id),ids:SELLER_RETENTION_SPECS.map(s=>s.chartId),title:'卖方成果保留（独立副本）',note:'0：综合均衡参考；负值表示卖方倾向。原算法与新增位移分量共同决定。'},
  {key:'seller-focus-v2',featureIds:SELLER_FOCUS_FEATURES.map(d=>d.id),ids:SELLER_FOCUS_FEATURES.map(d=>'FEATURE_'+d.id),title:'空方特征 · 版本2（近2小时加权）',note:'保留原窗口，最近2小时的相对权重为更早数据的3倍；独立公式，可分别研究与选择。'},
] as const;

export function groupDeepDigFeatures(defs: readonly DeepDigFeatureDef[]) {
  const visible = defs.filter(d => !d.removed), assigned = new Set<string>();
  const groups = CUSTOM_INDICATOR_GROUPS.map(g => ({ key:g.key, title:g.title, items:g.featureIds.flatMap(id => {
    const def = visible.find(d => d.id === id);
    if (!def) return [];
    assigned.add(id); return [def];
  }) })).filter(g => g.items.length);
  const focus=groups.find(g=>g.key==='seller-focus-v2');
  const extraFocus=visible.filter(d=>d.focusVersion===2&&!assigned.has(d.id));
  if(extraFocus.length){if(focus)focus.items.push(...extraFocus);else groups.push({key:'seller-focus-v2',title:'空方特征 · 版本2（近2小时加权）',items:extraFocus});extraFocus.forEach(d=>assigned.add(d.id));}
  const other = visible.filter(d => !assigned.has(d.id));
  return other.length ? [...groups,{key:'other',title:'其他特征值',items:other}] : groups;
}
