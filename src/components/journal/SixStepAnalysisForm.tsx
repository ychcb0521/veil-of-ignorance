/**
 * 六步深度分析表单 — 在 PostTradeReviewSheet 与 JournalPlaybackPage 共用
 */
import { type ReactNode, useMemo, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

export interface SixStepValue {
  post_error_scenario: string;
  post_original_hypothesis: string;
  post_reality_feedback: string;
  post_error_type_summary: string;
  post_real_problem: string;
  post_new_rule_draft: string;
}

export const EMPTY_SIX_STEP: SixStepValue = {
  post_error_scenario: '',
  post_original_hypothesis: '',
  post_reality_feedback: '',
  post_error_type_summary: '',
  post_real_problem: '',
  post_new_rule_draft: '',
};

interface StepDef {
  key: keyof SixStepValue;
  num: number;
  title: string;
  color: string;
  hint: string;
  placeholder: string;
}

const STEPS: StepDef[] = [
  {
    key: 'post_error_scenario', num: 1, title: '错误场景', color: '#848E9C',
    hint: '当时市场在做什么？你看到了什么信号？你的身体/心态在什么状态？',
    placeholder: '例如：BTC 在 4H 趋势线下方反弹至前高，成交量背离；当时凌晨 2 点，已连续盯盘 4 小时；前一笔刚扫损',
  },
  {
    key: 'post_original_hypothesis', num: 2, title: '原始假设', color: '#F0B90B',
    hint: '你当时相信什么会发生？这笔交易的底层逻辑是什么？',
    placeholder: '例如：我假设趋势线已经失效，前高会被突破，止损在前低下方 0.5%',
  },
  {
    key: 'post_reality_feedback', num: 3, title: '现实反馈', color: '#B080FF',
    hint: '市场实际怎么回应你？哪里和你的假设不一致？',
    placeholder: '例如：价格在前高位置二次假突破，量能没放大，然后快速跌破止损；事后看是前高的诱多结构',
  },
  {
    key: 'post_error_type_summary', num: 4, title: '错误类型', color: '#F6465D',
    hint: '这次错误在你的 6 大类里属于哪类？一句话归纳。也请在上面的标签选择器中打对应 tag。',
    placeholder: '例如：入场理由错——把假突破当成有效突破，忽略了量价背离',
  },
  {
    key: 'post_real_problem', num: 5, title: '真正问题', color: '#0ECB81',
    hint: "不是'我冲动了'，而是系统性的——你的判断/规则/状态哪里有结构性漏洞？",
    placeholder: '例如：我的策略对"假突破"没有过滤规则，只看价格不看量；同时心态评分 ≤2 时仍交易',
  },
  {
    key: 'post_new_rule_draft', num: 6, title: '新规则', color: '#F0B90B',
    hint: "写一条具体、可被未来的你勾选/不勾选的规则。然后点'写入 checklist'。",
    placeholder: '例如：突破入场必须满足 4H 成交量 ≥ 前 20 根均值的 1.5 倍',
  },
];

interface Props {
  value: SixStepValue;
  onChange: (next: SixStepValue) => void;
  onSaveRule?: (ruleText: string, required: boolean, sourcePatternId: string | null) => Promise<void>;
  ruleSaved?: { at: string } | null;
  patternChips?: { id: string; name: string }[];
  readonly?: boolean;
  step4Hint?: ReactNode;
}

export function SixStepAnalysisForm({
  value, onChange, onSaveRule, ruleSaved, patternChips, readonly, step4Hint,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [required, setRequired] = useState(true);
  const [justSaved, setJustSaved] = useState<{ at: string } | null>(null);
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);

  const completed = useMemo(
    () => STEPS.filter(s => (value[s.key] ?? '').trim().length > 0).length,
    [value],
  );

  const handleField = (k: keyof SixStepValue, v: string) =>
    onChange({ ...value, [k]: v });

  const step6Saved = ruleSaved ?? justSaved;
  const step6Text = value.post_new_rule_draft.trim();
  const multiTag = (patternChips?.length ?? 0) > 1;
  const needsPick = multiTag && selectedPatternId === null;
  const canSaveRule = !saving && step6Text.length > 0 && !step6Saved && !needsPick;

  const handleSaveRule = async () => {
    if (!onSaveRule || !canSaveRule) return;
    let sourceId: string | null;
    if (!patternChips || patternChips.length === 0) sourceId = null;
    else if (patternChips.length === 1) sourceId = patternChips[0].id;
    else sourceId = selectedPatternId === '__none__' ? null : selectedPatternId;
    setSaving(true);
    try {
      await onSaveRule(step6Text, required, sourceId);
      setJustSaved({ at: new Date().toISOString() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {STEPS.map(s => {
        const v = value[s.key] ?? '';
        const len = v.trim().length;
        const isStep4 = s.num === 4;
        const isStep6 = s.num === 6;
        return (
          <div
            key={s.key}
            className="relative bg-card/75 border border-border/70 rounded-xl p-3 overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.04)]"
          >
            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: s.color }} />
            <div className="flex items-center gap-2 mb-1 pl-2">
              <span className="w-5 h-5 rounded-full bg-background/90 border border-border/60 text-[10px] font-mono flex items-center justify-center">
                {s.num}
              </span>
              <span className="text-[12px] font-medium text-foreground">{s.title}</span>
              {len > 0 && <Check className="w-3 h-3 text-[#0ECB81]" />}
              {isStep4 && step4Hint && (
                <span className="ml-auto text-[10px] text-muted-foreground italic">{step4Hint}</span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground italic mb-1.5 pl-2">{s.hint}</div>
            <Textarea
              rows={3}
              value={v}
              disabled={readonly}
              onChange={e => handleField(s.key, e.target.value)}
              placeholder={s.placeholder}
              className="bg-background/85 border-border/60 text-[12px] rounded-lg"
            />
            <div className="flex items-center justify-between mt-1">
              <span />
              <span className="text-[10px] text-muted-foreground font-mono">
                {len} 字
              </span>
            </div>

            {isStep4 && len > 0 && patternChips && (
              <div className="mt-2 pl-2">
                {patternChips.length === 0 ? (
                  <div className="text-[10px] text-[#F6465D]">
                    暂无关联模式
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {patternChips.map(c => (
                      <span key={c.id} className="bg-background/90 border border-border/60 text-[10px] rounded-full px-2 py-0.5">
                        {c.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isStep6 && !readonly && onSaveRule && (
              <div className="mt-2 pl-2 space-y-2">
                {multiTag && !step6Saved && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground">
                      该笔关联多个错误模式，请选择此规则来自哪个（用于规则有效性追踪）：
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedPatternId('__none__')}
                        className={`text-[10px] rounded-full px-2 py-0.5 border transition-colors ${selectedPatternId === '__none__' ? 'bg-[#F0B90B] text-black border-[#F0B90B]' : 'bg-background/90 border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/40'}`}
                      >
                        通用 / 不绑定
                      </button>
                      {patternChips!.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedPatternId(c.id)}
                          className={`text-[10px] rounded-full px-2 py-0.5 border transition-colors ${selectedPatternId === c.id ? 'bg-[#F0B90B] text-black border-[#F0B90B]' : 'bg-background/90 border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/40'}`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <Checkbox
                      checked={required}
                      disabled={!!step6Saved}
                      onCheckedChange={v => setRequired(!!v)}
                    />
                    <span>设为必填项</span>
                  </label>
                  {step6Saved ? (
                    <span className="text-[10px] text-[#0ECB81] font-mono">
                      ✓ 已写入 {new Date(step6Saved.at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit' })}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!canSaveRule}
                      onClick={handleSaveRule}
                      className="h-7 text-[10px] rounded-lg bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black disabled:opacity-40"
                    >
                      {saving ? '写入中…' : needsPick ? '请先选择来源' : '写入 checklist'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="bg-card/75 border border-border/70 rounded-xl p-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
            <div
              className="h-full bg-[#0ECB81] transition-all"
              style={{ width: `${(completed / 6) * 100}%` }}
            />
          </div>
          <span className={`text-[11px] font-mono ${completed === 6 ? 'text-[#0ECB81]' : 'text-muted-foreground'}`}>
            {completed === 6 ? '深度分析完成' : `完成 ${completed}/6`}
          </span>
        </div>
      </div>
    </div>
  );
}

export function countCompletedSteps(v: SixStepValue): number {
  return STEPS.filter(s => (v[s.key] ?? '').trim().length > 0).length;
}

export function pickSixStepValue(j: {
  post_error_scenario?: string | null;
  post_original_hypothesis?: string | null;
  post_reality_feedback?: string | null;
  post_error_type_summary?: string | null;
  post_real_problem?: string | null;
  post_new_rule_draft?: string | null;
}): SixStepValue {
  return {
    post_error_scenario: j.post_error_scenario ?? '',
    post_original_hypothesis: j.post_original_hypothesis ?? '',
    post_reality_feedback: j.post_reality_feedback ?? '',
    post_error_type_summary: j.post_error_type_summary ?? '',
    post_real_problem: j.post_real_problem ?? '',
    post_new_rule_draft: j.post_new_rule_draft ?? '',
  };
}
