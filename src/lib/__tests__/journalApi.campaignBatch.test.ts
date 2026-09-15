// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';

const state = vi.hoisted(() => ({
  campaigns: [] as TradeCampaign[],
  journals: [] as TradeJournal[],
  errors: {} as Record<string, { code: string; message: string }>,
  requests: [] as Array<{ table: string; range?: [number, number]; columns?: string; ids?: unknown[] }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let range: [number, number] | undefined;
      let order: { column: string; ascending: boolean } | undefined;
      let columns: string | undefined;
      let ids: unknown[] | undefined;
      const result = () => {
        state.requests.push({ table, range, ...(columns ? { columns } : {}), ...(ids ? { ids } : {}) });
        if (state.errors[table]) return { data: null, error: state.errors[table] };
        let rows = (table === 'trade_campaigns' ? state.campaigns : state.journals) as unknown as Array<Record<string, unknown>>;
        rows = rows.filter(row => filters.every(filter => filter(row)));
        if (order) {
          const { column, ascending } = order;
          rows = [...rows].sort((a, b) => {
            if (a[column] == null) return b[column] == null ? 0 : 1;
            if (b[column] == null) return -1;
            return (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1);
          });
        }
        // Model the server's default 1000-row limit even if the caller forgets pagination.
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000), error: null };
      };
      const builder = {
        select(selected?: string) { columns = selected; return builder; },
        eq(column: string, value: unknown) {
          filters.push(row => row[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          if (column === 'id') ids = values;
          filters.push(row => values.includes(row[column]));
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          order = { column, ascending: options.ascending };
          return builder;
        },
        range(from: number, to: number) {
          range = [from, to];
          return builder;
        },
        single() {
          const response = result();
          return Promise.resolve({
            data: response.data?.[0] ?? null,
            error: response.error ?? (response.data?.length ? null : { code: 'PGRST116', message: '0 rows' }),
          });
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return builder;
    },
  },
}));

import { fetchCampaignSourceRows, getCampaignFullData, getCampaignsWithLegs, getCampaignWithLegs } from '@/lib/journalApi';

const timestamp = '2026-09-01T00:00:00.000Z';

function campaign(id: string, overrides: Partial<TradeCampaign> = {}): TradeCampaign {
  return {
    id, user_id: 'user-1', campaign_code: `C-${id}`, symbol: 'BTCUSDT', direction: 'main_long',
    status: 'active', strategy_template: 'custom', title: id,
    opened_at: timestamp, closed_at: null, actual_evolution: [], importance_weight: 0,
    initial_main_size_usdt: 100, initial_leverage: 1, deleted_at: null, deviation_notes: {},
    created_at: timestamp, updated_at: timestamp,
    ...overrides,
  } as TradeCampaign;
}

function leg(id: string, campaignId: string | null, overrides: Partial<TradeJournal> = {}): TradeJournal {
  return {
    id, user_id: 'user-1', campaign_id: campaignId, trade_record_id: `record-${id}`,
    leg_role: 'main_open', leg_sequence: 1, symbol: 'BTCUSDT', direction: 'long',
    leverage: 1, source: 'live', order_kind: 'main', pre_entry_price: 100,
    pre_position_size: 100, pre_real_time: timestamp, pre_simulated_time: timestamp,
    created_at: timestamp, updated_at: timestamp,
    ...overrides,
  } as TradeJournal;
}

function event(overrides: Partial<CampaignEvent> = {}): CampaignEvent {
  return {
    id: 'event-main', timestamp, recorded_at: timestamp, event_type: 'main_opened',
    journal_id: 'event-leg', trade_record_id: 'event-record', leg_role: 'main_open',
    pending_order_id: null, price: 100, size_usdt: 100, notes: null,
    ...overrides,
  } as CampaignEvent;
}

describe('complete campaign batch source', () => {
  beforeEach(() => {
    state.campaigns = [];
    state.journals = [];
    state.errors = {};
    state.requests = [];
    localStorage.clear();
  });

  it('matches single-campaign legs, including historical synthesis, mirrors, and unclassified reviews', async () => {
    const historical = campaign('historical', { actual_evolution: [
      event({ id: 'created', event_type: 'historical_classification_created', leg_role: null }),
      event({ event_type: 'historical_leg_attached', journal_id: 'persisted', trade_record_id: 'record-persisted', leg_sequence: 1 }),
      event({ id: 'added', event_type: 'historical_leg_attached', journal_id: 'event-only', trade_record_id: 'event-only-record', leg_role: 'main_add_1', leg_sequence: 2 }),
    ] });
    const live = campaign('live', { actual_evolution: [event({
      id: 'mirror', event_type: 'mirror_tp_placed', leg_role: 'mirror_tp',
      journal_id: null, trade_record_id: null,
    })] });
    const local = campaign('local', { actual_evolution: [event()] });
    state.campaigns = [historical, live, campaign('deleted'), campaign('other-user', { user_id: 'user-2' })];
    state.journals = [
      leg('persisted', 'historical'), leg('live-leg', 'live'),
      leg('review', null, { trade_record_id: 'record-persisted', post_reviewed_at: '2026-09-02T00:00:00.000Z' }),
      leg('other-review', null, { user_id: 'user-2', trade_record_id: 'record-persisted', post_reflection: 'other user', post_reviewed_at: '2026-09-03T00:00:00.000Z' }),
    ];
    localStorage.setItem('sim_user-1_trade_campaigns', JSON.stringify([local, campaign('deleted', { deleted_at: timestamp })]));
    localStorage.setItem('sim_user-1_trade_campaign_preferences', JSON.stringify({ live: { importance_weight: 5 } }));
    localStorage.setItem('journal_local_mirror_v1', JSON.stringify({
      'user-1': { review: { post_reflection: '保留后补评价', exit_falsification_note: '本地镜像答案' } },
    }));

    const read = vi.spyOn(Storage.prototype, 'getItem');
    const batch = await getCampaignsWithLegs('user-1');
    expect(read.mock.calls.filter(([key]) => key === 'journal_local_mirror_v1')).toHaveLength(1);
    expect(read.mock.calls.filter(([key]) => key === 'sim_user-1_trade_history')).toHaveLength(1);
    read.mockRestore();
    expect(state.requests).toHaveLength(2);
    expect(batch.map(source => source.campaign.id)).toEqual(['live', 'historical', 'local']);
    expect(batch[0].campaign.importance_weight).toBe(5);
    expect(batch[0].legs.map(row => row.leg_role)).toEqual(['main_open', 'mirror_tp']);
    expect(batch[1].legs).toHaveLength(2);
    expect(batch[1].legs[0]).toMatchObject({
      id: 'persisted', campaign_id: 'historical', leg_sequence: 1,
      post_reflection: '保留后补评价', exit_falsification_note: '本地镜像答案',
    });
    for (const source of batch) {
      expect(source).toEqual(await getCampaignWithLegs(source.campaign.id));
    }
  });

  it('loads every page of both tables and hydrates a review beyond the default 1000-row limit', async () => {
    state.campaigns = Array.from({ length: 1001 }, (_, index) => campaign(`c-${String(index).padStart(4, '0')}`));
    state.journals = state.campaigns.map((row, index) => leg(`leg-${String(index).padStart(4, '0')}`, row.id));
    state.journals.push(leg('zz-last-review', null, {
      trade_record_id: 'record-leg-0000', post_reflection: '最后一页的评价', post_reviewed_at: timestamp,
    }));

    const batch = await getCampaignsWithLegs('user-1');
    expect(batch).toHaveLength(1001);
    expect(batch.reduce((count, source) => count + source.legs.length, 0)).toBe(1001);
    expect(batch.find(source => source.campaign.id === 'c-1000')?.legs[0].id).toBe('leg-1000');
    expect(batch.find(source => source.campaign.id === 'c-0000')?.legs[0].post_reflection).toBe('最后一页的评价');
    for (const table of ['trade_campaigns', 'trade_journals']) {
      expect(state.requests.filter(request => request.table === table).map(request => request.range)).toEqual([
        [0, 499], [500, 999], [1000, 1499],
      ]);
    }
  });

  it('keeps local campaigns and synthetic legs available when the remote schema is absent', async () => {
    state.errors = {
      trade_campaigns: { code: 'PGRST205', message: 'trade_campaigns schema cache missing' },
      trade_journals: { code: 'PGRST205', message: 'trade_journals schema cache missing' },
    };
    localStorage.setItem('sim_user-1_trade_campaigns', JSON.stringify([campaign('local', { actual_evolution: [event()] })]));

    const [source] = await getCampaignsWithLegs('user-1');
    expect(source.legs).toHaveLength(1);
    expect(source).toEqual(await getCampaignWithLegs('local'));
  });

  it('rejects remote read failures instead of returning a truncated successful snapshot', async () => {
    state.campaigns = [campaign('one', { actual_evolution: [event()] })];
    state.errors.trade_journals = { code: 'NETWORK', message: 'connection lost' };
    await expect(getCampaignsWithLegs('user-1')).rejects.toThrow('connection lost');
    state.errors = { trade_campaigns: { code: 'NETWORK', message: 'campaign connection lost' } };
    await expect(getCampaignsWithLegs('user-1')).rejects.toThrow('campaign connection lost');
  });

  it('uses a stable real creation time for legacy events without a recorded timestamp', async () => {
    state.campaigns = [campaign('legacy', { actual_evolution: [event({ recorded_at: null as never })] })];
    const first = await getCampaignsWithLegs('user-1');
    const second = await getCampaignsWithLegs('user-1');
    expect(second).toEqual(first);
    expect(first[0].legs[0].pre_real_time).toBe(timestamp);
    expect(await getCampaignWithLegs('legacy')).toEqual(first[0]);
  });

  it('a delta read lists id + updated_at, fetches only changed rows by id, drops deleted ones and keeps unchanged rows by reference', async () => {
    state.campaigns = [campaign('a'), campaign('b'), campaign('c')];
    state.journals = [leg('a-leg', 'a'), leg('b-leg', 'b')];
    const previous = await fetchCampaignSourceRows('user-1');
    expect(previous.campaigns).toHaveLength(3);

    // 改一场（触发器换了 updated_at）、删一场；加一条腿、删一条腿
    state.campaigns = [campaign('a', { title: 'A 改过', updated_at: '2026-09-02T00:00:00.000Z' }), campaign('c')];
    state.journals = [leg('a-leg', 'a'), leg('c-leg', 'c')];
    state.requests = [];
    const next = await fetchCampaignSourceRows('user-1', { previous });
    expect(next.campaigns.map(row => (row as TradeCampaign).id)).toEqual(['a', 'c']);
    expect((next.campaigns[0] as TradeCampaign).title).toBe('A 改过');
    expect(next.campaigns[1]).toBe(previous.campaigns[2]);
    expect(next.journals.map(row => (row as TradeJournal).id)).toEqual(['a-leg', 'c-leg']);
    expect(next.journals[0]).toBe(previous.journals[0]);
    // 目录只取两列；点名只读变了的 id
    const byTable = (table: string) => state.requests.filter(request => request.table === table);
    expect(byTable('trade_campaigns')).toEqual([
      { table: 'trade_campaigns', range: [0, 499], columns: 'id, updated_at' },
      { table: 'trade_campaigns', range: [0, 499], columns: '*', ids: ['a'] },
    ]);
    expect(byTable('trade_journals')).toEqual([
      { table: 'trade_journals', range: [0, 499], columns: 'id, updated_at' },
      { table: 'trade_journals', range: [0, 499], columns: '*', ids: ['c-leg'] },
    ]);
    // 装配结果与整表重读逐字段相同
    expect(await getCampaignsWithLegs('user-1')).toEqual(
      (await import('@/lib/journalApi')).assembleCampaignsWithLegs('user-1', next),
    );

    // 什么都没变：只有两次目录请求，两个数组都是上次的同一个
    state.requests = [];
    const same = await fetchCampaignSourceRows('user-1', { previous: next });
    expect(same.campaigns).toBe(next.campaigns);
    expect(same.journals).toBe(next.journals);
    expect(state.requests.map(request => request.columns)).toEqual(['id, updated_at', 'id, updated_at']);

    // 目录读失败照样抛出，不把半份结果当成功
    state.errors.trade_journals = { code: 'NETWORK', message: 'connection lost' };
    await expect(fetchCampaignSourceRows('user-1', { previous: next })).rejects.toThrow('connection lost');
  });

  it('computes full data from a matching preloaded source without additional requests', async () => {
    state.campaigns = [campaign('one')];
    state.journals = [leg('one-leg', 'one')];
    const [source] = await getCampaignsWithLegs('user-1');
    const local = { tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] };
    const expected = await getCampaignFullData('one', { local, heal: false });
    const original = JSON.stringify(source);
    state.requests = [];

    expect(await getCampaignFullData('one', { source, local, heal: false })).toEqual(expected);
    expect(state.requests).toEqual([]);
    expect(JSON.stringify(source)).toBe(original);
    await expect(getCampaignFullData('different', { source, local, heal: false })).rejects.toThrow('ID 不匹配');
    expect(state.requests).toEqual([]);
  });
});
