import { useRef, useState } from 'react';
import { SELF_RATING_LABELS, importanceValue, selfRatingLabel } from '@/lib/campaignListSort';
import { updateCampaignImportance } from '@/lib/journalApi';
import { waitForCampaignListHeal } from '@/lib/campaignListCache';
import { toast } from '@/lib/notificationCenter';

export function CampaignDetailSelfRating({ campaignId, value, editable, onChange }: {
  campaignId: string;
  value: number | null | undefined;
  editable: boolean;
  onChange: (value: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const score = importanceValue({ importance_weight: value ?? 0 });
  async function save(next: number) {
    if (!editable || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await waitForCampaignListHeal();
      const saved = await updateCampaignImportance(campaignId, next === score ? 0 : next);
      onChange(saved);
      toast.success(saved ? `自评已设为 ${saved} ${selfRatingLabel(saved)}` : '已清除自评');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const currentLabel = selfRatingLabel(score);
  return <div
    role="radiogroup"
    aria-label="战役自评"
    aria-busy={busy}
    title={currentLabel ? `当前自评：${score} ${currentLabel}` : '尚未自评'}
    className="ml-auto flex shrink-0 items-center gap-0.5 text-muted-foreground/70"
  >
    <span className="mr-1 text-[10px] tracking-wide">自评</span>
    {SELF_RATING_LABELS.map((label, index) => <button
      key={label} type="button" role="radio" aria-label={`${index + 1} ${label}`} aria-checked={score === index + 1}
      title={`${index + 1} ${label}（再次点击清除）`} disabled={!editable || busy}
      onClick={() => void save(index + 1)}
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] leading-none tabular-nums transition-colors disabled:cursor-default ${score === index + 1
        ? 'border-[#D9A600]/70 bg-[#F0B90B]/80 font-medium text-[#3B2E00] shadow-[0_0_0_1px_rgba(240,185,11,0.08)]'
        : 'border-border/70 text-muted-foreground/55 hover:border-[#D9A600]/60 hover:bg-[#F0B90B]/[0.08] hover:text-muted-foreground'}`}
    >{index + 1}</button>)}
    {busy && <span className="ml-1 text-[9px] text-muted-foreground/60">保存中</span>}
  </div>;
}
