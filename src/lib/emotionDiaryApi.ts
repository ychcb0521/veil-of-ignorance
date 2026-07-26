import { supabase } from '@/integrations/supabase/client';
import {
  EMOTION_DIARY_MEASUREMENT_VERSION,
  isCompleteHadsScores,
  isCompletePanasScores,
  isCompletePomsScores,
  scoreHadsSubscale,
  scorePanas,
  scorePomsSubscales,
  scorePomsTotalMoodDisturbance,
} from '@/lib/emotionDiary';
import type {
  DecisionEmotionDiary,
  DecisionEmotionDiaryDraft,
  HadsItemScore,
  PanasItemScore,
  PomsItemScore,
} from '@/types/emotionDiary';

const STORAGE_VERSION = 'decision_emotion_diaries_v1';

type EmotionDiaryRow = {
  id: string;
  user_id: string;
  diary_date: string;
  event_text: string;
  sam_valence: number | null;
  sam_arousal: number | null;
  poms_item_scores?: number[] | null;
  poms_tension_score?: number | null;
  poms_anger_score?: number | null;
  poms_fatigue_score?: number | null;
  poms_depression_score?: number | null;
  poms_vigor_score?: number | null;
  poms_confusion_score?: number | null;
  poms_esteem_score?: number | null;
  poms_total_mood_disturbance?: number | null;
  panas_item_scores?: number[] | null;
  panas_positive_score?: number | null;
  panas_negative_score?: number | null;
  hads_anxiety_scores: number[];
  hads_depression_scores: number[];
  hads_anxiety_score: number;
  hads_depression_score: number;
  measurement_version: string;
  created_at: string;
  updated_at: string;
};

function storageKey(userId: string): string {
  return `${STORAGE_VERSION}:${userId}`;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? '';
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || (message.includes('decision_emotion_diaries')
      && (message.includes('schema cache') || message.includes('does not exist')));
}

function toDiary(row: EmotionDiaryRow): DecisionEmotionDiary {
  return {
    ...row,
    sam_valence: row.sam_valence ?? null,
    sam_arousal: row.sam_arousal ?? null,
    poms_item_scores: Array.isArray(row.poms_item_scores)
      ? row.poms_item_scores as PomsItemScore[]
      : [],
    poms_tension_score: row.poms_tension_score ?? null,
    poms_anger_score: row.poms_anger_score ?? null,
    poms_fatigue_score: row.poms_fatigue_score ?? null,
    poms_depression_score: row.poms_depression_score ?? null,
    poms_vigor_score: row.poms_vigor_score ?? null,
    poms_confusion_score: row.poms_confusion_score ?? null,
    poms_esteem_score: row.poms_esteem_score ?? null,
    poms_total_mood_disturbance: row.poms_total_mood_disturbance ?? null,
    panas_item_scores: Array.isArray(row.panas_item_scores)
      ? row.panas_item_scores as PanasItemScore[]
      : [],
    panas_positive_score: row.panas_positive_score ?? null,
    panas_negative_score: row.panas_negative_score ?? null,
    hads_anxiety_scores: row.hads_anxiety_scores as HadsItemScore[],
    hads_depression_scores: row.hads_depression_scores as HadsItemScore[],
  };
}

function readLocal(userId: string): DecisionEmotionDiary[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is EmotionDiaryRow => (
        item != null
        && typeof item === 'object'
        && typeof item.id === 'string'
        && item.user_id === userId
        && typeof item.diary_date === 'string'
      ))
      .map(toDiary)
      .sort((a, b) => b.diary_date.localeCompare(a.diary_date));
  } catch {
    return [];
  }
}

function writeLocal(userId: string, diaries: DecisionEmotionDiary[]): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(diaries));
  } catch (error) {
    console.warn('[emotionDiaryApi] 本地镜像写入失败', error);
  }
}

function upsertLocal(userId: string, diary: DecisionEmotionDiary): void {
  const next = readLocal(userId).filter(item => item.diary_date !== diary.diary_date);
  next.push(diary);
  next.sort((a, b) => b.diary_date.localeCompare(a.diary_date));
  writeLocal(userId, next);
}

function mergeDiaries(
  remote: DecisionEmotionDiary[],
  local: DecisionEmotionDiary[],
): DecisionEmotionDiary[] {
  const byDate = new Map<string, DecisionEmotionDiary>();
  for (const diary of [...remote, ...local]) {
    const current = byDate.get(diary.diary_date);
    if (!current || diary.updated_at > current.updated_at) byDate.set(diary.diary_date, diary);
  }
  return [...byDate.values()].sort((a, b) => b.diary_date.localeCompare(a.diary_date));
}

export async function listDecisionEmotionDiaries(
  userId: string,
): Promise<DecisionEmotionDiary[]> {
  const local = readLocal(userId);
  const { data, error } = await supabase
    .from('decision_emotion_diaries')
    .select('*')
    .eq('user_id', userId)
    .order('diary_date', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return local;
    throw new Error(`读取情绪日记失败：${error.message}`);
  }

  const merged = mergeDiaries(
    ((data ?? []) as EmotionDiaryRow[]).map(toDiary),
    local,
  );
  writeLocal(userId, merged);
  return merged;
}

export async function getDecisionEmotionDiaryByDate(
  userId: string,
  diaryDate: string,
): Promise<DecisionEmotionDiary | null> {
  const diaries = await listDecisionEmotionDiaries(userId);
  return diaries.find(item => item.diary_date === diaryDate) ?? null;
}

export async function saveDecisionEmotionDiary(
  userId: string,
  draft: DecisionEmotionDiaryDraft,
): Promise<DecisionEmotionDiary> {
  const eventText = draft.event_text.trim();
  if (!eventText) throw new Error('请先记录最近让内心起波澜的事情');
  if (!isCompletePomsScores(draft.poms_item_scores)) {
    throw new Error('请完成心境状态量表 POMS 的全部 40 道题目');
  }
  if (!isCompletePanasScores(draft.panas_item_scores)) {
    throw new Error('请完成正负情感量表 PANAS 的全部 20 道题目');
  }
  if (!isCompleteHadsScores(draft.hads_anxiety_scores)
    || !isCompleteHadsScores(draft.hads_depression_scores)) {
    throw new Error('请完成焦虑与抑郁自评的全部 14 道题目');
  }

  const poms = scorePomsSubscales(draft.poms_item_scores);
  const panas = scorePanas(draft.panas_item_scores);
  const now = new Date().toISOString();
  const existing = readLocal(userId).find(item => item.diary_date === draft.diary_date);
  const row: EmotionDiaryRow = {
    id: existing?.id ?? crypto.randomUUID(),
    user_id: userId,
    diary_date: draft.diary_date,
    event_text: eventText,
    sam_valence: draft.sam_valence,
    sam_arousal: draft.sam_arousal,
    poms_item_scores: [...draft.poms_item_scores],
    poms_tension_score: poms.tension,
    poms_anger_score: poms.anger,
    poms_fatigue_score: poms.fatigue,
    poms_depression_score: poms.depression,
    poms_vigor_score: poms.vigor,
    poms_confusion_score: poms.confusion,
    poms_esteem_score: poms.esteem,
    poms_total_mood_disturbance: scorePomsTotalMoodDisturbance(poms),
    panas_item_scores: [...draft.panas_item_scores],
    panas_positive_score: panas.positive,
    panas_negative_score: panas.negative,
    hads_anxiety_scores: [...draft.hads_anxiety_scores],
    hads_depression_scores: [...draft.hads_depression_scores],
    hads_anxiety_score: scoreHadsSubscale(draft.hads_anxiety_scores),
    hads_depression_score: scoreHadsSubscale(draft.hads_depression_scores),
    measurement_version: EMOTION_DIARY_MEASUREMENT_VERSION,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  const localDiary = toDiary(row);
  upsertLocal(userId, localDiary);

  const { data, error } = await supabase
    .from('decision_emotion_diaries')
    .upsert(row, { onConflict: 'user_id,diary_date' })
    .select('*')
    .single();

  if (error) {
    if (isMissingTableError(error)) return localDiary;
    throw new Error(`保存情绪日记失败：${error.message}`);
  }

  const saved = toDiary(data as EmotionDiaryRow);
  upsertLocal(userId, saved);
  return saved;
}
