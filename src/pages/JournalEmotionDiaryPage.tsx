import { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronLeft, ChevronRight, Save, Waves } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BackButton } from '@/components/journal/BackButton';
import { Button } from '@/components/ui/button';
import { ImeSafeTextarea } from '@/components/ui/ime-safe-text-field';
import { useAuth } from '@/contexts/AuthContext';
import {
  diaryToDraft,
  emotionDiaryCompletion,
  emptyEmotionDiaryDraft,
  HADS_ANXIETY_QUESTIONS,
  HADS_DEPRESSION_QUESTIONS,
  hadsBand,
  isCompleteHadsScores,
  isCompletePanasScores,
  isCompletePiScores,
  isCompletePomsScores,
  isEmotionDiaryDraftComplete,
  PANAS_QUESTIONS,
  PANAS_RESPONSE_OPTIONS,
  PI_QUESTIONS,
  PI_RESPONSE_OPTIONS,
  POMS_QUESTIONS,
  POMS_RESPONSE_OPTIONS,
  POMS_SUBSCALE_LABELS,
  scoreHadsSubscale,
  scorePanas,
  scorePersonalInitiative,
  scorePomsSubscales,
  scorePomsTotalMoodDisturbance,
} from '@/lib/emotionDiary';
import type { HadsQuestion, PomsSubscaleKey } from '@/lib/emotionDiary';
import {
  listDecisionEmotionDiaries,
  saveDecisionEmotionDiary,
} from '@/lib/emotionDiaryApi';
import { operationDateKey } from '@/lib/assetReport';
import type {
  DecisionEmotionDiary,
  DecisionEmotionDiaryDraft,
  HadsItemScore,
  PanasItemScore,
  PiItemScore,
  PomsItemScore,
} from '@/types/emotionDiary';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function todayKey(): string {
  return operationDateKey(Date.now()) ?? new Date().toISOString().slice(0, 10);
}

function shiftDate(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

function bandClass(key: ReturnType<typeof hadsBand>['key']): string {
  if (key === 'normal') return 'text-[#0ECB81] bg-[#0ECB81]/8 border-[#0ECB81]/20';
  if (key === 'borderline') return 'text-[#D89B00] bg-[#F0B90B]/8 border-[#F0B90B]/25';
  return 'text-[#F6465D] bg-[#F6465D]/8 border-[#F6465D]/20';
}

function PomsScale({
  values,
  onChange,
}: {
  values: Array<PomsItemScore | null>;
  onChange: (next: Array<PomsItemScore | null>) => void;
}) {
  const complete = isCompletePomsScores(values);
  const scores = complete ? scorePomsSubscales(values) : null;
  const tmd = scores ? scorePomsTotalMoodDisturbance(scores) : null;
  const subscaleOrder: PomsSubscaleKey[] = [
    'tension',
    'anger',
    'fatigue',
    'depression',
    'vigor',
    'confusion',
    'esteem',
  ];

  return (
    <div className="border border-border rounded">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <div className="text-[12px] font-medium">POMS-40 逐题记录</div>
          <div className="text-[10px] text-muted-foreground">
            今天截至填写此刻 · 40 项 · 0–4 分
          </div>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {complete ? `40/40 · TMD ${tmd}` : `${values.filter(value => value != null).length}/40`}
        </div>
      </div>
      {scores && (
        <div className="grid grid-cols-2 border-b border-border bg-muted/25 sm:grid-cols-4 lg:grid-cols-8">
          {subscaleOrder.map(key => (
            <div key={key} className="border-b border-r border-border/70 px-2.5 py-2 last:border-r-0 sm:border-b-0">
              <div className="text-[9px] text-muted-foreground">{POMS_SUBSCALE_LABELS[key]}</div>
              <div className="mt-0.5 font-mono text-[12px] font-medium">{scores[key]}</div>
            </div>
          ))}
          <div className="px-2.5 py-2">
            <div className="text-[9px] text-muted-foreground">总心境扰乱 TMD</div>
            <div className="mt-0.5 font-mono text-[12px] font-medium text-[#D89B00]">{tmd}</div>
          </div>
        </div>
      )}
      <div className="divide-y divide-border/70">
        {POMS_QUESTIONS.map((question, index) => {
          const value = values[index];
          return (
            <div
              key={question.code}
              className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(160px,0.8fr)_minmax(460px,2fr)] md:items-center"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {question.code}
                </span>
                <span className="text-[11px] text-foreground">{question.term}</span>
                <span className="ml-auto hidden text-[9px] text-muted-foreground lg:inline">
                  {POMS_SUBSCALE_LABELS[question.subscale]}
                  {question.reverseScored ? ' · 反向计分' : ''}
                </span>
              </div>
              <div
                className="grid grid-cols-5 gap-1.5"
                role="radiogroup"
                aria-label={`POMS ${question.code} ${question.term}`}
              >
                {POMS_RESPONSE_OPTIONS.map(option => (
                  <button
                    key={option.score}
                    type="button"
                    role="radio"
                    aria-checked={value === option.score}
                    onClick={() => {
                      const next = [...values];
                      next[index] = option.score;
                      onChange(next);
                    }}
                    className={`min-h-8 rounded border px-1.5 py-1 text-center transition-colors ${
                      value === option.score
                        ? 'border-[#F0B90B] bg-[#F0B90B]/12 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                    }`}
                  >
                    <span className="block font-mono text-[10px]">{option.score}</span>
                    <span className="hidden text-[9px] leading-3 sm:block">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PanasScale({
  values,
  onChange,
}: {
  values: Array<PanasItemScore | null>;
  onChange: (next: Array<PanasItemScore | null>) => void;
}) {
  const complete = isCompletePanasScores(values);
  const scores = complete ? scorePanas(values) : null;

  return (
    <div className="border border-border rounded">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <div className="text-[12px] font-medium">PANAS-20 逐题记录</div>
          <div className="text-[10px] text-muted-foreground">
            今天截至填写此刻 · 20 项 · 1–5 分
          </div>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {complete
            ? `20/20 · PA ${scores?.positive}/50 · NA ${scores?.negative}/50`
            : `${values.filter(value => value != null).length}/20`}
        </div>
      </div>
      {scores && (
        <div className="grid grid-cols-2 border-b border-border bg-muted/25">
          <div className="border-r border-border/70 px-3 py-2">
            <div className="text-[9px] text-muted-foreground">正性情感 PA</div>
            <div className="mt-0.5 font-mono text-[12px] font-medium text-[#0ECB81]">
              {scores.positive}/50
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] text-muted-foreground">负性情感 NA</div>
            <div className="mt-0.5 font-mono text-[12px] font-medium text-[#F6465D]">
              {scores.negative}/50
            </div>
          </div>
        </div>
      )}
      <div className="divide-y divide-border/70">
        {PANAS_QUESTIONS.map((question, index) => {
          const value = values[index];
          return (
            <div
              key={question.code}
              className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(160px,0.8fr)_minmax(460px,2fr)] md:items-center"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {question.code}
                </span>
                <span className="text-[11px] text-foreground">{question.term}</span>
                <span className="ml-auto hidden text-[9px] text-muted-foreground lg:inline">
                  {question.dimension === 'positive' ? '正性' : '负性'}
                </span>
              </div>
              <div
                className="grid grid-cols-5 gap-1.5"
                role="radiogroup"
                aria-label={`PANAS ${question.code} ${question.term}`}
              >
                {PANAS_RESPONSE_OPTIONS.map(option => (
                  <button
                    key={option.score}
                    type="button"
                    role="radio"
                    aria-checked={value === option.score}
                    onClick={() => {
                      const next = [...values];
                      next[index] = option.score;
                      onChange(next);
                    }}
                    className={`min-h-8 rounded border px-1.5 py-1 text-center transition-colors ${
                      value === option.score
                        ? 'border-[#F0B90B] bg-[#F0B90B]/12 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                    }`}
                  >
                    <span className="block font-mono text-[10px]">{option.score}</span>
                    <span className="hidden text-[9px] leading-3 sm:block">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PersonalInitiativeScale({
  values,
  onChange,
}: {
  values: Array<PiItemScore | null>;
  onChange: (next: Array<PiItemScore | null>) => void;
}) {
  const complete = isCompletePiScores(values);
  const score = complete ? scorePersonalInitiative(values) : null;

  return (
    <div className="rounded border border-border">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <div className="text-[12px] font-medium">PI-7 逐题记录</div>
          <div className="text-[10px] text-muted-foreground">
            今天截至填写此刻 · 7 项 · 1–7 分
          </div>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {score
            ? `7/7 · 总分 ${score.total}/49 · 均分 ${score.mean.toFixed(2)}/7`
            : `${values.filter(value => value != null).length}/7`}
        </div>
      </div>
      {score && (
        <div className="grid grid-cols-2 border-b border-border bg-muted/25">
          <div className="border-r border-border/70 px-3 py-2">
            <div className="text-[9px] text-muted-foreground">个人主动性总分</div>
            <div className="mt-0.5 font-mono text-[12px] font-medium text-[#D89B00]">
              {score.total}/49
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] text-muted-foreground">题目均分</div>
            <div className="mt-0.5 font-mono text-[12px] font-medium text-[#D89B00]">
              {score.mean.toFixed(2)}/7
            </div>
          </div>
        </div>
      )}
      <div className="divide-y divide-border/70">
        {PI_QUESTIONS.map((question, index) => {
          const value = values[index];
          return (
            <div
              key={question.code}
              className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(250px,1fr)_minmax(560px,1.7fr)] md:items-center"
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {question.code}
                </span>
                <span className="text-[11px] leading-5 text-foreground">{question.prompt}</span>
              </div>
              <div
                className="grid grid-cols-7 gap-1.5"
                role="radiogroup"
                aria-label={`PI-7 ${question.code}：${question.prompt}`}
              >
                {PI_RESPONSE_OPTIONS.map(option => (
                  <button
                    key={option.score}
                    type="button"
                    role="radio"
                    aria-checked={value === option.score}
                    title={`${option.score} · ${option.label}`}
                    onClick={() => {
                      const next = [...values];
                      next[index] = option.score;
                      onChange(next);
                    }}
                    className={`min-h-8 rounded border px-1 py-1 text-center transition-colors ${
                      value === option.score
                        ? 'border-[#F0B90B] bg-[#F0B90B]/12 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                    }`}
                  >
                    <span className="block font-mono text-[10px]">{option.score}</span>
                    <span className="hidden text-[8px] leading-3 xl:block">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HadsSubscale({
  label,
  questions,
  values,
  onChange,
}: {
  label: string;
  questions: ReadonlyArray<HadsQuestion>;
  values: Array<HadsItemScore | null>;
  onChange: (next: Array<HadsItemScore | null>) => void;
}) {
  const complete = isCompleteHadsScores(values);
  const score = complete ? scoreHadsSubscale(values) : null;
  const band = score == null ? null : hadsBand(score);

  return (
    <div className="border border-border rounded">
      <div className="h-11 px-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium">{label}</div>
          <div className="text-[10px] text-muted-foreground">过去一周 · 7 道题 · 每题选择一项</div>
        </div>
        {band ? (
          <div className={`rounded border px-2 py-1 text-[10px] font-mono ${bandClass(band.key)}`}>
            {score}/21 · {band.label}
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground">
            {values.filter(value => value != null).length}/7
          </div>
        )}
      </div>
      <div className="divide-y divide-border/70">
        {questions.map((question, index) => {
          const value = values[index];
          return (
            <div key={question.code} className="space-y-2.5 px-3 py-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {question.code}
                </span>
                <p className="text-[11px] leading-5 text-foreground">{question.prompt}</p>
              </div>
              <div
                className="grid gap-1.5 sm:grid-cols-2"
                role="radiogroup"
                aria-label={`${label} ${question.code}：${question.prompt}`}
              >
                {question.options.map(option => (
                  <button
                    key={option.score}
                    type="button"
                    role="radio"
                    aria-checked={value === option.score}
                    onClick={() => {
                      const next = [...values];
                      next[index] = option.score;
                      onChange(next);
                    }}
                    className={`flex min-h-8 items-center gap-2 rounded border px-2 py-1.5 text-left text-[10px] leading-4 transition-colors ${
                      value === option.score
                        ? 'border-[#F0B90B] bg-[#F0B90B]/12 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                    }`}
                  >
                    <span className={`font-mono ${
                      value === option.score ? 'text-[#D89B00]' : 'text-muted-foreground/70'
                    }`}>
                      {option.score}
                    </span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiaryHistoryItem({
  diary,
  active,
  onSelect,
}: {
  diary: DecisionEmotionDiary;
  active: boolean;
  onSelect: () => void;
}) {
  const anxietyBand = hadsBand(diary.hads_anxiety_score);
  const depressionBand = hadsBand(diary.hads_depression_score);
  const hasCurrentMeasures = diary.poms_total_mood_disturbance != null
    && diary.panas_positive_score != null
    && diary.panas_negative_score != null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-b border-border px-3 py-3 text-left transition-colors last:border-b-0 ${
        active ? 'bg-[#F0B90B]/7' : 'hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium">{dateLabel(diary.diary_date)}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {hasCurrentMeasures
            ? `TMD ${diary.poms_total_mood_disturbance} · PA ${diary.panas_positive_score} · NA ${diary.panas_negative_score}`
            : `历史 SAM · V${diary.sam_valence ?? '—'} · A${diary.sam_arousal ?? '—'}`}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
        {diary.event_text}
      </div>
      <div className="mt-2 flex gap-1.5 text-[9px] font-mono">
        {diary.pi_total_score != null && diary.pi_mean_score != null && (
          <span className="rounded border border-[#F0B90B]/25 bg-[#F0B90B]/8 px-1.5 py-0.5 text-[#D89B00]">
            PI {diary.pi_total_score}/49 · {diary.pi_mean_score.toFixed(2)}/7
          </span>
        )}
        <span className={`rounded border px-1.5 py-0.5 ${bandClass(anxietyBand.key)}`}>
          焦虑 {diary.hads_anxiety_score}
        </span>
        <span className={`rounded border px-1.5 py-0.5 ${bandClass(depressionBand.key)}`}>
          抑郁 {diary.hads_depression_score}
        </span>
      </div>
    </button>
  );
}

export default function JournalEmotionDiaryPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryDate = searchParams.get('date');
  const initialDate = queryDate && DATE_PATTERN.test(queryDate) ? queryDate : todayKey();
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [diaries, setDiaries] = useState<DecisionEmotionDiary[]>([]);
  const [draft, setDraft] = useState<DecisionEmotionDiaryDraft>(() => emptyEmotionDiaryDraft(initialDate));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const completion = useMemo(() => emotionDiaryCompletion(draft), [draft]);
  const complete = useMemo(() => isEmotionDiaryDraftComplete(draft), [draft]);
  const anxietyScore = isCompleteHadsScores(draft.hads_anxiety_scores)
    ? scoreHadsSubscale(draft.hads_anxiety_scores)
    : null;
  const depressionScore = isCompleteHadsScores(draft.hads_depression_scores)
    ? scoreHadsSubscale(draft.hads_depression_scores)
    : null;
  const pomsScores = isCompletePomsScores(draft.poms_item_scores)
    ? scorePomsSubscales(draft.poms_item_scores)
    : null;
  const pomsTmd = pomsScores ? scorePomsTotalMoodDisturbance(pomsScores) : null;
  const panasScores = isCompletePanasScores(draft.panas_item_scores)
    ? scorePanas(draft.panas_item_scores)
    : null;
  const initiativeScore = isCompletePiScores(draft.pi_item_scores)
    ? scorePersonalInitiative(draft.pi_item_scores)
    : null;

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true);
    listDecisionEmotionDiaries(user.id)
      .then(rows => {
        if (cancelled) return;
        setDiaries(rows);
        setDraft(current => {
          const existing = rows.find(item => item.diary_date === current.diary_date);
          return existing ? diaryToDraft(existing) : current;
        });
      })
      .catch(error => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const selectDate = (date: string) => {
    setSelectedDate(date);
    setSearchParams({ date }, { replace: true });
    const existing = diaries.find(item => item.diary_date === date);
    setDraft(existing ? diaryToDraft(existing) : emptyEmotionDiaryDraft(date));
  };

  const handleSave = async () => {
    if (!user?.id) return;
    try {
      setSaving(true);
      const saved = await saveDecisionEmotionDiary(user.id, draft);
      setDiaries(current => (
        [saved, ...current.filter(item => item.diary_date !== saved.diary_date)]
          .sort((a, b) => b.diary_date.localeCompare(a.diary_date))
      ));
      setDraft(diaryToDraft(saved));
      toast.success('情绪日记已保存', {
        description: [
          `POMS TMD ${saved.poms_total_mood_disturbance}`,
          `PANAS PA ${saved.panas_positive_score}`,
          `NA ${saved.panas_negative_score}`,
          `PI ${saved.pi_total_score}/49`,
          `HADS-A ${saved.hads_anxiety_score}`,
          `HADS-D ${saved.hads_depression_score}`,
        ].join(' · '),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-6 py-3">
          <BackButton />
          <div>
            <h1 className="text-[14px] font-medium">情绪日记</h1>
            <p className="text-[10px] text-muted-foreground">把交易日的情绪背景留在决策记录旁边</p>
          </div>
          <div className="ml-auto hidden items-center gap-2 text-[10px] text-muted-foreground sm:flex">
            <Activity className="h-3.5 w-3.5" />
            <span>POMS-40 · PANAS-20 · PI-7 · HADS-14</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-4">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-y border-border bg-card/50 px-3 py-2">
          <button
            type="button"
            title="前一天"
            onClick={() => selectDate(shiftDate(selectedDate, -1))}
            className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <label className="flex h-8 items-center gap-2 rounded border border-border bg-background px-2">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="date"
              max={todayKey()}
              value={selectedDate}
              onChange={event => selectDate(event.target.value)}
              className="bg-transparent font-mono text-[11px] outline-none"
            />
          </label>
          <button
            type="button"
            title="后一天"
            disabled={selectedDate >= todayKey()}
            onClick={() => selectDate(shiftDate(selectedDate, 1))}
            className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => selectDate(todayKey())}
            className="h-8 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            今天
          </button>
          <div className="ml-auto text-[11px] text-muted-foreground">{dateLabel(selectedDate)}</div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <section className="border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Waves className="h-4 w-4 text-[#F0B90B]" />
                <div>
                  <h2 className="text-[13px] font-medium">最近起波澜的事情</h2>
                  <p className="text-[10px] text-muted-foreground">记录事实、触发点、身体反应和仍在脑内回响的部分</p>
                </div>
                <span className={`ml-auto text-[10px] ${completion.event ? 'text-[#0ECB81]' : 'text-muted-foreground'}`}>
                  {completion.event ? '已记录' : '待记录'}
                </span>
              </div>
              <div className="p-4">
                <ImeSafeTextarea
                  value={draft.event_text}
                  onValueChange={eventText => setDraft(current => ({ ...current, event_text: eventText }))}
                  placeholder="今天什么事情让你的内心起了波澜？它如何影响了你的判断、注意力和行动冲动？"
                  className="min-h-[150px] resize-y border-border bg-background text-[12px] leading-6"
                />
              </div>
            </section>

            <section className="border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[13px] font-medium">心境状态量表（POMS-40）</h2>
                    <p className="mt-0.5 max-w-[900px] text-[10px] leading-5 text-muted-foreground">
                      按原题序记录今天截至填写此刻的主观感受。七个分量表分别求和；
                      总心境扰乱 TMD = 紧张 + 愤怒 + 疲劳 + 抑郁 + 慌乱 − 精力 − 自尊 + 100。
                      自尊维度的 P7“为难的”按 4 − 原分反向计分。
                    </p>
                  </div>
                  <div className="rounded border border-border bg-background px-2.5 py-1.5 text-[10px] text-muted-foreground">
                    0 几乎没有 · 4 非常强烈
                  </div>
                </div>
              </div>
              <div className="p-4">
                <PomsScale
                  values={draft.poms_item_scores}
                  onChange={scores => setDraft(current => ({ ...current, poms_item_scores: scores }))}
                />
              </div>
              <div className="border-t border-border px-4 py-2 text-[10px] leading-5 text-muted-foreground">
                POMS 原始分用于同一时间框架下的纵向比较；没有统一临床诊断界值。正式研究或临床使用应采用获授权版本及其常模。
              </div>
            </section>

            <section className="border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[13px] font-medium">正负情感量表（PANAS-20）</h2>
                    <p className="mt-0.5 max-w-[900px] text-[10px] leading-5 text-muted-foreground">
                      正性情感 10 项与负性情感 10 项分别求和，均为 10–50 分；
                      两个维度独立解释，不反向计分，也不合并为一个总分。
                    </p>
                  </div>
                  <div className="rounded border border-border bg-background px-2.5 py-1.5 text-[10px] text-muted-foreground">
                    1 几乎没有 · 5 非常强烈
                  </div>
                </div>
              </div>
              <div className="p-4">
                <PanasScale
                  values={draft.panas_item_scores}
                  onChange={scores => setDraft(current => ({ ...current, panas_item_scores: scores }))}
                />
              </div>
              <div className="border-t border-border px-4 py-2 text-[10px] leading-5 text-muted-foreground">
                PANAS 分数用于观察正性与负性情感的相对强度及长期变化，不设统一临床诊断区间。
              </div>
            </section>

            <section className="border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[13px] font-medium">
                      个人主动性量表（Personal Initiative Scale，PI-7）
                    </h2>
                    <p className="mt-0.5 max-w-[900px] text-[10px] leading-5 text-muted-foreground">
                      请根据今天截至填写此刻的真实表现，判断你对每项陈述的同意程度。
                      七题均为正向计分，总分 7–49，题目均分 1.00–7.00；分数越高，表示自评的个人主动性越强。
                    </p>
                  </div>
                  <div className="rounded border border-border bg-background px-2.5 py-1.5 text-[10px] text-muted-foreground">
                    1 完全不同意 · 7 完全同意
                  </div>
                </div>
              </div>
              <div className="p-4">
                <PersonalInitiativeScale
                  values={draft.pi_item_scores}
                  onChange={scores => setDraft(current => ({ ...current, pi_item_scores: scores }))}
                />
              </div>
              <div className="border-t border-border px-4 py-2 text-[10px] leading-5 text-muted-foreground">
                PI-7 原量表衡量一般性的个人主动性；这里保留原题项并用于每日纵向观察。
                量表没有公认的临床分界，也不用于诊断；正式研究应使用经授权、验证的本地化版本。
              </div>
            </section>

            <section className="border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[13px] font-medium">医院焦虑抑郁量表（HADS-14）</h2>
                    <p className="mt-0.5 max-w-[820px] text-[10px] leading-5 text-muted-foreground">
                      请根据过去一周的真实状态直接完成以下 14 题。题目是按 HADS
                      症状维度撰写的中文作答提示，并非授权标准译本；系统按焦虑 7 题、抑郁 7
                      题分别计分。
                    </p>
                  </div>
                  <div className="rounded border border-border bg-background px-2.5 py-1.5 text-[10px] text-muted-foreground">
                    0–7 正常 · 8–10 临界 · 11–21 异常
                  </div>
                </div>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <HadsSubscale
                  label="焦虑分量表"
                  questions={HADS_ANXIETY_QUESTIONS}
                  values={draft.hads_anxiety_scores}
                  onChange={scores => setDraft(current => ({ ...current, hads_anxiety_scores: scores }))}
                />
                <HadsSubscale
                  label="抑郁分量表"
                  questions={HADS_DEPRESSION_QUESTIONS}
                  values={draft.hads_depression_scores}
                  onChange={scores => setDraft(current => ({ ...current, hads_depression_scores: scores }))}
                />
              </div>
              <div className="border-t border-border px-4 py-2 text-[10px] leading-5 text-muted-foreground">
                HADS 是筛查工具，不构成临床诊断；两个分量表应分别解释，不合并成一个总分。正式临床或研究使用应采用获授权的标准版本。
              </div>
            </section>

            <div className="sticky bottom-0 z-10 flex items-center gap-3 border border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium">
                  {complete ? '记录完整，可以保存' : '还有内容未完成'}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  事件 {completion.event ? '完成' : '未完成'} ·
                  POMS {pomsTmd == null ? '未完成' : `TMD ${pomsTmd}`} ·
                  PANAS {panasScores == null ? '未完成' : `PA ${panasScores.positive} / NA ${panasScores.negative}`} ·
                  PI-7 {initiativeScore == null
                    ? '未完成'
                    : `${initiativeScore.total}/49 / ${initiativeScore.mean.toFixed(2)}/7`} ·
                  HADS-A {anxietyScore == null ? '未完成' : `${anxietyScore}/21`} ·
                  HADS-D {depressionScore == null ? '未完成' : `${depressionScore}/21`}
                </div>
              </div>
              <Button
                type="button"
                disabled={!complete || saving}
                onClick={handleSave}
                className="h-9 gap-1.5 bg-[#F0B90B] px-4 text-[12px] text-black hover:bg-[#F0B90B]/90"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? '保存中' : '保存日记'}
              </Button>
            </div>
          </div>

          <aside className="h-fit border border-border bg-card lg:sticky lg:top-[72px]">
            <div className="border-b border-border px-3 py-3">
              <div className="text-[12px] font-medium">历史记录</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                共 {diaries.length} 天 · 每个自然日一份
              </div>
            </div>
            {loading ? (
              <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">加载中…</div>
            ) : diaries.length === 0 ? (
              <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">还没有情绪日记</div>
            ) : (
              <div className="max-h-[calc(100vh-160px)] overflow-y-auto">
                {diaries.map(diary => (
                  <DiaryHistoryItem
                    key={diary.id}
                    diary={diary}
                    active={selectedDate === diary.diary_date}
                    onSelect={() => selectDate(diary.diary_date)}
                  />
                ))}
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
