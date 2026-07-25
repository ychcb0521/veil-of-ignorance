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
  hadsBand,
  isCompleteHadsScores,
  isEmotionDiaryDraftComplete,
  samDescriptor,
  scoreHadsSubscale,
} from '@/lib/emotionDiary';
import {
  listDecisionEmotionDiaries,
  saveDecisionEmotionDiary,
} from '@/lib/emotionDiaryApi';
import { operationDateKey } from '@/lib/assetReport';
import type {
  DecisionEmotionDiary,
  DecisionEmotionDiaryDraft,
  HadsItemScore,
  SamDimension,
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

function SamScale({
  dimension,
  label,
  lowLabel,
  highLabel,
  value,
  onChange,
}: {
  dimension: SamDimension;
  label: string;
  lowLabel: string;
  highLabel: string;
  value: number | null;
  onChange: (score: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[12px] font-medium">{label}</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {value == null ? '未选择' : `${value}/9 · ${samDescriptor(dimension, value)}`}
        </div>
      </div>
      <div className="grid grid-cols-9 gap-1" role="radiogroup" aria-label={label}>
        {Array.from({ length: 9 }, (_, index) => index + 1).map(score => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            onClick={() => onChange(score)}
            className={`h-8 rounded border text-[11px] font-mono transition-colors ${
              value === score
                ? 'border-[#F0B90B] bg-[#F0B90B] text-black'
                : 'border-border bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground'
            }`}
          >
            {score}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>1 · {lowLabel}</span>
        <span>5 · 中间位置</span>
        <span>9 · {highLabel}</span>
      </div>
    </div>
  );
}

function HadsSubscale({
  code,
  label,
  values,
  onChange,
}: {
  code: 'A' | 'D';
  label: string;
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
          <div className="text-[10px] text-muted-foreground">授权题本计分位 {code}1–{code}7</div>
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
        {values.map((value, index) => (
          <div key={`${code}${index + 1}`} className="h-10 px-3 flex items-center gap-3">
            <div className="w-8 font-mono text-[11px] text-muted-foreground">{code}{index + 1}</div>
            <div className="ml-auto grid w-[176px] grid-cols-4 gap-1" role="radiogroup" aria-label={`${label} ${code}${index + 1}`}>
              {([0, 1, 2, 3] as HadsItemScore[]).map(itemScore => (
                <button
                  key={itemScore}
                  type="button"
                  role="radio"
                  aria-checked={value === itemScore}
                  onClick={() => {
                    const next = [...values];
                    next[index] = itemScore;
                    onChange(next);
                  }}
                  className={`h-7 rounded border text-[10px] font-mono transition-colors ${
                    value === itemScore
                      ? 'border-[#F0B90B] bg-[#F0B90B]/15 text-[#D89B00]'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {itemScore}
                </button>
              ))}
            </div>
          </div>
        ))}
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
          V{diary.sam_valence} · A{diary.sam_arousal}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
        {diary.event_text}
      </div>
      <div className="mt-2 flex gap-1.5 text-[9px] font-mono">
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
      toast.success('决策者情绪日记已保存', {
        description: `HADS-A ${saved.hads_anxiety_score} · HADS-D ${saved.hads_depression_score}`,
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
            <h1 className="text-[14px] font-medium">决策者情绪日记</h1>
            <p className="text-[10px] text-muted-foreground">把交易日的情绪背景留在决策记录旁边</p>
          </div>
          <div className="ml-auto hidden items-center gap-2 text-[10px] text-muted-foreground sm:flex">
            <Activity className="h-3.5 w-3.5" />
            <span>SAM 效价 / 唤醒度 · HADS-A / HADS-D</span>
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
                <h2 className="text-[13px] font-medium">当日情绪状态</h2>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Self-Assessment Manikin（SAM）双维 1–9 评分；两个维度彼此独立。
                </p>
              </div>
              <div className="grid gap-5 p-4 md:grid-cols-2">
                <SamScale
                  dimension="valence"
                  label="情绪效价"
                  lowLabel="非常不愉悦"
                  highLabel="非常愉悦"
                  value={draft.sam_valence}
                  onChange={samValence => setDraft(current => ({ ...current, sam_valence: samValence }))}
                />
                <SamScale
                  dimension="arousal"
                  label="情绪唤醒度"
                  lowLabel="非常平静"
                  highLabel="非常激活"
                  value={draft.sam_arousal}
                  onChange={samArousal => setDraft(current => ({ ...current, sam_arousal: samArousal }))}
                />
              </div>
            </section>

            <section className="border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[13px] font-medium">医院焦虑抑郁量表（HADS-14）</h2>
                    <p className="mt-0.5 max-w-[820px] text-[10px] leading-5 text-muted-foreground">
                      HADS 题目与译文受版权保护。请对照获授权的 14 题题本，把每题经评分键换算后的 0–3 分录入对应位置；系统按焦虑 7 题、抑郁 7 题分别计分。
                    </p>
                  </div>
                  <div className="rounded border border-border bg-background px-2.5 py-1.5 text-[10px] text-muted-foreground">
                    0–7 正常 · 8–10 临界 · 11–21 异常
                  </div>
                </div>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <HadsSubscale
                  code="A"
                  label="焦虑分量表"
                  values={draft.hads_anxiety_scores}
                  onChange={scores => setDraft(current => ({ ...current, hads_anxiety_scores: scores }))}
                />
                <HadsSubscale
                  code="D"
                  label="抑郁分量表"
                  values={draft.hads_depression_scores}
                  onChange={scores => setDraft(current => ({ ...current, hads_depression_scores: scores }))}
                />
              </div>
              <div className="border-t border-border px-4 py-2 text-[10px] leading-5 text-muted-foreground">
                HADS 是筛查工具，不构成临床诊断；两个分量表应分别解释，不合并成一个总分。
              </div>
            </section>

            <div className="sticky bottom-0 z-10 flex items-center gap-3 border border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium">
                  {complete ? '记录完整，可以保存' : '还有内容未完成'}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  事件 {completion.event ? '完成' : '未完成'} · SAM {completion.sam ? '完成' : '未完成'} ·
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
