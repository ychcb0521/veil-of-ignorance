import { describe, expect, it } from 'vitest';
import {
  buildEmotionDiaryExportSummary,
  emptyEmotionDiaryDraft,
  emotionDiaryCompletion,
  HADS_ANXIETY_QUESTIONS,
  HADS_DEPRESSION_QUESTIONS,
  hadsBand,
  isEmotionDiaryDraftComplete,
  PANAS_QUESTIONS,
  PANAS_RESPONSE_OPTIONS,
  PI_QUESTIONS,
  PI_RESPONSE_OPTIONS,
  POMS_QUESTIONS,
  POMS_REVERSE_SCORED_ITEM_NUMBERS,
  POMS_RESPONSE_OPTIONS,
  scoreHadsSubscale,
  scorePanas,
  scorePersonalInitiative,
  scorePomsSubscales,
  scorePomsTotalMoodDisturbance,
} from '@/lib/emotionDiary';
import type {
  DecisionEmotionDiary,
  PanasItemScore,
  PiItemScore,
  PomsItemScore,
} from '@/types/emotionDiary';

const pomsScores = Array.from({ length: 40 }, () => 2 as PomsItemScore);
const panasScores = Array.from({ length: 20 }, () => 3 as PanasItemScore);
const piScores = Array.from({ length: 7 }, () => 5 as PiItemScore);

const diary: DecisionEmotionDiary = {
  id: 'diary-1',
  user_id: 'user-1',
  diary_date: '2026-07-25',
  event_text: '盘前收到一条意外消息，注意力持续被拉回这件事。',
  sam_valence: null,
  sam_arousal: null,
  poms_item_scores: pomsScores,
  poms_tension_score: 12,
  poms_anger_score: 14,
  poms_fatigue_score: 10,
  poms_depression_score: 12,
  poms_vigor_score: 12,
  poms_confusion_score: 10,
  poms_esteem_score: 10,
  poms_total_mood_disturbance: 126,
  panas_item_scores: panasScores,
  panas_positive_score: 30,
  panas_negative_score: 30,
  pi_item_scores: piScores,
  pi_total_score: 35,
  pi_mean_score: 5,
  hads_anxiety_scores: [1, 2, 1, 0, 2, 1, 1],
  hads_depression_scores: [0, 1, 0, 1, 1, 0, 1],
  hads_anxiety_score: 8,
  hads_depression_score: 4,
  measurement_version: 'POMS-CN-40+PANAS-20+PI-7+HADS-14-research-v3',
  created_at: '2026-07-25T01:00:00.000Z',
  updated_at: '2026-07-25T01:00:00.000Z',
};

describe('decision emotion diary scoring', () => {
  it('完整提供 POMS 40 项并维持 0–4 分研究评分', () => {
    expect(POMS_QUESTIONS).toHaveLength(40);
    expect(new Set(POMS_QUESTIONS.map(question => question.code)).size).toBe(40);
    expect(POMS_RESPONSE_OPTIONS.map(option => option.score)).toEqual([0, 1, 2, 3, 4]);
    expect(POMS_QUESTIONS.every(question => question.term.length > 0 && question.subscale)).toBe(true);
    expect(POMS_QUESTIONS.map(question => question.subscale)).toEqual([
      'tension', 'anger', 'fatigue', 'depression', 'vigor', 'confusion', 'esteem',
      'tension', 'anger', 'fatigue', 'depression', 'vigor', 'confusion', 'esteem',
      'tension', 'anger', 'fatigue', 'depression', 'vigor', 'confusion', 'tension',
      'anger', 'fatigue', 'depression', 'vigor', 'confusion', 'esteem', 'tension',
      'anger', 'fatigue', 'depression', 'vigor', 'confusion', 'esteem', 'tension',
      'anger', 'anger', 'depression', 'vigor', 'esteem',
    ]);
    expect(POMS_REVERSE_SCORED_ITEM_NUMBERS).toEqual([7]);
    expect(POMS_QUESTIONS.filter(question => question.reverseScored).map(question => question.code))
      .toEqual(['P7']);
  });

  it('按中国简式 POMS-40 的七个分量表映射、反向题与 TMD 公式计分', () => {
    const allZero = Array.from({ length: 40 }, () => 0 as PomsItemScore);
    const zeroScores = scorePomsSubscales(allZero);
    expect(zeroScores).toEqual({
      tension: 0,
      anger: 0,
      fatigue: 0,
      depression: 0,
      vigor: 0,
      confusion: 0,
      esteem: 4,
    });
    expect(scorePomsTotalMoodDisturbance(zeroScores)).toBe(96);

    const allFour = Array.from({ length: 40 }, () => 4 as PomsItemScore);
    const maxItemScores = scorePomsSubscales(allFour);
    expect(maxItemScores).toEqual({
      tension: 24,
      anger: 28,
      fatigue: 20,
      depression: 24,
      vigor: 24,
      confusion: 20,
      esteem: 16,
    });
    expect(scorePomsTotalMoodDisturbance(maxItemScores)).toBe(176);
  });

  it('仅将 P7“为难的”反向计分，其他自尊题保持正向', () => {
    const baseline = Array.from({ length: 40 }, () => 0 as PomsItemScore);
    expect(scorePomsSubscales(baseline).esteem).toBe(4);

    const embarrassed = [...baseline];
    embarrassed[6] = 4;
    expect(scorePomsSubscales(embarrassed).esteem).toBe(0);

    const confident = [...baseline];
    confident[13] = 4;
    expect(scorePomsSubscales(confident).esteem).toBe(8);
  });

  it('POMS TMD 的理论边界为 56–216', () => {
    const bestMood = Array.from({ length: 40 }, (_, index) => (
      [4, 11, 18, 24, 31, 38].includes(index) || [13, 26, 33, 39].includes(index)
        ? 4
        : 0
    )) as PomsItemScore[];
    const worstMood = Array.from({ length: 40 }, (_, index) => (
      [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 27, 28, 29, 30, 32, 34, 35, 36, 37].includes(index)
        ? 4
        : 0
    )) as PomsItemScore[];

    expect(scorePomsTotalMoodDisturbance(scorePomsSubscales(bestMood))).toBe(56);
    expect(scorePomsTotalMoodDisturbance(scorePomsSubscales(worstMood))).toBe(216);
  });

  it('完整提供 PANAS 20 项，并分别计算 10 项正性与 10 项负性情感', () => {
    expect(PANAS_QUESTIONS).toHaveLength(20);
    expect(PANAS_QUESTIONS.filter(question => question.dimension === 'positive')).toHaveLength(10);
    expect(PANAS_QUESTIONS.filter(question => question.dimension === 'negative')).toHaveLength(10);
    expect(PANAS_RESPONSE_OPTIONS.map(option => option.score)).toEqual([1, 2, 3, 4, 5]);

    expect(scorePanas(Array.from({ length: 20 }, () => 1 as PanasItemScore))).toEqual({
      positive: 10,
      negative: 10,
    });
    expect(scorePanas(Array.from({ length: 20 }, () => 5 as PanasItemScore))).toEqual({
      positive: 50,
      negative: 50,
    });
  });

  it('完整提供 PI-7 七个正向题，并按 1–7 分计算总分与均分', () => {
    expect(PI_QUESTIONS).toHaveLength(7);
    expect(new Set(PI_QUESTIONS.map(question => question.code)).size).toBe(7);
    expect(PI_QUESTIONS.every(question => question.prompt.length > 8)).toBe(true);
    expect(PI_RESPONSE_OPTIONS.map(option => option.score)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(scorePersonalInitiative(Array.from({ length: 7 }, () => 1 as PiItemScore)))
      .toEqual({ total: 7, mean: 1 });
    expect(scorePersonalInitiative(Array.from({ length: 7 }, () => 7 as PiItemScore)))
      .toEqual({ total: 49, mean: 7 });
    expect(scorePersonalInitiative([1, 2, 3, 4, 5, 6, 7])).toEqual({ total: 28, mean: 4 });
  });

  it('按 7 个 0–3 分项目分别计算 HADS-A / HADS-D', () => {
    expect(scoreHadsSubscale(diary.hads_anxiety_scores)).toBe(8);
    expect(scoreHadsSubscale(diary.hads_depression_scores)).toBe(4);
    expect(() => scoreHadsSubscale([0, 1, 2])).toThrow();
  });

  it('为焦虑和抑郁分量表提供 14 道可直接作答的具体题目', () => {
    expect(HADS_ANXIETY_QUESTIONS).toHaveLength(7);
    expect(HADS_DEPRESSION_QUESTIONS).toHaveLength(7);

    const questions = [...HADS_ANXIETY_QUESTIONS, ...HADS_DEPRESSION_QUESTIONS];
    expect(new Set(questions.map(question => question.code)).size).toBe(14);
    questions.forEach(question => {
      expect(question.prompt.length).toBeGreaterThan(10);
      expect(question.options.map(option => option.score)).toEqual([0, 1, 2, 3]);
      expect(question.options.every(option => option.label.length > 0)).toBe(true);
    });
  });

  it('使用 HADS 正式分量表区间边界', () => {
    expect(hadsBand(0).key).toBe('normal');
    expect(hadsBand(7).key).toBe('normal');
    expect(hadsBand(8).key).toBe('borderline');
    expect(hadsBand(10).key).toBe('borderline');
    expect(hadsBand(11).key).toBe('abnormal');
    expect(hadsBand(21).key).toBe('abnormal');
  });

  it('只有事件、POMS、PANAS、PI-7 和两个 HADS 分量表全部完成后才允许保存', () => {
    const draft = emptyEmotionDiaryDraft('2026-07-25');
    expect(isEmotionDiaryDraftComplete(draft)).toBe(false);
    expect(emotionDiaryCompletion(draft)).toEqual({
      event: false,
      poms: false,
      panas: false,
      initiative: false,
      anxiety: false,
      depression: false,
    });

    draft.event_text = diary.event_text;
    draft.poms_item_scores = [...pomsScores];
    draft.panas_item_scores = [...panasScores];
    draft.pi_item_scores = [...piScores];
    draft.hads_anxiety_scores = [...diary.hads_anxiety_scores];
    draft.hads_depression_scores = [...diary.hads_depression_scores];
    expect(isEmotionDiaryDraftComplete(draft)).toBe(true);
  });

  it('导出呈现 POMS、PANAS、PI-7、HADS 的研究计分结果', () => {
    const summary = buildEmotionDiaryExportSummary(diary);
    expect(summary.eventText).toBe(diary.event_text);
    expect(summary.pomsTotal).toBe('136（TMD）');
    expect(summary.pomsDimensions).toContain('紧张 12');
    expect(summary.pomsDimensions).toContain('自尊 10');
    expect(summary.panasPositive).toBe('30/50');
    expect(summary.panasNegative).toBe('30/50');
    expect(summary.personalInitiativeTotal).toBe('35/49');
    expect(summary.personalInitiativeMean).toBe('5.00/7');
    expect(summary.anxiety).toBe('8/21（临界范围，8–10）');
    expect(summary.depression).toBe('4/21（正常范围，0–7）');
  });

  it('导出时依据逐题答案重算 POMS，避免沿用历史错误汇总分', () => {
    const staleDiary = {
      ...diary,
      poms_item_scores: Array.from({ length: 40 }, () => 0 as PomsItemScore),
      poms_esteem_score: 0,
      poms_total_mood_disturbance: 100,
    };
    const summary = buildEmotionDiaryExportSummary(staleDiary);

    expect(summary.pomsTotal).toBe('96（TMD）');
    expect(summary.pomsDimensions).toContain('自尊 4');
  });

  it('旧 SAM 日记仍可读取并明确标为历史量表', () => {
    const legacy = {
      ...diary,
      sam_valence: 3,
      sam_arousal: 8,
      poms_item_scores: [],
      poms_tension_score: null,
      poms_anger_score: null,
      poms_fatigue_score: null,
      poms_depression_score: null,
      poms_vigor_score: null,
      poms_confusion_score: null,
      poms_esteem_score: null,
      poms_total_mood_disturbance: null,
      panas_item_scores: [],
      panas_positive_score: null,
      panas_negative_score: null,
      pi_item_scores: [],
      pi_total_score: null,
      pi_mean_score: null,
    };
    const summary = buildEmotionDiaryExportSummary(legacy);
    expect(summary.pomsTotal).toBeNull();
    expect(summary.personalInitiativeTotal).toBeNull();
    expect(summary.legacyValence).toBe('3/9（偏负性）');
    expect(summary.legacyArousal).toBe('8/9（高唤醒）');
  });
});
