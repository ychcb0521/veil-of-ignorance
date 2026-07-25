export type HadsItemScore = 0 | 1 | 2 | 3;

export type SamDimension = 'valence' | 'arousal';

export interface DecisionEmotionDiary {
  id: string;
  user_id: string;
  diary_date: string;
  event_text: string;
  sam_valence: number;
  sam_arousal: number;
  hads_anxiety_scores: HadsItemScore[];
  hads_depression_scores: HadsItemScore[];
  hads_anxiety_score: number;
  hads_depression_score: number;
  measurement_version: string;
  created_at: string;
  updated_at: string;
}

export interface DecisionEmotionDiaryDraft {
  diary_date: string;
  event_text: string;
  sam_valence: number | null;
  sam_arousal: number | null;
  hads_anxiety_scores: Array<HadsItemScore | null>;
  hads_depression_scores: Array<HadsItemScore | null>;
}

export interface EmotionDiaryExportSummary {
  date: string;
  eventText: string;
  valence: string;
  arousal: string;
  anxiety: string;
  depression: string;
}
