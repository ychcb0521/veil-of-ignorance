import { describe, expect, it } from 'vitest';
import {
  EMOTION_DIARY_CSV_HEADERS,
  buildEmotionDiaryDayTxt,
  buildEmotionDiaryHistoryCsv,
  buildEmotionDiaryHistoryTxt,
  describeExportSelection,
  diaryDateLabel,
  emotionDiaryExportFileName,
  selectDiariesForExport,
  shiftDiaryDate,
} from '@/lib/emotionDiaryHistoryExport';
import type {
  DecisionEmotionDiary,
  HadsItemScore,
  PanasItemScore,
  PiItemScore,
  PomsItemScore,
} from '@/types/emotionDiary';

const poms = (value: PomsItemScore) => Array.from({ length: 40 }, () => value);
const panas = (value: PanasItemScore) => Array.from({ length: 20 }, () => value);
const pi = (value: PiItemScore) => Array.from({ length: 7 }, () => value);
const hads = (value: HadsItemScore) => Array.from({ length: 7 }, () => value);

const diary = (over: Partial<DecisionEmotionDiary> = {}): DecisionEmotionDiary => ({
  id: `d-${over.diary_date ?? '2026-09-12'}`,
  user_id: 'u1',
  diary_date: '2026-09-12',
  event_text: '今天是生理期第一天。身体比上次的状态好一点。',
  sam_valence: null,
  sam_arousal: null,
  poms_item_scores: poms(2),
  poms_tension_score: null, poms_anger_score: null, poms_fatigue_score: null,
  poms_depression_score: null, poms_vigor_score: null, poms_confusion_score: null,
  poms_esteem_score: null,
  // 落库的汇总列停在旧口径（P7 反向计分修正之前）。导出必须按逐题作答重算，不能读这个数。
  poms_total_mood_disturbance: 126,
  panas_item_scores: panas(3),
  panas_positive_score: 30,
  panas_negative_score: 30,
  pi_item_scores: pi(7),
  pi_total_score: 49,
  pi_mean_score: 7,
  hads_anxiety_scores: hads(0),
  hads_depression_scores: hads(1),
  hads_anxiety_score: 0,
  hads_depression_score: 7,
  measurement_version: 'poms40-panas20-pi7-hads14',
  created_at: '2026-09-12T04:00:00.000Z',
  updated_at: '2026-09-12T04:30:00.000Z',
  ...over,
});

const history = [
  diary({ diary_date: '2026-09-12' }),
  diary({ diary_date: '2026-09-11', event_text: '今天感觉身体比较弱。' }),
  diary({ diary_date: '2026-09-10' }),
  diary({ diary_date: '2026-08-30' }),
];

describe('选择要导出的日记', () => {
  it('【用户要求】当日 / 时间段 / 全部三种范围', () => {
    expect(selectDiariesForExport(history, { scope: 'day', date: '2026-09-11' }).map(d => d.diary_date))
      .toEqual(['2026-09-11']);
    expect(selectDiariesForExport(history, { scope: 'range', from: '2026-09-10', to: '2026-09-12' }).map(d => d.diary_date))
      .toEqual(['2026-09-12', '2026-09-11', '2026-09-10']);          // 含两端，新的在前
    expect(selectDiariesForExport(history, { scope: 'all' })).toHaveLength(4);
  });

  it('起止写反了也按区间取；范围内没有记录时给出空集而不是报错', () => {
    expect(selectDiariesForExport(history, { scope: 'range', from: '2026-09-12', to: '2026-09-10' }))
      .toHaveLength(3);
    expect(selectDiariesForExport(history, { scope: 'range', from: '2026-07-01', to: '2026-07-31' }))
      .toEqual([]);
    expect(selectDiariesForExport(history, { scope: 'day', date: '2026-01-01' })).toEqual([]);
  });

  it('自然日按 UTC+8 加减，跨月不出错', () => {
    expect(shiftDiaryDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDiaryDate('2026-09-12', -29)).toBe('2026-08-14');
    expect(diaryDateLabel('2026-09-12')).toBe('2026-09-12 周六');
  });

  it('范围描述与文件名', () => {
    expect(describeExportSelection({ scope: 'day', date: '2026-09-12' }, 1)).toBe('2026-09-12（当日）');
    expect(describeExportSelection({ scope: 'range', from: '2026-09-10', to: '2026-09-12' }, 3))
      .toBe('2026-09-10 至 2026-09-12（3 天）');
    expect(describeExportSelection({ scope: 'all' }, 40)).toBe('全部 40 天');
    expect(emotionDiaryExportFileName({ scope: 'day', date: '2026-09-12' }, 1, 'txt'))
      .toBe('情绪日记 2026-09-12.txt');
    expect(emotionDiaryExportFileName({ scope: 'range', from: '2026-09-10', to: '2026-09-12' }, 3, 'csv'))
      .toBe('情绪日记 2026-09-10 至 2026-09-12（3 天）.csv');
    expect(emotionDiaryExportFileName({ scope: 'all' }, 40, 'txt')).toBe('情绪日记 全部（40 天）.txt');
  });
});

describe('TXT 导出', () => {
  it('一天的记录含事件、四个量表的汇总与逐题作答', () => {
    const text = buildEmotionDiaryDayTxt(diary());
    expect(text).toContain('【2026-09-12 周六】');
    expect(text).toContain('今天是生理期第一天');
    // 汇总按逐题作答重算：落库的 126 是旧口径，正确值是 136
    expect(text).toContain('136（TMD）');
    expect(text).not.toContain('126（TMD）');
    expect(text).toContain('紧张 12 · 愤怒 14');
    expect(text).toContain('正性情感（PANAS-PA）\n30/50');
    expect(text).toContain('个人主动性量表（PI-7）总分\n49/49');
    expect(text).toContain('焦虑分量表（HADS-A）\n0/21（正常范围，0–7）');
    expect(text).toContain('抑郁分量表（HADS-D）\n7/21（正常范围，0–7）');
    expect(text).toContain('P1 紧张的 · 紧张 · 2');
    expect(text).toContain('P7 ');
    expect(text).toContain('（反向计分）');
    expect(text).toContain('N1 感兴趣 · 正性 · 3');
    expect(text).toContain('PI1 我会主动着手处理问题。 7');
    expect(text).toContain('A1 ');
    expect(text).toContain('D1 ');
    expect(text).toContain('量表版本\npoms40-panas20-pi7-hads14');
  });

  it('多天导出：文件头写明范围与说明，按日期倒序、用分隔线隔开', () => {
    const selection = { scope: 'range' as const, from: '2026-09-10', to: '2026-09-12' };
    const picked = selectDiariesForExport(history, selection);
    const text = buildEmotionDiaryHistoryTxt(picked, selection, '2026-09-12 11:30:00');
    expect(text).toContain('情绪日记导出\n2026-09-10 至 2026-09-12（3 天）');
    expect(text).toContain('导出时间\n2026-09-12 11:30:00');
    expect(text).toContain('HADS 为筛查工具，分数不等同于临床诊断');
    expect(text.indexOf('【2026-09-12')).toBeLessThan(text.indexOf('【2026-09-11'));
    expect(text.split('─'.repeat(40))).toHaveLength(4);        // 文件头 + 3 天
  });

  it('老的 SAM 记录走另一支，不硬凑 POMS', () => {
    const legacy = diary({
      diary_date: '2026-06-01',
      poms_item_scores: [], panas_item_scores: [], pi_item_scores: [],
      poms_total_mood_disturbance: null, panas_positive_score: null, panas_negative_score: null,
      pi_total_score: null, pi_mean_score: null,
      sam_valence: 4, sam_arousal: 7,
    });
    const text = buildEmotionDiaryDayTxt(legacy);
    expect(text).toContain('历史情绪效价（SAM 1–9）\n4/9（中性附近）');
    expect(text).toContain('历史情绪唤醒度（SAM 1–9）\n7/9（高唤醒）');
    expect(text).not.toContain('TMD');
    expect(text).not.toContain('P1 ');
  });

  it('空选择也能导出一个说明文件，不抛错', () => {
    const text = buildEmotionDiaryHistoryTxt([], { scope: 'range', from: '2026-07-01', to: '2026-07-31' });
    expect(text).toContain('（所选范围内没有记录）');
  });
});

describe('CSV 导出', () => {
  it('表头：汇总列在前，逐题原始作答在后（可据此重新计分）', () => {
    expect(EMOTION_DIARY_CSV_HEADERS.slice(0, 4)).toEqual(['日期', '星期', '事件', 'POMS_TMD']);
    expect(EMOTION_DIARY_CSV_HEADERS).toContain('POMS_紧张');
    expect(EMOTION_DIARY_CSV_HEADERS).toContain('HADS_A_分级');
    expect(EMOTION_DIARY_CSV_HEADERS).toContain('P40');
    expect(EMOTION_DIARY_CSV_HEADERS).toContain('N20');
    expect(EMOTION_DIARY_CSV_HEADERS).toContain('PI7');
    expect(EMOTION_DIARY_CSV_HEADERS).toContain('A7');
    expect(EMOTION_DIARY_CSV_HEADERS).toContain('D7');
    // 23 个汇总列 + 逐题 40/20/7/7/7
    expect(EMOTION_DIARY_CSV_HEADERS).toHaveLength(23 + 40 + 20 + 7 + 7 + 7);
  });

  it('每天一行，数值是纯数字（不带 /50、（正常范围））', () => {
    const csv = buildEmotionDiaryHistoryCsv(selectDiariesForExport(history, { scope: 'all' }));
    const lines = csv.split('\n');
    expect(lines).toHaveLength(5);
    const cells = lines[1].split(',');
    const at = (header: string) => cells[EMOTION_DIARY_CSV_HEADERS.indexOf(header)];
    expect(at('日期')).toBe('2026-09-12');
    expect(at('星期')).toBe('周六');
    expect(at('POMS_TMD')).toBe('136');          // 与 TXT 同源，按逐题重算
    expect(at('POMS_紧张')).toBe('12');
    expect(at('PANAS_PA')).toBe('30');
    expect(at('PI_均分')).toBe('7');          // CSV 写纯数字，格式化留给统计软件
    expect(at('HADS_A')).toBe('0');
    expect(at('HADS_A_分级')).toBe('正常范围');
    expect(at('HADS_D_分级')).toBe('正常范围');
    expect(at('P1')).toBe('2');
    expect(at('N1')).toBe('3');
    expect(at('PI1')).toBe('7');
    expect(at('A1')).toBe('0');
    expect(at('D1')).toBe('1');
    expect(at('量表版本')).toBe('poms40-panas20-pi7-hads14');
  });

  it('事件正文里的逗号、引号、换行都被正确转义', () => {
    const csv = buildEmotionDiaryHistoryCsv([diary({ event_text: '他说，"这是对的"\n然后我照做了' })]);
    expect(csv).toContain('"他说，""这是对的""\n然后我照做了"');
    // 转义之后，字段数仍然对得上
    expect(csv.split('\n')).toHaveLength(3);      // 表头 + 含换行的那一行拆成两段
  });

  it('老的 SAM 记录：POMS 列留空，SAM 列有值', () => {
    const legacy = diary({
      diary_date: '2026-06-01',
      poms_item_scores: [], panas_item_scores: [], pi_item_scores: [],
      poms_total_mood_disturbance: null, panas_positive_score: null, panas_negative_score: null,
      pi_total_score: null, pi_mean_score: null,
      sam_valence: 4, sam_arousal: 7,
    });
    const cells = buildEmotionDiaryHistoryCsv([legacy]).split('\n')[1].split(',');
    const at = (header: string) => cells[EMOTION_DIARY_CSV_HEADERS.indexOf(header)];
    expect(at('POMS_TMD')).toBe('');
    expect(at('P1')).toBe('');
    expect(at('SAM_效价')).toBe('4');
    expect(at('SAM_唤醒')).toBe('7');
    expect(at('HADS_D')).toBe('7');
  });
});
