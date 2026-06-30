import type { ManualLegDeviationCost } from '@/lib/campaignSimulationEngine';
import type { CampaignDeviationNote } from '@/types/journal';

export interface CampaignDeviationRuleDraft {
  rowKey: string;
  ruleText: string;
  violation: string;
  fix: string;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function buildViolationText(note: CampaignDeviationNote, cost: ManualLegDeviationCost | undefined): string {
  const category = note.category == null ? cleanText(cost?.leg_role) : cleanText(note.category);
  const reason = cleanText(note.reason);
  if (category && reason) return `${category}：${reason}`;
  return category || reason;
}

function buildRuleText(violation: string, fix: string): string {
  if (!violation) return `【战役偏离】修正后的规则：${fix}`;
  return `【战役偏离】违规操作：${violation}。修正后的规则：${fix}`;
}

export function normalizeDeviationRuleText(value: string): string {
  return cleanText(value);
}

export function normalizeDeviationRuleSourceKey(value: string | null | undefined): string {
  return cleanText(value).replace(/\s*[:：]\s*/g, '：');
}

export function normalizeDeviationRuleLooseKey(value: string | null | undefined): string {
  return normalizeDeviationRuleSourceKey(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[，,]+/g, '，')
    .replace(/[。．.]+/g, '。')
    .replace(/[；;]+/g, '；')
    .replace(/[！!]+/g, '！')
    .replace(/[？?]+/g, '？')
    .replace(/\s+/g, '');
}

export function campaignDeviationRuleSourceKeys(value: string): string[] {
  const fullText = normalizeDeviationRuleSourceKey(value);
  if (!fullText) return [];

  const keys = [fullText];
  const fixMatch = /修正后的规则：(.+)$/u.exec(fullText);
  const fixText = normalizeDeviationRuleSourceKey(fixMatch?.[1]);
  if (fixText) keys.push(fixText);

  return Array.from(new Set(keys));
}

export function buildCampaignDeviationRuleTextFromNote(
  note: CampaignDeviationNote,
  cost?: ManualLegDeviationCost,
): string | null {
  const fix = cleanText(note.fix);
  if (!fix) return null;
  return normalizeDeviationRuleText(buildRuleText(buildViolationText(note, cost), fix));
}

export function buildCampaignDeviationRuleDrafts(
  notes: Record<string, CampaignDeviationNote>,
  costs: ManualLegDeviationCost[],
): CampaignDeviationRuleDraft[] {
  const seenRuleTexts = new Set<string>();
  const drafts: CampaignDeviationRuleDraft[] = [];

  for (const cost of costs) {
    const rowKey = cost.legId;
    const note = notes[rowKey];
    if (!note) continue;

    const fix = cleanText(note.fix);
    if (!fix) continue;

    const violation = buildViolationText(note, cost);
    const ruleText = buildCampaignDeviationRuleTextFromNote(note, cost);
    if (!ruleText) continue;
    const normalized = normalizeDeviationRuleText(ruleText);
    if (seenRuleTexts.has(normalized)) continue;
    seenRuleTexts.add(normalized);

    drafts.push({
      rowKey,
      ruleText: normalized,
      violation,
      fix,
    });
  }

  return drafts;
}
