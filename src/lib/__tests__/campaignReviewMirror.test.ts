import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER = 'campaign-owner';

const campaignRow = {
  id: 'campaign-1',
  campaign_code: 'C-MIRROR001',
  user_id: OWNER,
  symbol: 'BTCUSDT',
  title: 'BTCUSDT 镜像评价战役',
  direction: 'long',
  status: 'closed_profit',
  opened_at: '2026-07-20T02:00:00.000Z',
  closed_at: '2026-07-20T04:00:00.000Z',
  actual_evolution: [],
};

const remoteLeg = {
  id: 'leg-1',
  user_id: OWNER,
  campaign_id: campaignRow.id,
  symbol: campaignRow.symbol,
  direction: 'long',
  leg_role: 'main_open',
  leg_sequence: 1,
  pre_simulated_time: campaignRow.opened_at,
  post_outcome: 'win',
  post_reviewed_at: '2026-07-21T03:04:05.000Z',
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from(table: string) {
      if (table === 'trade_campaigns') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () => Promise.resolve({ data: campaignRow, error: null }),
        };
        return builder;
      }
      if (table === 'trade_journals') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => Promise.resolve({ data: [remoteLeg], error: null }),
        };
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

import { buildCampaignPostReviewsTxt } from '@/lib/campaignReviewTxtExport';
import { getCampaignWithLegs } from '@/lib/journalApi';
import { mirrorDroppedColumns } from '@/lib/journalLocalMirror';

describe('交易战役平仓评价导出读取本地镜像', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('远端缺少评价扩展列时，战役详情仍合并答案并完整导出', async () => {
    mirrorDroppedColumns(
      OWNER,
      remoteLeg.id,
      {
        post_entry_payoff_basis_review: '上方空间和成交量都支持最初判断。',
        post_emo_disturbance: '回撤时担心利润被全部吞回。',
      },
      ['post_entry_payoff_basis_review', 'post_emo_disturbance'],
    );

    const { campaign, legs } = await getCampaignWithLegs(campaignRow.id);
    expect(legs[0].post_entry_payoff_basis_review)
      .toBe('上方空间和成交量都支持最初判断。');
    expect(legs[0].post_emo_disturbance)
      .toBe('回撤时担心利润被全部吞回。');

    const output = buildCampaignPostReviewsTxt(campaign, legs);
    expect(output).toContain(
      '问题：建仓时盈亏比估计的复盘说明是什么？\n答案：上方空间和成交量都支持最初判断。',
    );
    expect(output).toContain(
      '问题：情绪七问 ① 这单最起波澜的事情是什么？\n答案：回撤时担心利润被全部吞回。',
    );
  });
});
