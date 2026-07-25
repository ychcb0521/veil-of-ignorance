import { describe, expect, it } from 'vitest';
import { buildCampaignEmotionDiaryTxt } from '@/lib/emotionDiaryTxtExport';
import type { DecisionEmotionDiary } from '@/types/emotionDiary';
import type { TradeCampaign } from '@/types/journal';

const campaign = {
  id: 'campaign-1',
  campaign_code: 'C-ABC123',
  symbol: 'BTCUSDT',
  direction: 'main_long',
  status: 'closed_profit',
  strategy_template: 'main_hedge_mirror',
  opened_at: '2026-07-25T01:00:00.000Z',
  closed_at: '2026-07-25T03:00:00.000Z',
} as TradeCampaign;

const diary: DecisionEmotionDiary = {
  id: 'diary-1',
  user_id: 'user-1',
  diary_date: '2026-07-25',
  event_text: '事件第一行。\n事件第二行仍须完整保留。',
  sam_valence: 6,
  sam_arousal: 7,
  hads_anxiety_scores: [1, 1, 1, 1, 1, 1, 1],
  hads_depression_scores: [0, 0, 0, 0, 0, 0, 0],
  hads_anxiety_score: 7,
  hads_depression_score: 0,
  measurement_version: 'SAM-VA-9+HADS-14-score-entry-v1',
  created_at: '2026-07-25T04:00:00.000Z',
  updated_at: '2026-07-25T04:00:00.000Z',
};

describe('campaign emotion diary TXT export', () => {
  it('问题与答案成对输出且题目之间空一行', () => {
    const output = buildCampaignEmotionDiaryTxt(campaign, diary, '主账户');

    expect(output).toContain('最近让内心起波澜的事情\n事件第一行。\n事件第二行仍须完整保留。');
    expect(output).toContain('情绪效价（SAM 1–9）\n6/9（中性附近）');
    expect(output).toContain('焦虑分量表（HADS-A）\n7/21（正常范围，0–7）');
    expect(output).toContain('抑郁分量表（HADS-D）\n0/21（正常范围，0–7）');
    expect(output).toMatch(/关联战役\n.+\n\n战役编号/);
    expect(output).not.toContain('A1');
    expect(output).not.toContain('D1');
  });
});
