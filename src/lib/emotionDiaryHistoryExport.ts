/**
 * 情绪日记的历史导出：当日一份、选定区间、或全部。
 *
 * 两种格式：
 *   TXT —— 逐日逐题的完整记录，给人读、给存档用（沿用战役里那份情绪日记 TXT 的块状排版）。
 *   CSV —— 每个自然日一行，总分在前、逐题原始作答在后（P1–P40 / N1–N20 / PI1–PI7 / A1–A7 / D1–D7），
 *          可以直接丢进统计软件做纵向分析，也能按原始作答重新计分。
 *
 * 所有派生值一律走 buildEmotionDiaryExportSummary：它以**逐题作答**为准、只有在缺作答时才回退到
 * 落库的汇总列。历史上有一批行的汇总列停留在旧的计分口径（P7 反向计分修正之前），
 * 直接读汇总列会把当年的错数导出来。
 */
import {
  EMOTION_DIARY_MEASUREMENT_VERSION,
  HADS_ANXIETY_QUESTIONS,
  HADS_DEPRESSION_QUESTIONS,
  PANAS_QUESTIONS,
  PI_QUESTIONS,
  POMS_QUESTIONS,
  POMS_SUBSCALE_LABELS,
  buildEmotionDiaryExportSummary,
} from '@/lib/emotionDiary';
import { downloadTextFile, safeExportFileName } from '@/lib/downloadTextFile';
import type { DecisionEmotionDiary } from '@/types/emotionDiary';

export type EmotionDiaryExportScope = 'day' | 'range' | 'all';
export type EmotionDiaryExportFormat = 'txt' | 'csv';

export interface EmotionDiaryExportSelection {
  scope: EmotionDiaryExportScope;
  /** scope = 'day' 时的那一天（YYYY-MM-DD，UTC+8 自然日）。 */
  date?: string;
  /** scope = 'range' 时的起止日，含两端。 */
  from?: string;
  to?: string;
}

/** 自然日按 UTC+8 划分（与 emotionDiaryApi、页面完全一致）：在日期键上加减天数。 */
export function shiftDiaryDate(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 日期键一律是定长 YYYY-MM-DD，字典序即时间序——与 emotionDiaryApi 的排序同一口径。 */
function inRange(dateKey: string, from: string, to: string): boolean {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  return dateKey >= lo && dateKey <= hi;
}

/** 按选择挑出要导出的日记，新的在前（与历史记录侧栏同序）。 */
export function selectDiariesForExport(
  diaries: readonly DecisionEmotionDiary[],
  selection: EmotionDiaryExportSelection,
): DecisionEmotionDiary[] {
  const picked = diaries.filter(diary => {
    if (selection.scope === 'all') return true;
    if (selection.scope === 'day') return selection.date != null && diary.diary_date === selection.date;
    if (selection.from == null || selection.to == null) return false;
    return inRange(diary.diary_date, selection.from, selection.to);
  });
  return [...picked].sort((a, b) => b.diary_date.localeCompare(a.diary_date));
}

/** 「2026-09-12 周六」。固定按 UTC+8 读，与日记的自然日口径一致。 */
export function diaryDateLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  const weekday = date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' });
  return `${dateKey} ${weekday}`;
}

function block(label: string, value: string): string {
  return `${label}\n${value.trim() || '—'}`;
}

/** 导出范围的一句话描述，同时用在文件头与文件名上。 */
export function describeExportSelection(
  selection: EmotionDiaryExportSelection,
  count: number,
): string {
  if (selection.scope === 'day') return `${selection.date ?? '—'}（当日）`;
  if (selection.scope === 'all') return `全部 ${count} 天`;
  const from = selection.from ?? '—';
  const to = selection.to ?? '—';
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return `${lo} 至 ${hi}（${count} 天）`;
}

/** 一天的完整记录：先是汇总，再是逐题作答。 */
export function buildEmotionDiaryDayTxt(diary: DecisionEmotionDiary): string {
  const summary = buildEmotionDiaryExportSummary(diary);
  const hasPoms = summary.pomsTotal != null && summary.pomsDimensions != null;
  const measurement = hasPoms
    ? [
      block('心境状态量表（POMS-40）总心境扰乱', summary.pomsTotal ?? '—'),
      block('心境状态量表（POMS-40）七个分量表', summary.pomsDimensions ?? '—'),
      block('正性情感（PANAS-PA）', summary.panasPositive ?? '—'),
      block('负性情感（PANAS-NA）', summary.panasNegative ?? '—'),
      block('个人主动性量表（PI-7）总分', summary.personalInitiativeTotal ?? '未填写'),
      block('个人主动性量表（PI-7）题目均分', summary.personalInitiativeMean ?? '未填写'),
    ]
    : [
      block('历史情绪效价（SAM 1–9）', summary.legacyValence ?? '—'),
      block('历史情绪唤醒度（SAM 1–9）', summary.legacyArousal ?? '—'),
    ];

  const items: string[] = [];
  if (diary.poms_item_scores.length > 0) {
    items.push(block(
      'POMS-40 逐题作答（0 几乎没有 – 4 非常强烈）',
      POMS_QUESTIONS.map((question, index) => {
        const score = diary.poms_item_scores[index];
        const reverse = question.reverseScored ? '（反向计分）' : '';
        const subscale = POMS_SUBSCALE_LABELS[question.subscale];
        return `${question.code} ${question.term}${reverse} · ${subscale} · ${score ?? '—'}`;
      }).join('\n'),
    ));
  }
  if (diary.panas_item_scores.length > 0) {
    items.push(block(
      'PANAS-20 逐题作答（1 几乎没有 – 5 非常强烈）',
      PANAS_QUESTIONS.map((question, index) => {
        const dimension = question.dimension === 'positive' ? '正性' : '负性';
        return `${question.code} ${question.term} · ${dimension} · ${diary.panas_item_scores[index] ?? '—'}`;
      }).join('\n'),
    ));
  }
  if (diary.pi_item_scores.length > 0) {
    items.push(block(
      'PI-7 逐题作答（1 完全不同意 – 7 完全同意）',
      PI_QUESTIONS.map((question, index) => (
        `${question.code} ${question.prompt} ${diary.pi_item_scores[index] ?? '—'}`
      )).join('\n'),
    ));
  }
  if (diary.hads_anxiety_scores.length > 0) {
    items.push(block(
      'HADS 焦虑分量表逐题作答（0–3）',
      HADS_ANXIETY_QUESTIONS.map((question, index) => (
        `${question.code} ${question.prompt} ${diary.hads_anxiety_scores[index] ?? '—'}`
      )).join('\n'),
    ));
  }
  if (diary.hads_depression_scores.length > 0) {
    items.push(block(
      'HADS 抑郁分量表逐题作答（0–3）',
      HADS_DEPRESSION_QUESTIONS.map((question, index) => (
        `${question.code} ${question.prompt} ${diary.hads_depression_scores[index] ?? '—'}`
      )).join('\n'),
    ));
  }

  return [
    `【${diaryDateLabel(diary.diary_date)}】`,
    block('最近让内心起波澜的事情', summary.eventText),
    ...measurement,
    block('焦虑分量表（HADS-A）', summary.anxiety),
    block('抑郁分量表（HADS-D）', summary.depression),
    ...items,
    block('量表版本', diary.measurement_version || EMOTION_DIARY_MEASUREMENT_VERSION),
  ].join('\n\n');
}

export function buildEmotionDiaryHistoryTxt(
  diaries: readonly DecisionEmotionDiary[],
  selection: EmotionDiaryExportSelection,
  exportedAt?: string,
): string {
  const header = [
    block('情绪日记导出', describeExportSelection(selection, diaries.length)),
    block('量表', 'POMS-40 · PANAS-20 · PI-7 · HADS-14'),
    ...(exportedAt ? [block('导出时间', exportedAt)] : []),
    block(
      '说明',
      'POMS、PANAS 与 PI-7 用于纵向记录。PI-7 全部正向计分，不设统一临床诊断区间；'
      + 'HADS 为筛查工具，分数不等同于临床诊断。分数按逐题作答重新计分得出，'
      + '与页面显示一致；自然日按 UTC+8 划分。',
    ),
  ].join('\n\n');
  if (diaries.length === 0) return `${header}\n\n${'─'.repeat(40)}\n\n（所选范围内没有记录）`;
  const days = diaries.map(buildEmotionDiaryDayTxt).join(`\n\n${'─'.repeat(40)}\n\n`);
  return `${header}\n\n${'─'.repeat(40)}\n\n${days}\n`;
}

/** CSV 字段转义：逗号、引号、换行都要包起来，事件正文里三者都会出现。 */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const EMOTION_DIARY_CSV_HEADERS: ReadonlyArray<string> = [
  '日期', '星期', '事件',
  'POMS_TMD',
  ...Object.values(POMS_SUBSCALE_LABELS).map(label => `POMS_${label}`),
  'PANAS_PA', 'PANAS_NA',
  'PI_总分', 'PI_均分',
  'HADS_A', 'HADS_A_分级', 'HADS_D', 'HADS_D_分级',
  'SAM_效价', 'SAM_唤醒',
  '量表版本', '更新时间',
  ...POMS_QUESTIONS.map(q => q.code),
  ...PANAS_QUESTIONS.map(q => q.code),
  ...PI_QUESTIONS.map(q => q.code),
  ...HADS_ANXIETY_QUESTIONS.map(q => q.code),
  ...HADS_DEPRESSION_QUESTIONS.map(q => q.code),
];

/** 「57（TMD）」→ 57；「30/50」→ 30；「7/21（正常范围，0–7）」→ 7。CSV 要能直接参与计算。 */
function leadingNumber(value: string | null): number | null {
  if (value == null) return null;
  const match = /^-?\d+(?:\.\d+)?/.exec(value.trim());
  return match ? Number(match[0]) : null;
}

/** 「7/21（正常范围，0–7）」→「正常范围」。 */
function bandLabel(value: string | null): string | null {
  if (value == null) return null;
  const match = /（([^，）]+)/.exec(value);
  return match ? match[1] : null;
}

export function buildEmotionDiaryHistoryCsv(diaries: readonly DecisionEmotionDiary[]): string {
  const rows = diaries.map(diary => {
    const summary = buildEmotionDiaryExportSummary(diary);
    // 七个分量表从 summary 的「紧张 12 · 愤怒 14 · …」拆回数字，保证与 TXT、页面同源。
    const dimensionValues = new Map<string, number>();
    for (const part of (summary.pomsDimensions ?? '').split(' · ')) {
      const [label, score] = part.split(' ');
      if (label && score != null) dimensionValues.set(label, Number(score));
    }
    return [
      diary.diary_date,
      diaryDateLabel(diary.diary_date).slice(11),
      summary.eventText,
      leadingNumber(summary.pomsTotal),
      ...Object.values(POMS_SUBSCALE_LABELS).map(label => dimensionValues.get(label) ?? null),
      leadingNumber(summary.panasPositive),
      leadingNumber(summary.panasNegative),
      leadingNumber(summary.personalInitiativeTotal),
      leadingNumber(summary.personalInitiativeMean),
      leadingNumber(summary.anxiety),
      bandLabel(summary.anxiety),
      leadingNumber(summary.depression),
      bandLabel(summary.depression),
      leadingNumber(summary.legacyValence),
      leadingNumber(summary.legacyArousal),
      diary.measurement_version || EMOTION_DIARY_MEASUREMENT_VERSION,
      diary.updated_at,
      ...POMS_QUESTIONS.map((_, index) => diary.poms_item_scores[index] ?? null),
      ...PANAS_QUESTIONS.map((_, index) => diary.panas_item_scores[index] ?? null),
      ...PI_QUESTIONS.map((_, index) => diary.pi_item_scores[index] ?? null),
      ...HADS_ANXIETY_QUESTIONS.map((_, index) => diary.hads_anxiety_scores[index] ?? null),
      ...HADS_DEPRESSION_QUESTIONS.map((_, index) => diary.hads_depression_scores[index] ?? null),
    ].map(csvCell).join(',');
  });
  return [EMOTION_DIARY_CSV_HEADERS.join(','), ...rows].join('\n');
}

export function emotionDiaryExportFileName(
  selection: EmotionDiaryExportSelection,
  count: number,
  format: EmotionDiaryExportFormat,
): string {
  if (selection.scope === 'day') {
    return safeExportFileName(`情绪日记 ${selection.date ?? '—'}.${format}`);
  }
  if (selection.scope === 'all') {
    return safeExportFileName(`情绪日记 全部（${count} 天）.${format}`);
  }
  const from = selection.from ?? '—';
  const to = selection.to ?? '—';
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return safeExportFileName(`情绪日记 ${lo} 至 ${hi}（${count} 天）.${format}`);
}

export interface EmotionDiaryExportRequest {
  diaries: readonly DecisionEmotionDiary[];
  selection: EmotionDiaryExportSelection;
  format: EmotionDiaryExportFormat;
  exportedAt?: string;
}

/** 导出并触发下载，返回文件名与实际导出的天数。 */
export function exportEmotionDiaryHistory(request: EmotionDiaryExportRequest): {
  fileName: string;
  days: number;
} {
  const picked = selectDiariesForExport(request.diaries, request.selection);
  const fileName = emotionDiaryExportFileName(request.selection, picked.length, request.format);
  const content = request.format === 'csv'
    ? buildEmotionDiaryHistoryCsv(picked)
    : buildEmotionDiaryHistoryTxt(picked, request.selection, request.exportedAt);
  downloadTextFile(fileName, content, request.format === 'csv' ? 'text/csv' : 'text/plain');
  return { fileName, days: picked.length };
}
