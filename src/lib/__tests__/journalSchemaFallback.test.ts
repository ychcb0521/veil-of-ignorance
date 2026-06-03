/**
 * 回归：远程库落后于迁移、缺列时（例如 pre_confidence_basis 还没建进 schema 缓存），
 * 决策记录快照提交不能整笔失败，而应逐列剥离缺失列后重试，最终成功写入。
 *
 * 复现用户线上报错：
 *   Could not find the 'pre_confidence_basis' column of 'trade_journals' in the schema cache
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

// 假装「远程库」只建了这些列；其余列会触发 PGRST204（schema 缓存里找不到）。
let dbColumns = new Set<string>();

vi.mock('@/integrations/supabase/client', () => {
  function from() {
    let payload: Record<string, unknown> = {};
    const builder = {
      insert(p: Record<string, unknown>) { payload = { ...p }; return builder; },
      update(p: Record<string, unknown>) { payload = { ...p }; return builder; },
      eq() { return builder; },
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
        return Promise.resolve({ data: { id: 'journal-new', ...payload }, error: null });
      },
    };
    return builder;
  }
  return { supabase: { from } };
});

import {
  insertTradeJournalWithSchemaFallback,
  missingSchemaColumn,
  isSchemaColumnMissingError,
} from '../journalApi';

const SCHEMA_CACHE_ERR = {
  code: 'PGRST204',
  message: "Could not find the 'pre_confidence_basis' column of 'trade_journals' in the schema cache",
};

describe('schema-cache column fallback', () => {
  beforeEach(() => {
    // 远程库只建了基础列，尚未应用 v2 / cheap-opportunity / market-regime 等迁移。
    dbColumns = new Set(['user_id', 'symbol', 'direction', 'pre_entry_reason', 'id']);
  });

  it('从 PostgREST 报错里解析出缺失的列名', () => {
    expect(missingSchemaColumn(SCHEMA_CACHE_ERR)).toBe('pre_confidence_basis');
  });

  it('把 PGRST204 / schema-cache 报错识别为「可剥离的缺列」', () => {
    expect(isSchemaColumnMissingError(SCHEMA_CACHE_ERR)).toBe(true);
    // 即便没有 error.code，单凭报错文案也能识别。
    expect(isSchemaColumnMissingError({ message: SCHEMA_CACHE_ERR.message })).toBe(true);
  });

  it('不把 NOT NULL 等约束违反误判为缺列', () => {
    expect(isSchemaColumnMissingError({
      code: '23502',
      message: 'null value in column "pre_entry_reason" violates not-null constraint',
    })).toBe(false);
  });

  it('缺列时逐列剥离后仍能成功插入（提交闭环不被打断）', async () => {
    const { data, error } = await insertTradeJournalWithSchemaFallback({
      user_id: 'u1',
      symbol: 'BTCUSDT',
      direction: 'long',
      pre_entry_reason: null,
      pre_confidence_basis: '我对这个结构有信心',
      pre_cheap_opportunity: 'cheap',
      pre_market_regime: 'trend',
      pre_odds_structure: 'breakout',
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: 'journal-new', user_id: 'u1', symbol: 'BTCUSDT' });
    // 缺失列被剥离，不应出现在写入结果里。
    expect(data as Record<string, unknown>).not.toHaveProperty('pre_confidence_basis');
    expect(data as Record<string, unknown>).not.toHaveProperty('pre_market_regime');
  });
});
