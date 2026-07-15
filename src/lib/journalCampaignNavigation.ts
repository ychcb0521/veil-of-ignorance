import type { TradeCampaign, TradeJournal } from '@/types/journal';

function addCandidate(map: Map<string, Set<string>>, key: string | null | undefined, campaignId: string) {
  if (!key) return;
  const candidates = map.get(key) ?? new Set<string>();
  candidates.add(campaignId);
  map.set(key, candidates);
}

function uniqueCandidate(candidates: Set<string> | undefined): string | null {
  if (!candidates || candidates.size !== 1) return null;
  return candidates.values().next().value ?? null;
}

/**
 * Resolve each journal to its campaign without text matching.
 * The journal's direct campaign_id is authoritative. Legacy rows may be repaired from
 * campaign evolution events, but only when the match is unique.
 */
export function buildJournalCampaignIdIndex(
  journals: TradeJournal[],
  campaigns: TradeCampaign[],
): Record<string, string> {
  const byJournalId = new Map<string, Set<string>>();
  const byTradeRecordId = new Map<string, Set<string>>();

  for (const campaign of campaigns) {
    for (const event of campaign.actual_evolution ?? []) {
      addCandidate(byJournalId, event.journal_id, campaign.id);
      addCandidate(byTradeRecordId, event.trade_record_id, campaign.id);
    }
  }

  const result: Record<string, string> = {};
  for (const journal of journals) {
    if (journal.campaign_id) {
      result[journal.id] = journal.campaign_id;
      continue;
    }
    const eventCampaignId = uniqueCandidate(byJournalId.get(journal.id));
    const recordCampaignId = uniqueCandidate(
      journal.trade_record_id ? byTradeRecordId.get(journal.trade_record_id) : undefined,
    );
    const campaignId = eventCampaignId ?? recordCampaignId;
    if (campaignId) result[journal.id] = campaignId;
  }
  return result;
}

export function journalRecordPath(journalId: string, campaignId?: string | null): string {
  return campaignId ? `/journal/campaigns/${campaignId}` : `/journal/${journalId}`;
}

export type JournalReviewLinkMode = 'edit' | 'required';

/**
 * Build a review link from the stable journal ID. The review text is deliberately
 * not part of the identity, so later edits never break an execution-ledger link.
 */
export function journalReviewPath(journalId: string, mode: JournalReviewLinkMode): string {
  const params = new URLSearchParams({ review: mode, from: 'execution-assets' });
  return `/journal/${encodeURIComponent(journalId)}?${params.toString()}`;
}
