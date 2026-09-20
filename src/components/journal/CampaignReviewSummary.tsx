import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImeSafeTextarea } from '@/components/ui/ime-safe-text-field';

const REVIEW_PROMPTS = [
  '加仓后对冲触发后硬拆对冲',
  '止损线太浅',
  '否认盘面上给出的负向信息强行入场和持有甚至加仓',
  '对冲触发后不管不顾导致爆仓',
];

interface Props {
  value: string;
  canEdit: boolean;
  disabled?: boolean;
  onSave: (summary: string) => Promise<void>;
}

/** 父级以 campaign.id 为 key：换战役时草稿与异步保存状态都隔离。 */
export function CampaignReviewSummary({ value, canEdit, disabled = false, onSave }: Props) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const savedRef = useRef(value);
  const textareaId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const previousSaved = savedRef.current;
    setDraft(current => current === previousSaved ? value : current);
    savedRef.current = value;
    setSaved(value);
  }, [value]);

  const save = async () => {
    if (saving || disabled || !canEdit) return;
    const submitted = draft;
    setSaving(true);
    setError(null);
    try {
      await onSave(submitted);
      if (!mounted.current) return;
      savedRef.current = submitted;
      setSaved(submitted);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <section data-testid="campaign-review-summary" className="mt-4 rounded border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={textareaId} className="text-[13px] font-medium">复盘总结</label>
        {canEdit && <Button type="button" variant="outline" className="h-8 text-[11px]" disabled={saving || disabled || draft === saved} onClick={save}>
          {saving ? '保存中…' : '保存总结'}
        </Button>}
      </div>
      <p className="text-[11px] text-muted-foreground">记录这场战役的关键判断、做错的地方与下次如何改进。保存后与本战役绑定。</p>
      {canEdit ? <>
        <ImeSafeTextarea id={textareaId} value={draft} onValueChange={setDraft} className="min-h-[112px] text-[12px] leading-relaxed" placeholder="写下你自己的复盘结论……" />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">可选提示（点击填入，不代表本场事实）：</span>
          {REVIEW_PROMPTS.map(prompt => <button key={prompt} type="button" onClick={() => setDraft(current => current ? `${current}\n${prompt}` : prompt)} className="rounded border border-border/60 px-2 py-1 text-left text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">{prompt}</button>)}
        </div>
        {error ? <p role="alert" className="text-[11px] text-[#F6465D]">保存失败：{error}。内容仍保留，可重试。</p>
          : <p role="status" className="text-[10px] text-muted-foreground">{saving ? '正在保存到本战役…' : draft !== saved ? '有未保存的修改' : saved ? '已保存到本战役' : '尚未填写总结'}</p>}
      </> : <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/85">{value || '尚未填写总结'}</p>}
    </section>
  );
}
