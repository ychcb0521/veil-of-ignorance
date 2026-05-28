/**
 * 默认开仓前 checklist 配置（4 必填 + 4 可选）
 * 通过条件：4 必填全部勾选 且 4 可选至少勾选 2 项；
 * 此外，所有"规则注入项"中 required=true 的也必须勾选。
 */

import type { TradingRule } from '@/types/journal';

export interface ChecklistDefItem {
  id: string;
  label: string;
  required: boolean;
  /** 来源：默认条目 or 用户规则 */
  source?: 'default' | 'rule';
  sourceRuleId?: string;
  sourcePatternId?: string | null;
}

export const DEFAULT_PRE_TRADE_CHECKLIST: ChecklistDefItem[] = [
  { id: 'risk_capped',        label: '已明确本次愿意承受的最大亏损金额，并已规划风险控制方式', required: true, source: 'default' },
  { id: 'take_profit_set',    label: '已设置止盈策略（非镜像 1:1）',        required: true,  source: 'default' },
  { id: 'position_in_budget', label: '本次仓位风险 ≤ 总账户 1R',           required: true,  source: 'default' },
  { id: 'mental_state_ok',    label: '当前心态自评 ≥ 3 分',                required: true,  source: 'default' },
  { id: 'macro_checked',      label: '已查看 BTC 大盘趋势与整体波动率',    required: false, source: 'default' },
  { id: 'not_revenge',        label: '非"上一笔亏损后立即开仓"的报复单',  required: false, source: 'default' },
  { id: 'in_alpha_window',    label: '处于个人 alpha 时间窗口',            required: false, source: 'default' },
  { id: 'no_external_noise',  label: '未受外部信息（社群/推文）驱动',      required: false, source: 'default' },
];

export function ruleToChecklistItem(rule: TradingRule): ChecklistDefItem {
  const category = rule.rule_category ?? (rule.required ? 'core' : 'watch');
  return {
    id: `rule_${rule.id}`,
    label: rule.rule_text,
    required: category === 'hard' || rule.required,
    source: 'rule',
    sourceRuleId: rule.id,
    sourcePatternId: rule.source_pattern_id,
  };
}

function entersChecklist(rule: TradingRule): boolean {
  const category = rule.rule_category ?? (rule.required ? 'core' : 'watch');
  if (category === 'watch' || category === 'retired') return false;
  return rule.added_to_checklist || category === 'hard' || category === 'core';
}

export function buildChecklist(rules: TradingRule[] = []): ChecklistDefItem[] {
  const now = Date.now();
  const activeRules = rules
    .filter(r =>
      r.is_active &&
      entersChecklist(r) &&
      r.rule_text !== '[延后]' &&
      (!r.snooze_until || new Date(r.snooze_until).getTime() < now),
    )
    .sort((a, b) => {
      const categoryRank: Record<string, number> = { hard: 0, core: 1, watch: 2, retired: 3 };
      const ar = categoryRank[a.rule_category ?? 'core'] ?? 1;
      const br = categoryRank[b.rule_category ?? 'core'] ?? 1;
      if (ar !== br) return ar - br;
      const aw = Number.isFinite(a.weight) ? a.weight : 50;
      const bw = Number.isFinite(b.weight) ? b.weight : 50;
      if (aw !== bw) return bw - aw;
      return (a.ui_order ?? 100) - (b.ui_order ?? 100);
    });
  return [...DEFAULT_PRE_TRADE_CHECKLIST, ...activeRules.map(ruleToChecklistItem)];
}

export function isChecklistPassed(
  checked: string[],
  items: ChecklistDefItem[] = DEFAULT_PRE_TRADE_CHECKLIST,
): boolean {
  const set = new Set(checked);
  const requiredIds = items.filter(i => i.required).map(i => i.id);
  const optionalDefaultIds = items.filter(i => !i.required && i.source !== 'rule').map(i => i.id);
  const allRequired = requiredIds.every(id => set.has(id));
  const optionalCount = optionalDefaultIds.filter(id => set.has(id)).length;
  return allRequired && optionalCount >= 2;
}
