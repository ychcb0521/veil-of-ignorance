/**
 * 闭环回归：平仓评价提交 → 远程库缺列被剥离 → 本地镜像兜底 → 错题集「汇总」能看到所填字段。
 *
 * 复现用户报告：平仓评价提交后右上角弹「远程数据库缺列」，且错题集汇总对应字段 0/N。
 * 根因两层：
 *   ① 远程 trade_journals 缺 post_emo_* 等列（用户没跑最新迁移）——schema fallback 把它们剥掉；
 *   ② finalizeJournalReview 写本地镜像时 userId 取自「网络」getUser()，抖动返回 null 时
 *      mirrorDroppedColumns 因 if(!userId) return 被静默跳过 → 汇总 0/N。
 *
 * 修复：userId 改取「刚 update 成功那行自带的 user_id」（核心列，.select() 一定带回、不走网络，
 * 与错题集 applyLocalMirror 用的 useAuth().user.id 同源）。本测试断言：即便 auth.getUser()
 * 返回 null，平仓评价仍写入本地镜像，并在 summarizeField 里计为「已填」——闭环成立。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

// 「远程库」已建的列：基础平仓字段 + 核心列；故意缺 post_emo_* / post_decision_quality 等扩展列。
let dbColumns: Set<string>;
// auth.getUser() 返回的 user（设为 null 模拟网络抖动——修复后不应再依赖它）。
let getUserResult: { id: string } | null;
// auth.getSession() 返回的 session.user（本地兜底；行自带 user_id 时根本不会用到）。
let sessionUser: { id: string } | null;

vi.mock('@/integrations/supabase/client', () => {
  function from() {
    let payload: Record<string, unknown> = {};
    let rowId = 'journal-1';
    const builder: Record<string, unknown> = {
      update(p: Record<string, unknown>) { payload = { ...p }; return builder; },
      insert(p: Record<string, unknown>) { payload = { ...p }; return builder; },
      eq(col: string, val: unknown) { if (col === 'id') rowId = String(val); return builder; },
      is() { return builder; },
      select() { return builder; },
      single() {
        const missing = Object.keys(payload).find(k => !dbColumns.has(k));
        if (missing) {
          return Promise.resolve({
            data: null,
            error: {
              code: 'PGRST204',
              message: `Could not find the '${missing}' column of 'trade_journals' in the schema cache`,
            },
          });
        }
        // .select() 返回整行：id 与 user_id 是核心列，始终带回（与 payload 无关）。
        return Promise.resolve({ data: { id: rowId, user_id: OWNER, ...payload }, error: null });
      },
    };
    return builder;
  }
  return {
    supabase: {
      from,
      auth: {
        getUser: () => Promise.resolve({ data: { user: getUserResult }, error: null }),
        getSession: () => Promise.resolve({
          data: { session: sessionUser ? { user: sessionUser } : null },
          error: null,
        }),
      },
    },
  };
});

import { finalizeJournalReview, type FinalizeJournalInput } from '../journalApi';
import { applyLocalMirror } from '../journalLocalMirror';
import { summarizeField, POST_FIELD_SPECS } from '../journalSummary';
import type { TradeJournal } from '@/types/journal';

const OWNER = 'user-7';

const FINALIZE_INPUT: FinalizeJournalInput = {
  post_outcome: 'loss',
  post_realized_pnl: -42,
  post_r_multiple: -1.2,
  post_reflection: '',
  post_correct_action: '',
  // 以下扩展字段远程库尚未建列，会被 schema fallback 剥离 → 必须靠本地镜像兜底。
  post_emo_disturbance: '价格一回撤我就慌',
  post_emo_first_reaction: '想立刻平掉',
  post_emo_wanted: '想快点解脱',
  post_emo_feared: '怕回吐利润',
  post_emo_excuse: '告诉自己见好就收',
  post_emo_next_time_plan: '等结构破坏信号再动',
  post_decision_quality: 'bad',
};

/** 错题集汇总加载时，server 拉回的那一行（缺扩展列，只有基础字段）。 */
function serverRow(): TradeJournal {
  return {
    id: 'journal-1',
    user_id: OWNER,
    symbol: 'BTCUSDT',
    direction: 'long',
    pre_simulated_time: '2026-06-16T00:00:00.000Z',
    post_outcome: 'loss',
    journal_kind: 'trade',
    order_kind: 'main',
  } as unknown as TradeJournal;
}

const emoSpec = POST_FIELD_SPECS.find(s => s.key === 'post_emo_disturbance')!;

describe('平仓评价 → 本地镜像 → 错题集汇总（闭环）', () => {
  beforeEach(() => {
    localStorage.clear();
    dbColumns = new Set([
      'id', 'user_id',
      'post_outcome', 'post_realized_pnl', 'post_r_multiple',
      'post_reflection', 'post_correct_action', 'post_reviewed_at',
    ]);
    getUserResult = { id: OWNER };
    sessionUser = { id: OWNER };
  });

  it('远程缺列时，提交仍成功落基础字段（成功语义，不整笔失败）', async () => {
    const updated = await finalizeJournalReview('journal-1', FINALIZE_INPUT);
    expect((updated as { post_outcome?: string }).post_outcome).toBe('loss');
  });

  it('被剥离的 post_emo_* 写入本地镜像，applyLocalMirror 合并后在汇总里计为「已填」', async () => {
    // 合并前：server 行没有 post_emo_disturbance → 汇总 0/1。
    const before = summarizeField([serverRow()], emoSpec);
    expect(before.filled).toBe(0);

    await finalizeJournalReview('journal-1', FINALIZE_INPUT);

    // 合并后：本地镜像把所填内容补回 → 汇总 1/1。
    const merged = applyLocalMirror(OWNER, [serverRow()]);
    expect((merged[0] as Record<string, unknown>).post_emo_disturbance).toBe('价格一回撤我就慌');
    const after = summarizeField(merged as TradeJournal[], emoSpec);
    expect(after.filled).toBe(1);
  });

  it('回归：即便 auth.getUser() 抖动返回 null，镜像仍用「行自带 user_id」写入 → 汇总不再 0/N', async () => {
    getUserResult = null;   // 旧实现会让 userId=null、镜像被静默跳过。
    sessionUser = null;     // 连本地 session 也读不到，逼迫只能走「行自带 user_id」。

    await finalizeJournalReview('journal-1', FINALIZE_INPUT);

    const merged = applyLocalMirror(OWNER, [serverRow()]);
    const after = summarizeField(merged as TradeJournal[], emoSpec);
    expect(after.filled).toBe(1);
  });
});
