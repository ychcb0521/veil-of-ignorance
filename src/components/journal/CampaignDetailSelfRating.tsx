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
  return <div role="group" aria-label="战役自评" aria-busy={busy} className="ml-auto flex shrink-0 items-center gap-1 rounded border border-border/80 px-2 py-1.5">
    <span className="mr-1 text-xs text-muted-foreground">自评</span>
    {SELF_RATING_LABELS.map((label, index) => <button
      key={label} type="button" aria-label={`${index + 1} ${label}`} aria-pressed={score === index + 1}
      title={`${index + 1} ${label}（再次点击清除）`} disabled={!editable || busy}
      onClick={() => void save(index + 1)}
      className={`h-6 w-6 rounded-full border text-xs tabular-nums transition-colors disabled:opacity-50 ${score === index + 1 ? 'border-[#F0B90B] bg-[#F0B90B] text-[#1E2026]' : 'border-border text-muted-foreground hover:border-[#F0B90B]'}`}
    >{index + 1}</button>)}
    <span className="ml-1 w-[3.5em] text-xs text-muted-foreground">{busy ? '保存中' : selfRatingLabel(score) ?? '未评'}</span>
  </div>;
}
