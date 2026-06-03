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
        const orderKind = payload.order_kind ?? 'main';
        const violatesMainCompleteness = orderKind !== 'hedge'
          && ['pre_risk_awareness', 'pre_risk_management', 'pre_checklist_items', 'pre_checklist_passed']
            .some(k => payload[k] == null);
        if (violatesMainCompleteness) {
          return Promise.resolve({
            data: null,
            error: {
              code: '23514',
              message: 'new row for relation "trade_journals" violates check constraint "chk_main_order_completeness"',
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
  normalizeMainOrderLegacyCompleteness,
} from '../journalApi';

const SCHEMA_CACHE_ERR = {
  code: 'PGRST204',
  message: "Could not find the 'pre_confidence_basis' column of 'trade_journals' in the schema cache",
};

describe('schema-cache column fallback', () => {
  beforeEach(() => {
    // 远程库只建了基础列，尚未应用 v2 / cheap-opportunity / market-regime 等迁移。
    dbColumns = new Set([
      'user_id',
      'symbol',
      'direction',
      'pre_entry_reason',
      'pre_risk_awareness',
      'pre_risk_management',
      'pre_checklist_items',
      'pre_checklist_passed',
      'id',
    ]);
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

  it('新版主力单快照会生成旧完整性约束需要的镜像字段', () => {
    const normalized = normalizeMainOrderLegacyCompleteness({
      order_kind: 'main',
      pre_entry_reason: null,
      pre_risk_awareness: null,
      pre_risk_management: null,
      pre_checklist_items: null,
      pre_checklist_passed: null,
      pre_thesis_why_right: '方向和结构一起给了正期望',
      pre_premortem_failure_reason: '如果亏完，多半是突破未被接受',
      pre_falsification_signal: '跌回突破位下方',
    });

    expect(normalized.pre_entry_reason).toBe('方向和结构一起给了正期望');
    expect(normalized.pre_risk_awareness).toBe('如果亏完，多半是突破未被接受');
    expect(normalized.pre_risk_management).toBe('封死下限：这是让你敢多下、且每个赢家更肥的前提。证伪/结构破坏信号：跌回突破位下方');
    expect(normalized.pre_checklist_items).toEqual([]);
    expect(normalized.pre_checklist_passed).toBe(true);
  });

  it('对冲单不生成主力单 legacy 完整性字段', () => {
    const normalized = normalizeMainOrderLegacyCompleteness({
      order_kind: 'hedge',
      pre_entry_reason: null,
      pre_risk_awareness: null,
      pre_risk_management: null,
      pre_checklist_items: null,
      pre_checklist_passed: null,
    });

    expect(normalized.pre_risk_awareness).toBeNull();
    expect(normalized.pre_risk_management).toBeNull();
    expect(normalized.pre_checklist_items).toBeNull();
    expect(normalized.pre_checklist_passed).toBeNull();
  });

  it('旧表仍有 chk_main_order_completeness 时，确认下单插入也能跑通', async () => {
    const { data, error } = await insertTradeJournalWithSchemaFallback({
      user_id: 'u1',
      symbol: 'BTCUSDT',
      direction: 'long',
      order_kind: 'main',
      pre_entry_reason: null,
      pre_risk_awareness: null,
      pre_risk_management: null,
      pre_checklist_items: null,
      pre_checklist_passed: null,
      pre_thesis_why_right: '方向和结构一起给了正期望',
      pre_premortem_failure_reason: '如果亏完，多半是突破未被接受',
      pre_falsification_signal: '跌回突破位下方',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: 'journal-new',
      user_id: 'u1',
      symbol: 'BTCUSDT',
      pre_entry_reason: '方向和结构一起给了正期望',
      pre_risk_awareness: '如果亏完，多半是突破未被接受',
      pre_risk_management: '封死下限：这是让你敢多下、且每个赢家更肥的前提。证伪/结构破坏信号：跌回突破位下方',
      pre_checklist_items: [],
      pre_checklist_passed: true,
    });
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

  it('先缺 pre_confidence_basis 时，也会把新版三问 A 回填到 legacy pre_entry_reason', async () => {
    dbColumns = new Set([
      'user_id',
      'symbol',
      'direction',
      'pre_entry_reason',
      'pre_risk_awareness',
      'pre_risk_management',
      'pre_checklist_items',
      'pre_checklist_passed',
      'pre_thesis_why_right',
      'id',
    ]);

    const { data, error } = await insertTradeJournalWithSchemaFallback({
      user_id: 'u1',
      symbol: 'BTCUSDT',
      direction: 'long',
      pre_entry_reason: null,
      pre_thesis_why_right: '方向和结构一起给了正期望',
      pre_confidence_basis: '我对这个结构有 57% 胜率信心',
    });

    expect(error).toBeNull();
    const row = data as Record<string, unknown>;
    expect(row.pre_entry_reason).toBe('方向和结构一起给了正期望');
    expect(row.pre_thesis_why_right).toBe('方向和结构一起给了正期望');
    expect(row).not.toHaveProperty('pre_confidence_basis');
  });

  it('解析 Postgres 原生 42703（未加引号 / 带表 / schema 前缀）的列名', () => {
    expect(missingSchemaColumn({
      message: 'column trade_journals.pre_confidence_basis does not exist',
    })).toBe('pre_confidence_basis');
    // 加引号的 42703 也能解析。
    expect(missingSchemaColumn({
      code: '42703',
      message: 'column "pre_market_regime" does not exist',
    })).toBe('pre_market_regime');
    // schema 限定前缀（public.trade_journals.xxx）同样能解析。
    expect(missingSchemaColumn({
      message: 'column public.trade_journals.pre_edge_source does not exist',
    })).toBe('pre_edge_source');
  });

  it('把 Postgres 42703「does not exist」识别为可剥离缺列', () => {
    expect(isSchemaColumnMissingError({
      code: '42703',
      message: 'column trade_journals.pre_confidence_basis does not exist',
    })).toBe(true);
    // 即便没有 error.code，单凭「does not exist」文案＋可解析列名也能识别。
    expect(isSchemaColumnMissingError({
      message: 'column trade_journals.pre_confidence_basis does not exist',
    })).toBe(true);
  });

  it('严重漂移：缺 >5 列触发批量剥离，核心列保留、提交仍成功（不再卡在 30 次上限）', async () => {
    const { data, error } = await insertTradeJournalWithSchemaFallback({
      user_id: 'u1',
      symbol: 'BTCUSDT',
      direction: 'long',
      pre_entry_reason: '核心理由',
      // 以下全部是远程库尚未建好的「可选/新增」列（>5，足以触发批量剥离）。
      pre_confidence_basis: 'x',
      pre_cheap_opportunity: 'cheap',
      pre_market_regime: 'trend',
      pre_odds_structure: 'r2_supported',
      pre_entry_stage: 'early',
      pre_stop_quality: 'structural',
      pre_thesis_why_right: '论点',
      journal_kind: 'trade',
      exit_falsification_status: 'not_triggered',
      hedge_type: null,
      post_decision_quality: 'good',
    });
    expect(error).toBeNull();
    const row = data as Record<string, unknown>;
    // 核心列必须保留。
    expect(row).toMatchObject({
      user_id: 'u1', symbol: 'BTCUSDT', direction: 'long', pre_entry_reason: '核心理由',
    });
    // 所有可选列都应被剥离。
    for (const k of [
      'pre_confidence_basis', 'pre_cheap_opportunity', 'pre_market_regime', 'pre_odds_structure',
      'pre_entry_stage', 'pre_stop_quality', 'pre_thesis_why_right', 'journal_kind',
      'exit_falsification_status', 'hedge_type', 'post_decision_quality',
    ]) {
      expect(row).not.toHaveProperty(k);
    }
  });

  it('批量剥离时 pre_entry_reason 为空，则从 pre_thesis_why_right 回填（NOT NULL 兜底）', async () => {
    const { data, error } = await insertTradeJournalWithSchemaFallback({
      user_id: 'u1',
      symbol: 'BTCUSDT',
      direction: 'long',
      pre_entry_reason: null,
      pre_confidence_basis: 'x',
      pre_cheap_opportunity: 'cheap',
      pre_market_regime: 'trend',
      pre_odds_structure: 'r2_supported',
      pre_entry_stage: 'early',
      pre_thesis_why_right: '我的论点就是入场理由',
    });
    expect(error).toBeNull();
    const row = data as Record<string, unknown>;
    expect(row.pre_entry_reason).toBe('我的论点就是入场理由');
    expect(row).not.toHaveProperty('pre_thesis_why_right');
  });
});
