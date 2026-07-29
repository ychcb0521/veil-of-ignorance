import { describe, expect, it } from 'vitest';
import { buildCampaignEmotionDiaryTxt } from '@/lib/emotionDiaryTxtExport';
import type {
  DecisionEmotionDiary,
  PanasItemScore,
  PiItemScore,
  PomsItemScore,
} from '@/types/emotionDiary';
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
  sam_valence: null,
  sam_arousal: null,
  poms_item_scores: Array.from({ length: 40 }, () => 2 as PomsItemScore),
  poms_tension_score: 12,
  poms_anger_score: 14,
  poms_fatigue_score: 10,
  poms_depression_score: 12,
  poms_vigor_score: 12,
  poms_confusion_score: 10,
  poms_esteem_score: 10,
  poms_total_mood_disturbance: 126,
  panas_item_scores: Array.from({ length: 20 }, () => 3 as PanasItemScore),
  panas_positive_score: 30,
  panas_negative_score: 30,
  pi_item_scores: Array.from({ length: 7 }, () => 5 as PiItemScore),
  pi_total_score: 35,
  pi_mean_score: 5,
  hads_anxiety_scores: [1, 1, 1, 1, 1, 1, 1],
  hads_depression_scores: [0, 0, 0, 0, 0, 0, 0],
  hads_anxiety_score: 7,
  hads_depression_score: 0,
  measurement_version: 'POMS-CN-40+PANAS-20+PI-7+HADS-14-research-v3',
  created_at: '2026-07-25T04:00:00.000Z',
  updated_at: '2026-07-25T04:00:00.000Z',
};

describe('campaign emotion diary TXT export', () => {
  it('完整事件与各量表计分成对输出，题目之间空一行', () => {
    const output = buildCampaignEmotionDiaryTxt(campaign, diary, '主账户');

    expect(output).toContain('最近让内心起波澜的事情\n事件第一行。\n事件第二行仍须完整保留。');
    expect(output).toContain('心境状态量表（POMS）总心境扰乱\n136（TMD）');
    expect(output).toContain('心境状态量表（POMS）七个分量表\n紧张 12');
    expect(output).toContain('正性情感（PANAS-PA）\n30/50');
    expect(output).toContain('负性情感（PANAS-NA）\n30/50');
    expect(output).toContain('个人主动性量表（PI-7）总分\n35/49');
    expect(output).toContain('个人主动性量表（PI-7）题目均分\n5.00/7');
    expect(output).toContain('焦虑分量表（HADS-A）\n7/21（正常范围，0–7）');
    expect(output).toContain('抑郁分量表（HADS-D）\n0/21（正常范围，0–7）');
    expect(output).toMatch(/关联战役\n.+\n\n战役编号/);
    expect(output).not.toContain('A1');
    expect(output).not.toContain('D1');
  });
});
