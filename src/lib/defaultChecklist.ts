/**
 * 默认开仓前 checklist 配置（4 必填 + 4 可选）
 * 通过条件：4 必填全部勾选 且 4 可选至少勾选 2 项
 */

export interface ChecklistDefItem {
  id: string;
  label: string;
  required: boolean;
}

export const DEFAULT_PRE_TRADE_CHECKLIST: ChecklistDefItem[] = [
  { id: 'stop_loss_set',      label: '已设置止损位且本次不打算移动',       required: true  },
  { id: 'take_profit_set',    label: '已设置止盈策略（非镜像 1:1）',        required: true  },
  { id: 'position_in_budget', label: '本次仓位风险 ≤ 总账户 1R',           required: true  },
  { id: 'mental_state_ok',    label: '当前心态自评 ≥ 3 分',                required: true  },
  { id: 'macro_checked',      label: '已查看 BTC 大盘趋势与整体波动率',    required: false },
  { id: 'not_revenge',        label: '非"上一笔亏损后立即开仓"的报复单',  required: false },
  { id: 'in_alpha_window',    label: '处于个人 alpha 时间窗口',            required: false },
  { id: 'no_external_noise',  label: '未受外部信息（社群/推文）驱动',      required: false },
];

export function isChecklistPassed(checked: string[]): boolean {
  const set = new Set(checked);
  const requiredIds = DEFAULT_PRE_TRADE_CHECKLIST.filter(i => i.required).map(i => i.id);
  const optionalIds = DEFAULT_PRE_TRADE_CHECKLIST.filter(i => !i.required).map(i => i.id);
  const allRequired = requiredIds.every(id => set.has(id));
  const optionalCount = optionalIds.filter(id => set.has(id)).length;
  return allRequired && optionalCount >= 2;
}
