import { describe, expect, it } from 'vitest';

import {
  buildCloseReviewReflectionText,
  CLOSE_REVIEW_AUDIT_SEPARATOR_CORE,
  emptyCloseReviewAuditAnswers,
  getCloseReviewAuditAnswer,
  parseCloseReviewReflectionText,
  buildReflectionText,
  parseReflectionText,
  REFLECTION_SEPARATOR_CORE,
} from '../reflectionFacts';

describe('buildReflectionText', () => {
  it('joins facts and interpretation with the readable separator', () => {
    const out = buildReflectionText('价格跌破前低后快速收回', '我把假突破当成了趋势反转');
    expect(out).toContain(REFLECTION_SEPARATOR_CORE);
    expect(out.startsWith('价格跌破前低后快速收回')).toBe(true);
    expect(out.endsWith('我把假突破当成了趋势反转')).toBe(true);
  });

  it('degrades to plain interpretation when facts are empty (backward compatible)', () => {
    expect(buildReflectionText('', '只学到一句话')).toBe('只学到一句话');
    expect(buildReflectionText('   ', '只学到一句话')).toBe('只学到一句话');
    expect(buildReflectionText('', '只学到一句话')).not.toContain(REFLECTION_SEPARATOR_CORE);
  });

  it('trims both segments', () => {
    const out = buildReflectionText('  事实  ', '  解释  ');
    expect(out).toBe(`事实\n\n${REFLECTION_SEPARATOR_CORE}\n\n解释`);
  });
});

describe('close review audit reflection helpers', () => {
  it('stores the close-review audit answers in a readable block', () => {
    const answers = emptyCloseReviewAuditAnswers();
    answers.decision_basis = '证据来自放量突破，不是为了扳回上一笔。';
    answers.cycle_stage = '仍在右侧趋势中，没有把震荡期待错套进来。';
    answers.trend_stop = '跌破预设失效位后止住，没有反复乱动。';
    answers.schelling_floor_weight = '全程把谢林兜底区放在最高权重，没有被短线噪音挤掉。';

    const stored = buildCloseReviewReflectionText('旧版复盘仍保留', answers);

    expect(stored).toContain('旧版复盘仍保留');
    expect(stored).toContain(CLOSE_REVIEW_AUDIT_SEPARATOR_CORE);
    expect(getCloseReviewAuditAnswer(stored, 'decision_basis')).toBe(answers.decision_basis);
    expect(getCloseReviewAuditAnswer(stored, 'cycle_stage')).toBe(answers.cycle_stage);
    expect(getCloseReviewAuditAnswer(stored, 'trend_stop')).toBe(answers.trend_stop);
    expect(getCloseReviewAuditAnswer(stored, 'schelling_floor_weight')).toBe(answers.schelling_floor_weight);
  });

  it('keeps legacy reflection text separate when parsing', () => {
    const answers = emptyCloseReviewAuditAnswers();
    answers.decision_basis = '事实驱动。';
    answers.cycle_stage = '阶段识别正确。';
    answers.trend_stop = '没有乱动。';
    answers.schelling_floor_weight = '给足了谢林兜底区权重。';

    const parsed = parseCloseReviewReflectionText(buildCloseReviewReflectionText('老文本', answers));

    expect(parsed.legacyText).toBe('老文本');
    expect(parsed.answers).toEqual(answers);
  });

  it('replaces an old audit block instead of duplicating it', () => {
    const first = emptyCloseReviewAuditAnswers();
    first.decision_basis = '旧答案';
    first.cycle_stage = '旧阶段';
    first.trend_stop = '旧止';
    first.schelling_floor_weight = '旧权重';

    const second = emptyCloseReviewAuditAnswers();
    second.decision_basis = '新答案';
    second.cycle_stage = '新阶段';
    second.trend_stop = '新止';
    second.schelling_floor_weight = '新权重';

    const updated = buildCloseReviewReflectionText(buildCloseReviewReflectionText('老文本', first), second);

    expect(updated.match(new RegExp(CLOSE_REVIEW_AUDIT_SEPARATOR_CORE, 'g'))?.length).toBe(1);
    expect(getCloseReviewAuditAnswer(updated, 'decision_basis')).toBe('新答案');
    expect(getCloseReviewAuditAnswer(updated, 'schelling_floor_weight')).toBe('新权重');
    expect(parseCloseReviewReflectionText(updated).legacyText).toBe('老文本');
  });

  it('parses records saved with the old three-question separator', () => {
    const stored = [
      '老文本',
      '———（平仓评价三问）———',
      '【① 客观事实还是自洽借口】',
      '事实驱动。',
      '',
      '【② 周期阶段是否辨认准确】',
      '阶段正确。',
      '',
      '【③ 顺势而止其所当止】',
      '没有乱动。',
    ].join('\n');

    const parsed = parseCloseReviewReflectionText(stored);

    expect(parsed.legacyText).toBe('老文本');
    expect(parsed.answers.decision_basis).toBe('事实驱动。');
    expect(parsed.answers.cycle_stage).toBe('阶段正确。');
    expect(parsed.answers.trend_stop).toBe('没有乱动。');
    expect(parsed.answers.schelling_floor_weight).toBe('');
  });
});

describe('parseReflectionText', () => {
  it('round-trips facts + interpretation', () => {
    const stored = buildReflectionText('盘面事实多行\n第二行', '我的解释');
    const parsed = parseReflectionText(stored);
    expect(parsed.facts).toBe('盘面事实多行\n第二行');
    expect(parsed.interpretation).toBe('我的解释');
  });

  it('treats a legacy single-field reflection as interpretation only', () => {
    const parsed = parseReflectionText('这是旧版只有一段的复盘文字');
    expect(parsed.facts).toBe('');
    expect(parsed.interpretation).toBe('这是旧版只有一段的复盘文字');
  });

  it('handles null / undefined / empty', () => {
    expect(parseReflectionText(null)).toEqual({ facts: '', interpretation: '' });
    expect(parseReflectionText(undefined)).toEqual({ facts: '', interpretation: '' });
    expect(parseReflectionText('')).toEqual({ facts: '', interpretation: '' });
  });

  it('normalizes CRLF before splitting', () => {
    const stored = `事实\r\n\r\n${REFLECTION_SEPARATOR_CORE}\r\n\r\n解释`;
    const parsed = parseReflectionText(stored);
    expect(parsed.facts).toBe('事实');
    expect(parsed.interpretation).toBe('解释');
  });
});
