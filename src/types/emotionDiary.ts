export type HadsItemScore = 0 | 1 | 2 | 3;
export type PomsItemScore = 0 | 1 | 2 | 3 | 4;
export type PanasItemScore = 1 | 2 | 3 | 4 | 5;
export type PiItemScore = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SamDimension = 'valence' | 'arousal';

export interface DecisionEmotionDiary {
  id: string;
  user_id: string;
  diary_date: string;
  event_text: string;
  sam_valence: number | null;
  sam_arousal: number | null;
  poms_item_scores: PomsItemScore[];
  poms_tension_score: number | null;
  poms_anger_score: number | null;
  poms_fatigue_score: number | null;
  poms_depression_score: number | null;
  poms_vigor_score: number | null;
  poms_confusion_score: number | null;
  poms_esteem_score: number | null;
  poms_total_mood_disturbance: number | null;
  panas_item_scores: PanasItemScore[];
  panas_positive_score: number | null;
  panas_negative_score: number | null;
  pi_item_scores: PiItemScore[];
  pi_total_score: number | null;
  pi_mean_score: number | null;
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
  poms_item_scores: Array<PomsItemScore | null>;
  panas_item_scores: Array<PanasItemScore | null>;
  pi_item_scores: Array<PiItemScore | null>;
  hads_anxiety_scores: Array<HadsItemScore | null>;
  hads_depression_scores: Array<HadsItemScore | null>;
}

export interface EmotionDiaryExportSummary {
  date: string;
  eventText: string;
  pomsTotal: string | null;
  pomsDimensions: string | null;
  panasPositive: string | null;
  panasNegative: string | null;
  personalInitiativeTotal: string | null;
  personalInitiativeMean: string | null;
  legacyValence: string | null;
  legacyArousal: string | null;
  anxiety: string;
  depression: string;
}
