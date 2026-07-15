import { describe, expect, it } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import {
  buildJournalCampaignIdIndex,
  journalRecordPath,
  journalReviewPath,
} from '../journalCampaignNavigation';

describe('journal campaign navigation', () => {
  it('prefers the stable campaign_id and repairs legacy rows only from unique IDs', () => {
    const journals = [
      { id: 'direct', campaign_id: 'campaign-direct', trade_record_id: 'record-direct' },
      { id: 'legacy-journal', campaign_id: null, trade_record_id: 'record-legacy' },
      { id: 'legacy-record', campaign_id: null, trade_record_id: 'record-only' },
      { id: 'ambiguous', campaign_id: null, trade_record_id: 'shared-record' },
    ] as TradeJournal[];
    const campaigns = [
      campaign('campaign-a', [
        event('legacy-journal', 'record-legacy'),
        event(null, 'record-only'),
        event(null, 'shared-record'),
      ]),
      campaign('campaign-b', [event(null, 'shared-record')]),
    ];

    expect(buildJournalCampaignIdIndex(journals, campaigns)).toEqual({
      direct: 'campaign-direct',
      'legacy-journal': 'campaign-a',
      'legacy-record': 'campaign-a',
    });
    expect(journalRecordPath('direct', 'campaign-direct')).toBe('/journal/campaigns/campaign-direct');
    expect(journalRecordPath('ambiguous', null)).toBe('/journal/ambiguous');
  });

  it('builds stable edit and required-review links from the journal ID', () => {
    expect(journalReviewPath('journal/with space', 'edit')).toBe(
      '/journal/journal%2Fwith%20space?review=edit&from=execution-assets',
    );
    expect(journalReviewPath('journal-2', 'required')).toBe(
      '/journal/journal-2?review=required&from=execution-assets',
    );
  });
});

function campaign(id: string, actualEvolution: TradeCampaign['actual_evolution']): TradeCampaign {
  return { id, actual_evolution: actualEvolution } as TradeCampaign;
}

function event(
  journalId: string | null,
  tradeRecordId: string | null,
): TradeCampaign['actual_evolution'][number] {
  return {
    id: `${journalId ?? 'none'}-${tradeRecordId ?? 'none'}`,
    timestamp: '2026-07-12T00:00:00.000Z',
    event_type: 'note',
    leg_role: null,
    journal_id: journalId,
    trade_record_id: tradeRecordId,
    pending_order_id: null,
    price: null,
    size_usdt: null,
    notes: null,
    recorded_at: '2026-07-12T00:00:00.000Z',
  };
}
