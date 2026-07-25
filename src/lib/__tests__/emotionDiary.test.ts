import { describe, expect, it } from 'vitest';
import {
  buildEmotionDiaryExportSummary,
  emptyEmotionDiaryDraft,
  emotionDiaryCompletion,
  HADS_ANXIETY_QUESTIONS,
  HADS_DEPRESSION_QUESTIONS,
  hadsBand,
  isEmotionDiaryDraftComplete,
  SAM_SCALE_QUESTIONS,
  samDescriptor,
  scoreHadsSubscale,
} from '@/lib/emotionDiary';
import type { DecisionEmotionDiary } from '@/types/emotionDiary';

const diary: DecisionEmotionDiary = {
  id: 'diary-1',
  user_id: 'user-1',
  diary_date: '2026-07-25',
  event_text: '盘前收到一条意外消息，注意力持续被拉回这件事。',
  sam_valence: 3,
  sam_arousal: 8,
  hads_anxiety_scores: [1, 2, 1, 0, 2, 1, 1],
  hads_depression_scores: [0, 1, 0, 1, 1, 0, 1],
  hads_anxiety_score: 8,
  hads_depression_score: 4,
  measurement_version: 'SAM-VA-9+HADS-14-score-entry-v1',
  created_at: '2026-07-25T01:00:00.000Z',
  updated_at: '2026-07-25T01:00:00.000Z',
};

describe('decision emotion diary scoring', () => {
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

  it('独立解释 SAM 的效价与唤醒度', () => {
    expect(samDescriptor('valence', 3)).toBe('偏负性');
    expect(samDescriptor('valence', 7)).toBe('偏正性');
    expect(samDescriptor('arousal', 2)).toBe('低唤醒');
    expect(samDescriptor('arousal', 9)).toBe('高唤醒');
  });

  it('为情绪效价和唤醒度提供具体题目及完整的 1–9 档含义', () => {
    Object.values(SAM_SCALE_QUESTIONS).forEach(question => {
      expect(question.prompt.length).toBeGreaterThan(10);
      expect(question.options).toHaveLength(9);
      expect(question.options.map(option => option.score)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
      expect(question.options.every(option => option.label.length > 0)).toBe(true);
    });
  });

  it('只有事件、SAM 和两个 HADS 分量表全部完成后才允许保存', () => {
    const draft = emptyEmotionDiaryDraft('2026-07-25');
    expect(isEmotionDiaryDraftComplete(draft)).toBe(false);
    expect(emotionDiaryCompletion(draft)).toEqual({
      event: false,
      sam: false,
      anxiety: false,
      depression: false,
    });

    draft.event_text = diary.event_text;
    draft.sam_valence = diary.sam_valence;
    draft.sam_arousal = diary.sam_arousal;
    draft.hads_anxiety_scores = [...diary.hads_anxiety_scores];
    draft.hads_depression_scores = [...diary.hads_depression_scores];
    expect(isEmotionDiaryDraftComplete(draft)).toBe(true);
  });

  it('导出只呈现完整事件、量表分数和所在区间', () => {
    const summary = buildEmotionDiaryExportSummary(diary);
    expect(summary.eventText).toBe(diary.event_text);
    expect(summary.valence).toBe('3/9（偏负性）');
    expect(summary.arousal).toBe('8/9（高唤醒）');
    expect(summary.anxiety).toBe('8/21（临界范围，8–10）');
    expect(summary.depression).toBe('4/21（正常范围，0–7）');
  });
});
