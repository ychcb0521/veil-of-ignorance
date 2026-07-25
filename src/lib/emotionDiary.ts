import type {
  DecisionEmotionDiary,
  DecisionEmotionDiaryDraft,
  EmotionDiaryExportSummary,
  HadsItemScore,
  SamDimension,
} from '@/types/emotionDiary';

export const EMOTION_DIARY_MEASUREMENT_VERSION = 'SAM-VA-9+HADS-14-score-entry-v1';
export const HADS_ITEM_COUNT = 7;

export type HadsBand = {
  key: 'normal' | 'borderline' | 'abnormal';
  label: string;
  range: string;
};

export function emptyHadsScores(): Array<HadsItemScore | null> {
  return Array.from({ length: HADS_ITEM_COUNT }, () => null);
}

export function emptyEmotionDiaryDraft(diaryDate: string): DecisionEmotionDiaryDraft {
  return {
    diary_date: diaryDate,
    event_text: '',
    sam_valence: null,
    sam_arousal: null,
    hads_anxiety_scores: emptyHadsScores(),
    hads_depression_scores: emptyHadsScores(),
  };
}

export function diaryToDraft(diary: DecisionEmotionDiary): DecisionEmotionDiaryDraft {
  return {
    diary_date: diary.diary_date,
    event_text: diary.event_text,
    sam_valence: diary.sam_valence,
    sam_arousal: diary.sam_arousal,
    hads_anxiety_scores: [...diary.hads_anxiety_scores],
    hads_depression_scores: [...diary.hads_depression_scores],
  };
}

export function isHadsItemScore(value: unknown): value is HadsItemScore {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 3;
}

export function isCompleteHadsScores(
  values: Array<HadsItemScore | null>,
): values is HadsItemScore[] {
  return values.length === HADS_ITEM_COUNT && values.every(isHadsItemScore);
}

export function scoreHadsSubscale(values: HadsItemScore[]): number {
  if (!isCompleteHadsScores(values)) {
    throw new Error('HADS 每个分量表必须包含 7 个 0–3 分项目');
  }
  return values.reduce<number>((sum, value) => sum + value, 0);
}

export function hadsBand(score: number): HadsBand {
  if (!Number.isInteger(score) || score < 0 || score > 21) {
    throw new Error('HADS 分量表得分必须在 0–21 之间');
  }
  if (score <= 7) return { key: 'normal', label: '正常范围', range: '0–7' };
  if (score <= 10) return { key: 'borderline', label: '临界范围', range: '8–10' };
  return { key: 'abnormal', label: '异常范围', range: '11–21' };
}

export function samDescriptor(dimension: SamDimension, score: number): string {
  if (!Number.isInteger(score) || score < 1 || score > 9) {
    throw new Error('SAM 得分必须在 1–9 之间');
  }
  if (dimension === 'valence') {
    if (score <= 3) return '偏负性';
    if (score <= 6) return '中性附近';
    return '偏正性';
  }
  if (score <= 3) return '低唤醒';
  if (score <= 6) return '中等唤醒';
  return '高唤醒';
}

export function emotionDiaryCompletion(draft: DecisionEmotionDiaryDraft) {
  return {
    event: draft.event_text.trim().length > 0,
    sam: draft.sam_valence != null && draft.sam_arousal != null,
    anxiety: isCompleteHadsScores(draft.hads_anxiety_scores),
    depression: isCompleteHadsScores(draft.hads_depression_scores),
  };
}

export function isEmotionDiaryDraftComplete(draft: DecisionEmotionDiaryDraft): boolean {
  return Object.values(emotionDiaryCompletion(draft)).every(Boolean);
}

export function buildEmotionDiaryExportSummary(
  diary: DecisionEmotionDiary,
): EmotionDiaryExportSummary {
  const anxietyBand = hadsBand(diary.hads_anxiety_score);
  const depressionBand = hadsBand(diary.hads_depression_score);
  return {
    date: diary.diary_date,
    eventText: diary.event_text.trim(),
    valence: `${diary.sam_valence}/9（${samDescriptor('valence', diary.sam_valence)}）`,
    arousal: `${diary.sam_arousal}/9（${samDescriptor('arousal', diary.sam_arousal)}）`,
    anxiety: `${diary.hads_anxiety_score}/21（${anxietyBand.label}，${anxietyBand.range}）`,
    depression: `${diary.hads_depression_score}/21（${depressionBand.label}，${depressionBand.range}）`,
  };
}
