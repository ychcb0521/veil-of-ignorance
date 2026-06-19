import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockFollow = {
  id: string;
  follower_id: string;
  followee_id: string;
  created_at: string;
};

const mockState = vi.hoisted(() => ({
  currentUserId: 'user-a',
  missingAccountFollows: false,
  remoteFollows: [] as MockFollow[],
}));

const missingAccountFollowsError = {
  code: 'PGRST205',
  message: "Could not find the table 'public.account_follows' in the schema cache",
};

vi.mock('@/integrations/supabase/client', () => {
  function from(table: string) {
    let operation: 'select' | 'upsert' | 'insert' | 'delete' = 'select';
    let upsertPayload: Partial<MockFollow> | null = null;
    let filters: Record<string, unknown> = {};

    const applyFilters = (rows: MockFollow[]) => rows.filter(row => (
      Object.entries(filters).every(([key, value]) => row[key as keyof MockFollow] === value)
    ));

    const resolveResult = () => {
      if (table !== 'account_follows') return { data: null, error: null };
      if (mockState.missingAccountFollows) return { data: null, error: missingAccountFollowsError };

      if (operation === 'upsert') {
        const followerId = String(upsertPayload?.follower_id ?? '');
        const followeeId = String(upsertPayload?.followee_id ?? '');
        const existing = mockState.remoteFollows.find(
          row => row.follower_id === followerId && row.followee_id === followeeId,
        );
        const row: MockFollow = existing ?? {
          id: `remote-follow-${followerId}-${followeeId}`,
          follower_id: followerId,
          followee_id: followeeId,
          created_at: '2026-06-17T10:00:00.000Z',
        };
        if (!existing) mockState.remoteFollows.unshift(row);
        return { data: row, error: null };
      }

      if (operation === 'insert') {
        const followerId = String(upsertPayload?.follower_id ?? '');
        const followeeId = String(upsertPayload?.followee_id ?? '');
        const existing = mockState.remoteFollows.find(
          row => row.follower_id === followerId && row.followee_id === followeeId,
        );
        // 已存在则模拟唯一约束冲突（与真实 Postgres 一致），驱动 followAccount 的幂等回查分支。
        if (existing) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "account_follows_follower_id_followee_id_key"' } };
        }
        const row: MockFollow = {
          id: `remote-follow-${followerId}-${followeeId}`,
          follower_id: followerId,
          followee_id: followeeId,
          created_at: '2026-06-17T10:00:00.000Z',
        };
        mockState.remoteFollows.unshift(row);
        return { data: row, error: null };
      }

      if (operation === 'delete') {
        mockState.remoteFollows = mockState.remoteFollows.filter(
          row => !Object.entries(filters).every(([key, value]) => row[key as keyof MockFollow] === value),
        );
        return { data: null, error: null };
      }

      return { data: applyFilters(mockState.remoteFollows), error: null };
    };

    const builder = {
      select() {
        operation = operation === 'upsert' || operation === 'insert' ? operation : 'select';
        return builder;
      },
      upsert(payload: Partial<MockFollow>) {
        operation = 'upsert';
        upsertPayload = payload;
        return builder;
      },
      insert(payload: Partial<MockFollow>) {
        operation = 'insert';
        upsertPayload = payload;
        return builder;
      },
      delete() {
        operation = 'delete';
        return builder;
      },
      eq(column: string, value: unknown) {
        filters = { ...filters, [column]: value };
        return builder;
      },
      order() {
        return builder;
      },
      single() {
        return Promise.resolve(resolveResult());
      },
      maybeSingle() {
        const result = resolveResult();
        if (result.error) return Promise.resolve(result);
        const rows = Array.isArray(result.data) ? result.data : [result.data].filter(Boolean);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
        return Promise.resolve(resolveResult()).then(resolve);
      },
    };

    return builder;
  }

  return {
    supabase: {
      from,
      auth: {
        getUser: () => Promise.resolve({
          data: { user: { id: mockState.currentUserId } },
          error: null,
        }),
      },
    },
  };
});

import { followAccount, hasMutualFollow, listMyFollows, unfollowAccount } from '../journalApi';

describe('account follow schema fallback', () => {
  beforeEach(() => {
    mockState.currentUserId = 'user-a';
    mockState.missingAccountFollows = false;
    mockState.remoteFollows = [];
    localStorage.clear();
  });

  it('stores a follow locally when account_follows is missing from the schema cache', async () => {
    mockState.missingAccountFollows = true;

    const follow = await followAccount('user-b');
    expect(follow).toMatchObject({
      follower_id: 'user-a',
      followee_id: 'user-b',
    });

    await followAccount('user-b');
    const follows = await listMyFollows();

    expect(follows).toHaveLength(1);
    expect(follows[0]).toMatchObject({
      follower_id: 'user-a',
      followee_id: 'user-b',
    });
  });

  it('checks mutual follow against the local mirror when the social table is unavailable', async () => {
    mockState.missingAccountFollows = true;

    await followAccount('user-b');
    mockState.currentUserId = 'user-b';
    await followAccount('user-a');

    await expect(hasMutualFollow('user-a', 'user-b')).resolves.toBe(true);
    await expect(hasMutualFollow('user-a', 'user-c')).resolves.toBe(false);
  });

  it('removes local follow state when unfollowing while the social table is unavailable', async () => {
    mockState.missingAccountFollows = true;

    await followAccount('user-b');
    await unfollowAccount('user-b');

    await expect(listMyFollows()).resolves.toEqual([]);
  });

  it('keeps the local mirror in sync after a successful remote follow', async () => {
    await followAccount('user-b');
    mockState.missingAccountFollows = true;

    await expect(listMyFollows()).resolves.toMatchObject([
      { follower_id: 'user-a', followee_id: 'user-b' },
    ]);
  });

  it('treats re-following an already-followed account as idempotent (no upsert UPDATE)', async () => {
    const first = await followAccount('user-b');
    expect(first).toMatchObject({ follower_id: 'user-a', followee_id: 'user-b' });

    // 第二次关注：远端 INSERT 命中唯一约束 23505。旧实现用 upsert→ON CONFLICT DO UPDATE，
    // 会撞上 account_follows 缺失的 UPDATE/USING 策略而报错；新实现回查现有边、幂等返回。
    const second = await followAccount('user-b');
    expect(second).toMatchObject({ follower_id: 'user-a', followee_id: 'user-b' });
    expect(mockState.remoteFollows).toHaveLength(1);
  });
});
