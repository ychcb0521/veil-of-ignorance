import type {
  DecisionEmotionDiary,
  DecisionEmotionDiaryDraft,
  EmotionDiaryExportSummary,
  HadsItemScore,
  SamDimension,
} from '@/types/emotionDiary';

export const EMOTION_DIARY_MEASUREMENT_VERSION = 'SAM-VA-9+HADS-14-guided-v2';
export const HADS_ITEM_COUNT = 7;

export type HadsBand = {
  key: 'normal' | 'borderline' | 'abnormal';
  label: string;
  range: string;
};

export type SamScaleQuestion = {
  prompt: string;
  options: ReadonlyArray<{
    score: number;
    label: string;
  }>;
};

export const SAM_SCALE_QUESTIONS: Record<SamDimension, SamScaleQuestion> = {
  valence: {
    prompt: '回想今天截至此刻的整体感受，你的情绪处在多么不愉悦或愉悦的位置？',
    options: [
      { score: 1, label: '非常不愉悦' },
      { score: 2, label: '很不愉悦' },
      { score: 3, label: '不愉悦' },
      { score: 4, label: '略不愉悦' },
      { score: 5, label: '中性' },
      { score: 6, label: '略愉悦' },
      { score: 7, label: '愉悦' },
      { score: 8, label: '很愉悦' },
      { score: 9, label: '非常愉悦' },
    ],
  },
  arousal: {
    prompt: '回想今天截至此刻的整体状态，你的身心处在多么平静或激活的位置？',
    options: [
      { score: 1, label: '非常平静' },
      { score: 2, label: '很平静' },
      { score: 3, label: '平静' },
      { score: 4, label: '略平静' },
      { score: 5, label: '中等唤醒' },
      { score: 6, label: '略激活' },
      { score: 7, label: '激活' },
      { score: 8, label: '很激活' },
      { score: 9, label: '极度激活' },
    ],
  },
};

export type HadsQuestion = {
  code: string;
  prompt: string;
  options: ReadonlyArray<{
    score: HadsItemScore;
    label: string;
  }>;
};

export const HADS_ANXIETY_QUESTIONS: ReadonlyArray<HadsQuestion> = [
  {
    code: 'A1',
    prompt: '过去一周，我有多少时候感到内心紧绷、难以松下来？',
    options: [
      { score: 0, label: '几乎没有' },
      { score: 1, label: '偶尔如此' },
      { score: 2, label: '经常如此' },
      { score: 3, label: '大部分时间如此' },
    ],
  },
  {
    code: 'A2',
    prompt: '担心某件糟糕的事情即将发生时，这种感觉有多强？',
    options: [
      { score: 0, label: '没有这种感觉' },
      { score: 1, label: '有一点，但不困扰' },
      { score: 2, label: '比较明显' },
      { score: 3, label: '非常强烈' },
    ],
  },
  {
    code: 'A3',
    prompt: '担忧的想法在我脑中反复盘旋的频率如何？',
    options: [
      { score: 0, label: '很少' },
      { score: 1, label: '偶尔' },
      { score: 2, label: '经常' },
      { score: 3, label: '几乎持续' },
    ],
  },
  {
    code: 'A4',
    prompt: '我能否安稳地坐着，并让身体和心情放松下来？',
    options: [
      { score: 0, label: '可以，通常很放松' },
      { score: 1, label: '多数时候可以' },
      { score: 2, label: '很少能做到' },
      { score: 3, label: '几乎做不到' },
    ],
  },
  {
    code: 'A5',
    prompt: '紧张时，我出现胃里发紧、心里发空或类似不适的频率如何？',
    options: [
      { score: 0, label: '没有' },
      { score: 1, label: '偶尔' },
      { score: 2, label: '经常' },
      { score: 3, label: '非常频繁' },
    ],
  },
  {
    code: 'A6',
    prompt: '我是否坐立不安，感觉必须活动起来才舒服一些？',
    options: [
      { score: 0, label: '没有' },
      { score: 1, label: '有一点' },
      { score: 2, label: '比较明显' },
      { score: 3, label: '非常强烈' },
    ],
  },
  {
    code: 'A7',
    prompt: '我突然感到恐慌或强烈惊惧的频率如何？',
    options: [
      { score: 0, label: '没有' },
      { score: 1, label: '偶尔' },
      { score: 2, label: '经常' },
      { score: 3, label: '非常频繁' },
    ],
  },
];

export const HADS_DEPRESSION_QUESTIONS: ReadonlyArray<HadsQuestion> = [
  {
    code: 'D1',
    prompt: '我还能从过去喜欢的事情中获得多少乐趣？',
    options: [
      { score: 0, label: '和以前一样' },
      { score: 1, label: '比以前略少' },
      { score: 2, label: '只剩少量' },
      { score: 3, label: '几乎没有' },
    ],
  },
  {
    code: 'D2',
    prompt: '我还能否因有趣的事情发笑，或看到事情轻松的一面？',
    options: [
      { score: 0, label: '和以前一样' },
      { score: 1, label: '比以前稍少' },
      { score: 2, label: '明显减少' },
      { score: 3, label: '几乎不能' },
    ],
  },
  {
    code: 'D3',
    prompt: '过去一周，我感到愉快、振作的频率如何？',
    options: [
      { score: 0, label: '大部分时间' },
      { score: 1, label: '有时' },
      { score: 2, label: '很少' },
      { score: 3, label: '几乎没有' },
    ],
  },
  {
    code: 'D4',
    prompt: '我是否感到自己的思考、行动或做事速度变慢？',
    options: [
      { score: 0, label: '没有' },
      { score: 1, label: '有时' },
      { score: 2, label: '经常' },
      { score: 3, label: '几乎一直如此' },
    ],
  },
  {
    code: 'D5',
    prompt: '我是否减少了对外表和日常自我照料的关注？',
    options: [
      { score: 0, label: '没有减少' },
      { score: 1, label: '略有减少' },
      { score: 2, label: '明显减少' },
      { score: 3, label: '几乎不再关心' },
    ],
  },
  {
    code: 'D6',
    prompt: '我对未来的事情还能有多少期待和愉快感？',
    options: [
      { score: 0, label: '和以前一样' },
      { score: 1, label: '比以前略少' },
      { score: 2, label: '明显减少' },
      { score: 3, label: '几乎没有' },
    ],
  },
  {
    code: 'D7',
    prompt: '我还能否从阅读、影音或其他休闲活动中获得乐趣？',
    options: [
      { score: 0, label: '经常可以' },
      { score: 1, label: '有时可以' },
      { score: 2, label: '很少可以' },
      { score: 3, label: '几乎不能' },
    ],
  },
];

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
