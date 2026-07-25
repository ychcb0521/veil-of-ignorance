import { supabase } from '@/integrations/supabase/client';
import {
  EMOTION_DIARY_MEASUREMENT_VERSION,
  isCompleteHadsScores,
  scoreHadsSubscale,
} from '@/lib/emotionDiary';
import type {
  DecisionEmotionDiary,
  DecisionEmotionDiaryDraft,
  HadsItemScore,
} from '@/types/emotionDiary';

const STORAGE_VERSION = 'decision_emotion_diaries_v1';

type EmotionDiaryRow = {
  id: string;
  user_id: string;
  diary_date: string;
  event_text: string;
  sam_valence: number;
  sam_arousal: number;
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
  if (draft.sam_valence == null || draft.sam_arousal == null) {
    throw new Error('请完成情绪效价与唤醒度评分');
  }
  if (!isCompleteHadsScores(draft.hads_anxiety_scores)
    || !isCompleteHadsScores(draft.hads_depression_scores)) {
    throw new Error('请完成焦虑与抑郁自评的全部 14 道题目');
  }

  const now = new Date().toISOString();
  const existing = readLocal(userId).find(item => item.diary_date === draft.diary_date);
  const row: EmotionDiaryRow = {
    id: existing?.id ?? crypto.randomUUID(),
    user_id: userId,
    diary_date: draft.diary_date,
    event_text: eventText,
    sam_valence: draft.sam_valence,
    sam_arousal: draft.sam_arousal,
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
