// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 快照锁定时刻的回放时间线 id（pre_timeline_id）**没有数据库列**：
 * 不进 insert（带着它插会先失败一次、剥列重试，每次快照都来一遍 schemaDrift 提示），
 * 只写本地镜像 journal_local_mirror_v1，读 journal 时经 applyLocalMirror 合回来。
 */
const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: (payload: Record<string, unknown>) => {
        insert(payload);
        return {
          select: () => ({
            single: async () => ({ data: { ...payload, id: 'j-1' }, error: null }),
          }),
        };
      },
      upsert: vi.fn(async () => ({ error: null })),
    })),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null } })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  },
}));

import { createJournalPreSnapshot, createNoTradeJournal, type CreateJournalPreInput } from '@/lib/journalApi';
import { applyLocalMirror } from '@/lib/journalLocalMirror';

const UID = 'u-1';

const preInput = (over: Partial<CreateJournalPreInput> = {}): CreateJournalPreInput => ({
  user_id: UID,
  trade_record_id: null,
  campaign_id: null,
  leg_role: null,
  leg_sequence: null,
  symbol: 'BTCUSDT',
  direction: 'long',
  leverage: 10,
  position_mode: 'isolated',
  pre_simulated_time: '2024-01-15T08:00:00.000Z',
  pre_entry_price: 100,
  order_kind: 'main',
  pre_entry_reason: '理由',
  pre_mental_state: 3,
  ...over,
} as unknown as CreateJournalPreInput);

/** 镜像合回 journal 后读到的 pre_timeline_id。 */
const mirrored = (journalId: string) =>
  (applyLocalMirror(UID, [{ id: journalId }])[0] as { pre_timeline_id?: string | null }).pre_timeline_id;

beforeEach(() => {
  localStorage.clear();
  insert.mockClear();
});

afterEach(() => {
  localStorage.clear();
});

describe('createJournalPreSnapshot · 回放时间线 id 只进本地镜像', () => {
  it('insert 的 payload 里没有 pre_timeline_id；镜像里有，读回时合上', async () => {
    const journal = await createJournalPreSnapshot(preInput({ pre_timeline_id: 'tl-open' }));
    expect(journal.id).toBe('j-1');
    expect(insert).toHaveBeenCalledTimes(1);
    expect('pre_timeline_id' in insert.mock.calls[0][0]).toBe(false);
    // 其余字段照常进库
    expect(insert.mock.calls[0][0]).toMatchObject({ user_id: UID, symbol: 'BTCUSDT', source: 'live' });
    expect(mirrored('j-1')).toBe('tl-open');
  });

  it('钟停着时快照（没有时间线）：不写镜像，也不多出字段', async () => {
    await createJournalPreSnapshot(preInput({ pre_timeline_id: null }));
    expect('pre_timeline_id' in insert.mock.calls[0][0]).toBe(false);
    expect(localStorage.getItem('journal_local_mirror_v1')).toBeNull();
    expect(mirrored('j-1')).toBeUndefined();
  });
});

describe('createNoTradeJournal · 空仓观望同样只进本地镜像', () => {
  it('insert 不带 pre_timeline_id，镜像里有', async () => {
    const journal = await createNoTradeJournal({
      user_id: UID,
      symbol: 'BTCUSDT',
      direction: 'long',
      pre_simulated_time: '2024-01-15T08:00:00.000Z',
      no_trade_would_be_entry_price: 100,
      no_trade_reason: '没有 edge',
      pre_timeline_id: 'tl-watch',
    });
    expect(journal.id).toBe('j-1');
    expect('pre_timeline_id' in insert.mock.calls[0][0]).toBe(false);
    expect(insert.mock.calls[0][0]).toMatchObject({ journal_kind: 'no_trade', no_trade_reason: '没有 edge' });
    expect(mirrored('j-1')).toBe('tl-watch');
  });

  it('没有时间线就不碰镜像', async () => {
    await createNoTradeJournal({
      user_id: UID,
      symbol: 'BTCUSDT',
      direction: 'short',
      pre_simulated_time: '2024-01-15T08:00:00.000Z',
      no_trade_would_be_entry_price: null,
    });
    expect(localStorage.getItem('journal_local_mirror_v1')).toBeNull();
  });
});
