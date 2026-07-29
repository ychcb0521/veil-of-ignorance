import type {
  DecisionEmotionDiary,
  DecisionEmotionDiaryDraft,
  EmotionDiaryExportSummary,
  HadsItemScore,
  PanasItemScore,
  PiItemScore,
  PomsItemScore,
  SamDimension,
} from '@/types/emotionDiary';

export const EMOTION_DIARY_MEASUREMENT_VERSION = 'POMS-CN-40+PANAS-20+PI-7+HADS-14-research-v3';
export const HADS_ITEM_COUNT = 7;
export const POMS_ITEM_COUNT = 40;
export const PANAS_ITEM_COUNT = 20;
export const PI_ITEM_COUNT = 7;

export type PomsSubscaleKey =
  | 'tension'
  | 'anger'
  | 'fatigue'
  | 'depression'
  | 'vigor'
  | 'confusion'
  | 'esteem';

export type PomsSubscaleScores = Record<PomsSubscaleKey, number>;

export type PomsQuestion = {
  code: string;
  term: string;
  subscale: PomsSubscaleKey;
  reverseScored: boolean;
};

export type PanasDimension = 'positive' | 'negative';

export type PanasQuestion = {
  code: string;
  term: string;
  dimension: PanasDimension;
};

export type PiQuestion = {
  code: string;
  prompt: string;
};

export const POMS_RESPONSE_OPTIONS: ReadonlyArray<{
  score: PomsItemScore;
  label: string;
}> = [
  { score: 0, label: '几乎没有' },
  { score: 1, label: '有一点' },
  { score: 2, label: '中等' },
  { score: 3, label: '相当多' },
  { score: 4, label: '非常强烈' },
];

const POMS_TERMS = [
  '紧张的',
  '生气的',
  '无精打采的',
  '不快活的',
  '轻松愉快的',
  '慌乱的',
  '为难的',
  '心烦意乱的',
  '气坏的',
  '劳累的',
  '悲伤的',
  '精神饱满的',
  '集中不了注意力的',
  '自信的',
  '内心不安的',
  '气恼的',
  '精疲力尽的',
  '沮丧的',
  '主动积极的',
  '慌张的',
  '坐卧不宁的',
  '烦恼的',
  '倦怠的',
  '忧郁的',
  '兴致勃勃的',
  '健忘的',
  '有能力感的',
  '易激动的',
  '愤怒的',
  '疲惫不堪的',
  '毫无价值的',
  '富有活力的',
  '有不确定感的',
  '满意的',
  '担忧的',
  '狂怒的',
  '抱怨的',
  '孤弱无助的',
  '劲头十足的',
  '自豪的',
] as const;

const POMS_SUBSCALE_ITEM_NUMBERS: Record<PomsSubscaleKey, ReadonlyArray<number>> = {
  tension: [1, 8, 15, 21, 28, 35],
  anger: [2, 9, 16, 22, 29, 36, 37],
  fatigue: [3, 10, 17, 23, 30],
  depression: [4, 11, 18, 24, 31, 38],
  vigor: [5, 12, 19, 25, 32, 39],
  confusion: [6, 13, 20, 26, 33],
  esteem: [7, 14, 27, 34, 40],
};

export const POMS_REVERSE_SCORED_ITEM_NUMBERS: ReadonlyArray<number> = [7];
const POMS_REVERSE_SCORED_ITEMS = new Set(POMS_REVERSE_SCORED_ITEM_NUMBERS);

const POMS_SUBSCALE_BY_ITEM = Object.fromEntries(
  Object.entries(POMS_SUBSCALE_ITEM_NUMBERS).flatMap(([subscale, itemNumbers]) => (
    itemNumbers.map(itemNumber => [itemNumber, subscale])
  )),
) as Record<number, PomsSubscaleKey>;

export const POMS_QUESTIONS: ReadonlyArray<PomsQuestion> = POMS_TERMS.map((term, index) => ({
  code: `P${index + 1}`,
  term,
  subscale: POMS_SUBSCALE_BY_ITEM[index + 1],
  reverseScored: POMS_REVERSE_SCORED_ITEMS.has(index + 1),
}));

export const PANAS_RESPONSE_OPTIONS: ReadonlyArray<{
  score: PanasItemScore;
  label: string;
}> = [
  { score: 1, label: '几乎没有' },
  { score: 2, label: '比较少' },
  { score: 3, label: '中等' },
  { score: 4, label: '比较多' },
  { score: 5, label: '非常强烈' },
];

const PANAS_ITEMS: ReadonlyArray<{
  term: string;
  dimension: PanasDimension;
}> = [
  { term: '感兴趣', dimension: 'positive' },
  { term: '苦恼', dimension: 'negative' },
  { term: '兴奋', dimension: 'positive' },
  { term: '心烦', dimension: 'negative' },
  { term: '劲头足', dimension: 'positive' },
  { term: '内疚', dimension: 'negative' },
  { term: '恐惧', dimension: 'negative' },
  { term: '敌意', dimension: 'negative' },
  { term: '热情', dimension: 'positive' },
  { term: '自豪', dimension: 'positive' },
  { term: '易怒', dimension: 'negative' },
  { term: '警觉', dimension: 'positive' },
  { term: '羞愧', dimension: 'negative' },
  { term: '备受鼓舞', dimension: 'positive' },
  { term: '紧张', dimension: 'negative' },
  { term: '意志坚定', dimension: 'positive' },
  { term: '专注', dimension: 'positive' },
  { term: '坐立不安', dimension: 'negative' },
  { term: '活跃', dimension: 'positive' },
  { term: '害怕', dimension: 'negative' },
];

export const PANAS_QUESTIONS: ReadonlyArray<PanasQuestion> = PANAS_ITEMS.map((item, index) => ({
  code: `N${index + 1}`,
  ...item,
}));

export const PI_RESPONSE_OPTIONS: ReadonlyArray<{
  score: PiItemScore;
  label: string;
}> = [
  { score: 1, label: '完全不同意' },
  { score: 2, label: '不同意' },
  { score: 3, label: '比较不同意' },
  { score: 4, label: '不确定' },
  { score: 5, label: '比较同意' },
  { score: 6, label: '同意' },
  { score: 7, label: '完全同意' },
];

export const PI_QUESTIONS: ReadonlyArray<PiQuestion> = [
  { code: 'PI1', prompt: '我会主动着手处理问题。' },
  { code: 'PI2', prompt: '每当事情出错时，我会立即寻找解决办法。' },
  { code: 'PI3', prompt: '每当有机会主动参与时，我都会抓住它。' },
  { code: 'PI4', prompt: '即使其他人没有行动，我也会立即采取主动。' },
  { code: 'PI5', prompt: '我会迅速利用机会来实现自己的目标。' },
  { code: 'PI6', prompt: '通常，我做的会超过别人对我的要求。' },
  { code: 'PI7', prompt: '我尤其擅长把想法付诸实现。' },
];

export const POMS_SUBSCALE_LABELS: Record<PomsSubscaleKey, string> = {
  tension: '紧张',
  anger: '愤怒',
  fatigue: '疲劳',
  depression: '抑郁',
  vigor: '精力',
  confusion: '慌乱',
  esteem: '自尊',
};

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

export function emptyPomsScores(): Array<PomsItemScore | null> {
  return Array.from({ length: POMS_ITEM_COUNT }, () => null);
}

export function emptyPanasScores(): Array<PanasItemScore | null> {
  return Array.from({ length: PANAS_ITEM_COUNT }, () => null);
}

export function emptyPiScores(): Array<PiItemScore | null> {
  return Array.from({ length: PI_ITEM_COUNT }, () => null);
}

export function emptyHadsScores(): Array<HadsItemScore | null> {
  return Array.from({ length: HADS_ITEM_COUNT }, () => null);
}

export function emptyEmotionDiaryDraft(diaryDate: string): DecisionEmotionDiaryDraft {
  return {
    diary_date: diaryDate,
    event_text: '',
    sam_valence: null,
    sam_arousal: null,
    poms_item_scores: emptyPomsScores(),
    panas_item_scores: emptyPanasScores(),
    pi_item_scores: emptyPiScores(),
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
    poms_item_scores: diary.poms_item_scores.length === POMS_ITEM_COUNT
      ? [...diary.poms_item_scores]
      : emptyPomsScores(),
    panas_item_scores: diary.panas_item_scores.length === PANAS_ITEM_COUNT
      ? [...diary.panas_item_scores]
      : emptyPanasScores(),
    pi_item_scores: diary.pi_item_scores.length === PI_ITEM_COUNT
      ? [...diary.pi_item_scores]
      : emptyPiScores(),
    hads_anxiety_scores: [...diary.hads_anxiety_scores],
    hads_depression_scores: [...diary.hads_depression_scores],
  };
}

export function isPomsItemScore(value: unknown): value is PomsItemScore {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4;
}

export function isCompletePomsScores(
  values: Array<PomsItemScore | null>,
): values is PomsItemScore[] {
  return values.length === POMS_ITEM_COUNT && values.every(isPomsItemScore);
}

export function scorePomsSubscales(values: PomsItemScore[]): PomsSubscaleScores {
  if (!isCompletePomsScores(values)) {
    throw new Error('POMS 必须包含 40 个 0–4 分项目');
  }
  return Object.fromEntries(
    Object.entries(POMS_SUBSCALE_ITEM_NUMBERS).map(([key, itemNumbers]) => [
      key,
      itemNumbers.reduce((sum, itemNumber) => {
        const rawScore = values[itemNumber - 1];
        return sum + (POMS_REVERSE_SCORED_ITEMS.has(itemNumber) ? 4 - rawScore : rawScore);
      }, 0),
    ]),
  ) as PomsSubscaleScores;
}

export function scorePomsTotalMoodDisturbance(scores: PomsSubscaleScores): number {
  return scores.tension
    + scores.anger
    + scores.fatigue
    + scores.depression
    + scores.confusion
    - scores.vigor
    - scores.esteem
    + 100;
}

export function isPanasItemScore(value: unknown): value is PanasItemScore {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

export function isCompletePanasScores(
  values: Array<PanasItemScore | null>,
): values is PanasItemScore[] {
  return values.length === PANAS_ITEM_COUNT && values.every(isPanasItemScore);
}

export function scorePanas(
  values: PanasItemScore[],
): Record<PanasDimension, number> {
  if (!isCompletePanasScores(values)) {
    throw new Error('PANAS 必须包含 20 个 1–5 分项目');
  }
  return PANAS_QUESTIONS.reduce<Record<PanasDimension, number>>(
    (scores, question, index) => {
      scores[question.dimension] += values[index];
      return scores;
    },
    { positive: 0, negative: 0 },
  );
}

export function isPiItemScore(value: unknown): value is PiItemScore {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 7;
}

export function isCompletePiScores(
  values: Array<PiItemScore | null>,
): values is PiItemScore[] {
  return values.length === PI_ITEM_COUNT && values.every(isPiItemScore);
}

export function scorePersonalInitiative(
  values: PiItemScore[],
): { total: number; mean: number } {
  if (!isCompletePiScores(values)) {
    throw new Error('PI-7 必须包含 7 个 1–7 分项目');
  }
  const total = values.reduce<number>((sum, value) => sum + value, 0);
  return {
    total,
    mean: Math.round((total / PI_ITEM_COUNT) * 100) / 100,
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
    poms: isCompletePomsScores(draft.poms_item_scores),
    panas: isCompletePanasScores(draft.panas_item_scores),
    initiative: isCompletePiScores(draft.pi_item_scores),
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
  const persistedPomsComplete = diary.poms_total_mood_disturbance != null
    && diary.poms_tension_score != null
    && diary.poms_anger_score != null
    && diary.poms_fatigue_score != null
    && diary.poms_depression_score != null
    && diary.poms_vigor_score != null
    && diary.poms_confusion_score != null
    && diary.poms_esteem_score != null;
  const canonicalPoms = isCompletePomsScores(diary.poms_item_scores)
    ? scorePomsSubscales(diary.poms_item_scores)
    : null;
  const pomsScores = canonicalPoms ?? (persistedPomsComplete
    ? {
      tension: diary.poms_tension_score!,
      anger: diary.poms_anger_score!,
      fatigue: diary.poms_fatigue_score!,
      depression: diary.poms_depression_score!,
      vigor: diary.poms_vigor_score!,
      confusion: diary.poms_confusion_score!,
      esteem: diary.poms_esteem_score!,
    }
    : null);
  const pomsTotal = canonicalPoms
    ? scorePomsTotalMoodDisturbance(canonicalPoms)
    : diary.poms_total_mood_disturbance;
  const hasPanas = diary.panas_positive_score != null && diary.panas_negative_score != null;
  const canonicalPi = isCompletePiScores(diary.pi_item_scores)
    ? scorePersonalInitiative(diary.pi_item_scores)
    : null;
  const persistedPiValid = diary.pi_total_score != null
    && diary.pi_total_score >= 7
    && diary.pi_total_score <= 49
    && diary.pi_mean_score != null
    && diary.pi_mean_score >= 1
    && diary.pi_mean_score <= 7;
  const piTotal = canonicalPi?.total ?? (persistedPiValid ? diary.pi_total_score : null);
  const piMean = canonicalPi?.mean ?? (persistedPiValid ? diary.pi_mean_score : null);
  return {
    date: diary.diary_date,
    eventText: diary.event_text.trim(),
    pomsTotal: pomsScores && pomsTotal != null ? `${pomsTotal}（TMD）` : null,
    pomsDimensions: pomsScores
      ? [
        `紧张 ${pomsScores.tension}`,
        `愤怒 ${pomsScores.anger}`,
        `疲劳 ${pomsScores.fatigue}`,
        `抑郁 ${pomsScores.depression}`,
        `精力 ${pomsScores.vigor}`,
        `慌乱 ${pomsScores.confusion}`,
        `自尊 ${pomsScores.esteem}`,
      ].join(' · ')
      : null,
    panasPositive: hasPanas ? `${diary.panas_positive_score}/50` : null,
    panasNegative: hasPanas ? `${diary.panas_negative_score}/50` : null,
    personalInitiativeTotal: piTotal == null ? null : `${piTotal}/49`,
    personalInitiativeMean: piMean == null ? null : `${piMean.toFixed(2)}/7`,
    legacyValence: diary.sam_valence == null
      ? null
      : `${diary.sam_valence}/9（${samDescriptor('valence', diary.sam_valence)}）`,
    legacyArousal: diary.sam_arousal == null
      ? null
      : `${diary.sam_arousal}/9（${samDescriptor('arousal', diary.sam_arousal)}）`,
    anxiety: `${diary.hads_anxiety_score}/21（${anxietyBand.label}，${anxietyBand.range}）`,
    depression: `${diary.hads_depression_score}/21（${depressionBand.label}，${depressionBand.range}）`,
  };
}
