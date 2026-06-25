import { describe, expect, it } from 'vitest';

import { buildCloseReviewReflectionText, emptyCloseReviewAuditAnswers } from '../reflectionFacts';
import { POST_FIELD_SPECS, summarizeField } from '../journalSummary';
import type { TradeJournal } from '@/types/journal';

function journal(id: string, postReflection: string | null): TradeJournal {
  return {
    id,
    symbol: 'BTCUSDT',
    direction: 'long',
    pre_simulated_time: '2026-06-25T00:00:00.000Z',
    post_outcome: 'loss',
    post_reflection: postReflection,
  } as unknown as TradeJournal;
}

describe('journalSummary close-review audit fields', () => {
  it('summarizes each audit question as an independent post-review row', () => {
    const answers = emptyCloseReviewAuditAnswers();
    answers.decision_basis = '基于跌破结构事实平仓，不是怕亏。';
    answers.cycle_stage = '趋势末端转震荡，阶段识别偏慢。';
    answers.trend_stop = '该止时止了，中间没有多余动作。';
    const stored = buildCloseReviewReflectionText(null, answers);
    const spec = POST_FIELD_SPECS.find(item => item.id === 'post_reflection_cycle_stage');

    expect(spec).toBeTruthy();
    const summary = summarizeField([journal('j1', stored), journal('j2', null)], spec!);

    expect(summary.type).toBe('text');
    if (summary.type !== 'text') return;
    expect(summary.filled).toBe(1);
    expect(summary.empty).toBe(1);
    expect(summary.answers[0].text).toBe('趋势末端转震荡，阶段识别偏慢。');
  });
});
