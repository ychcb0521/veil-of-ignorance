import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImeSafeTextarea } from '@/components/ui/ime-safe-text-field';
import type { CampaignReviewRule } from '@/lib/campaignReviewSummary';

const REVIEW_PROMPTS = [
  '加仓后对冲触发后硬拆对冲',
  '止损线太浅',
  '否认盘面上给出的负向信息强行入场和持有甚至加仓',
  '对冲触发后不管不顾导致爆仓',
];

const EMPTY_RULE: CampaignReviewRule = { violation: '', fix: '' };

/** 与规则页同一种小标签：18px 高、3px 圆角。 */
const CHIP = 'inline-flex h-[18px] shrink-0 items-center rounded-[3px] px-1.5 text-[10px] font-medium leading-none';

type Draft = { summary: string; violation: string; fix: string };

interface Props {
  value: string;
  /** 【用户要求】「违规 / 修正」两行；缺省为空。 */
  rule?: CampaignReviewRule;
  canEdit: boolean;
  disabled?: boolean;
  onSave: (summary: string, rule: CampaignReviewRule) => Promise<void>;
}

const sameDraft = (a: Draft, b: Draft) => a.summary === b.summary && a.violation === b.violation && a.fix === b.fix;

/** 父级以 campaign.id 为 key：换战役时草稿与异步保存状态都隔离。 */
export function CampaignReviewSummary({ value, rule = EMPTY_RULE, canEdit, disabled = false, onSave }: Props) {
  const incoming: Draft = { summary: value, violation: rule.violation, fix: rule.fix };
  const [draft, setDraft] = useState<Draft>(incoming);
  const [saved, setSaved] = useState<Draft>(incoming);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const savedRef = useRef<Draft>(incoming);
  const textareaId = useId();
  const violationId = useId();
  const fixId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // 外面的值变了（别处保存、后台读回）：没改过的格子跟着换，正在改的格子保留草稿
  useEffect(() => {
    const previous = savedRef.current;
    const next: Draft = { summary: value, violation: rule.violation, fix: rule.fix };
    setDraft(current => ({
      summary: current.summary === previous.summary ? next.summary : current.summary,
      violation: current.violation === previous.violation ? next.violation : current.violation,
      fix: current.fix === previous.fix ? next.fix : current.fix,
    }));
    savedRef.current = next;
    setSaved(next);
  }, [value, rule.violation, rule.fix]);

  const dirty = !sameDraft(draft, saved);

  const save = async () => {
    if (saving || disabled || !canEdit) return;
    const submitted = draft;
    setSaving(true);
    setError(null);
    try {
      await onSave(submitted.summary, { violation: submitted.violation, fix: submitted.fix });
      if (!mounted.current) return;
      savedRef.current = submitted;
      setSaved(submitted);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const setField = (field: keyof Draft) => (next: string) => setDraft(current => ({ ...current, [field]: next }));

  return (
    <section data-testid="campaign-review-summary" className="mt-4 rounded border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={textareaId} className="text-[13px] font-medium">复盘总结</label>
        {canEdit && <Button type="button" variant="outline" className="h-8 text-[11px]" disabled={saving || disabled || !dirty} onClick={save}>
          {saving ? '保存中…' : '保存总结'}
        </Button>}
      </div>
      <p className="text-[11px] text-muted-foreground">记录这场战役的关键判断、做错的地方与下次如何改进。保存后与本战役绑定。</p>
      {canEdit ? <>
        <ImeSafeTextarea id={textareaId} value={draft.summary} onValueChange={setField('summary')} className="min-h-[112px] text-[12px] leading-relaxed" placeholder="写下你自己的复盘结论……" />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">可选提示（点击填入，不代表本场事实）：</span>
          {REVIEW_PROMPTS.map(prompt => <button key={prompt} type="button" onClick={() => setDraft(current => ({ ...current, summary: current.summary ? `${current.summary}\n${prompt}` : prompt }))} className="rounded border border-border/60 px-2 py-1 text-left text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">{prompt}</button>)}
        </div>

        {/* 【用户要求】违规 / 修正两行：保存后自动纳入「规则」（修正为空不生成规则） */}
        <div data-testid="campaign-review-rule" className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2 border-t border-border/60 pt-3">
          <label htmlFor={violationId} className={`${CHIP} mt-[7px] bg-[#F6465D]/10 text-[#CF304A] dark:text-[#F6465D]`}>违规</label>
          <ImeSafeTextarea
            id={violationId}
            aria-label="违规"
            value={draft.violation}
            onValueChange={setField('violation')}
            rows={1}
            className="min-h-[32px] resize-y py-1.5 text-[12px] leading-5 text-muted-foreground"
            placeholder="这场战役做错了什么，例如：加仓之后对冲触发，硬拆了对冲"
          />
          <label htmlFor={fixId} className={`${CHIP} mt-[7px] bg-[#0ECB81]/12 text-[#07875A] dark:text-[#0ECB81]`}>修正</label>
          <ImeSafeTextarea
            id={fixId}
            aria-label="修正"
            value={draft.fix}
            onValueChange={setField('fix')}
            rows={1}
            className="min-h-[32px] resize-y py-1.5 text-[12px] font-medium leading-5"
            placeholder="下次怎么做——保存后自动纳入「规则」"
          />
        </div>

        {error ? <p role="alert" className="text-[11px] text-[#F6465D]">保存失败：{error}。内容仍保留，可重试。</p>
          : <p role="status" className="text-[10px] text-muted-foreground">{saving ? '正在保存到本战役…' : dirty ? '有未保存的修改' : saved.fix.trim() ? '已保存到本战役，「修正」已纳入规则' : saved.summary || saved.violation ? '已保存到本战役' : '尚未填写总结'}</p>}
      </> : <>
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/85">{value || '尚未填写总结'}</p>
        {(rule.violation || rule.fix) && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5 border-t border-border/60 pt-3">
            {rule.violation && <>
              <dt className={`${CHIP} mt-[2px] bg-[#F6465D]/10 text-[#CF304A] dark:text-[#F6465D]`}>违规</dt>
              <dd className="text-[12px] leading-[22px] text-muted-foreground">{rule.violation}</dd>
            </>}
            {rule.fix && <>
              <dt className={`${CHIP} mt-[2px] bg-[#0ECB81]/12 text-[#07875A] dark:text-[#0ECB81]`}>修正</dt>
              <dd className="text-[12px] font-medium leading-[22px] text-foreground">{rule.fix}</dd>
            </>}
          </dl>
        )}
      </>}
    </section>
  );
}
