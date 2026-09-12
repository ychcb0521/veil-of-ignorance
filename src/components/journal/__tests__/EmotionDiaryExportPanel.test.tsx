import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmotionDiaryExportPanel } from '@/components/journal/EmotionDiaryExportPanel';
import type {
  DecisionEmotionDiary,
  HadsItemScore,
  PanasItemScore,
  PiItemScore,
  PomsItemScore,
} from '@/types/emotionDiary';

const downloadTextFile = vi.hoisted(() => vi.fn((fileName: string, _content: string, _mime?: string) => fileName));
vi.mock('@/lib/downloadTextFile', () => ({
  downloadTextFile,
  safeExportFileName: (value: string) => value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim(),
}));

const diary = (date: string): DecisionEmotionDiary => ({
  id: `d-${date}`, user_id: 'u1', diary_date: date, event_text: `${date} 的记录`,
  sam_valence: null, sam_arousal: null,
  poms_item_scores: Array.from({ length: 40 }, () => 2 as PomsItemScore),
  poms_tension_score: null, poms_anger_score: null, poms_fatigue_score: null,
  poms_depression_score: null, poms_vigor_score: null, poms_confusion_score: null,
  poms_esteem_score: null, poms_total_mood_disturbance: null,
  panas_item_scores: Array.from({ length: 20 }, () => 3 as PanasItemScore),
  panas_positive_score: 30, panas_negative_score: 30,
  pi_item_scores: Array.from({ length: 7 }, () => 7 as PiItemScore),
  pi_total_score: 49, pi_mean_score: 7,
  hads_anxiety_scores: Array.from({ length: 7 }, () => 0 as HadsItemScore),
  hads_depression_scores: Array.from({ length: 7 }, () => 1 as HadsItemScore),
  hads_anxiety_score: 0, hads_depression_score: 7,
  measurement_version: 'poms40-panas20-pi7-hads14',
  created_at: `${date}T04:00:00.000Z`, updated_at: `${date}T04:30:00.000Z`,
});

const diaries = [diary('2026-09-12'), diary('2026-09-11'), diary('2026-08-20')];

const renderPanel = (selectedDate = '2026-09-11') => render(
  <EmotionDiaryExportPanel diaries={diaries} selectedDate={selectedDate} today="2026-09-12" />,
);
const lastDownload = () => downloadTextFile.mock.calls.at(-1)!;

describe('情绪日记导出面板', () => {
  beforeEach(() => downloadTextFile.mockClear());

  it('默认收起，点「导出」才展开', () => {
    renderPanel();
    expect(screen.queryByTestId('emotion-diary-export-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.getByTestId('emotion-diary-export-panel')).toBeInTheDocument();
  });

  it('【用户要求】当日：导出选中的那一天', () => {
    renderPanel('2026-09-11');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.getByTestId('emotion-diary-export-summary').textContent).toContain('2026-09-11（当日）');
    fireEvent.click(screen.getByRole('button', { name: '导出 1 天' }));
    const [fileName, content] = lastDownload();
    expect(fileName).toBe('情绪日记 2026-09-11.txt');
    expect(content).toContain('【2026-09-11 周五】');
    expect(content).not.toContain('【2026-09-12');
  });

  it('【用户要求】时间段：按起止日期筛，含两端', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    fireEvent.click(screen.getByRole('button', { name: '时间段' }));
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-09-11' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-12' } });
    expect(screen.getByTestId('emotion-diary-export-summary').textContent)
      .toContain('2026-09-11 至 2026-09-12（2 天）');
    fireEvent.click(screen.getByRole('button', { name: '导出 2 天' }));
    const [fileName, content] = lastDownload();
    expect(fileName).toBe('情绪日记 2026-09-11 至 2026-09-12（2 天）.txt');
    expect(content).toContain('【2026-09-12 周六】');
    expect(content).toContain('【2026-09-11 周五】');
    expect(content).not.toContain('【2026-08-20');
  });

  it('【用户要求】全部：三天都导出', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 3 天' }));
    expect(lastDownload()[0]).toBe('情绪日记 全部（3 天）.txt');
  });

  it('CSV 格式：按表格导出，MIME 与扩展名一致', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 3 天' }));
    const [fileName, content, mime] = lastDownload();
    expect(fileName).toBe('情绪日记 全部（3 天）.csv');
    expect(mime).toBe('text/csv');
    expect(content.split('\n')[0]).toContain('日期,星期,事件,POMS_TMD');
    expect(content.split('\n')).toHaveLength(4);
  });

  it('所选范围内没有记录时不下载，按钮禁用并说明原因', () => {
    render(<EmotionDiaryExportPanel diaries={diaries} selectedDate="2026-01-01" today="2026-09-12" />);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    const button = screen.getByRole('button', { name: '所选范围内没有记录' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(downloadTextFile).not.toHaveBeenCalled();
  });
});
