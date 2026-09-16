/**
 * 元监控的战役胜率 / 平均相对期望直接读落库的 status / final_realized_pnl / final_r_multiple。
 *
 * TUTUSDT 2026-08-09 那一场：落库盈利结束 +469.96，校正后 −1756.65。
 * 落库值由详情页自愈（打开详情，或战役列表在后台替用户逐场跑的同一个自愈）收敛之后，元监控必须把它算成亏损。
 * 自愈写回的三个字段就是 reconcileCampaignWithSettlement 推出的那三个（journalApi.healCorrectedStatus 测试钉住了同一组数），
 * 这里喂的是套上它们的行，而不是另写一遍状态推导。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign } from '@/types/journal';
import { computeCampaignRealizedPnl, reconcileCampaignWithSettlement } from '@/lib/campaignRealizedPnl';
import {
  CORRECTED_LOSS_CLOSED_AT,
  CORRECTED_TOTAL,
  PLANNED_MAX_LOSS_TOTAL,
  correctedLossCorrections,
  correctedLossLegs,
  correctedLossStoredCampaign,
  correctedLossTradeRecords,
} from '@/test/fixtures/correctedLossCampaign';

const state = vi.hoisted(() => ({
  campaigns: [] as TradeCampaign[],
  /** 稳定引用：页面的取数 effect 依赖 [user]。 */
  user: { id: 'user-1', email: 'desk@example.com' },
  tradeHistory: [] as never[],
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: state.user, profile: { display_name: '主账户' } }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({ tradeHistory: state.tradeHistory }),
}));

vi.mock('@/lib/notificationCenter', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/noTradeHypothetical', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/noTradeHypothetical')>(),
  computeTooHardBasketStats: vi.fn(async () => null),
}));

vi.mock('@/lib/journalApi', () => ({
  listAllJournalDataForUser: vi.fn(async () => ({
    journals: [], assignments: [], patterns: [], categories: [], rules: [], principles: [], painEntries: [],
  })),
  listAllCampaigns: vi.fn(async () => state.campaigns),
  listCounterfactuals: vi.fn(async () => []),
}));

import JournalInsightsPage from '../JournalInsightsPage';

/** StatCard：标签下面紧跟数值。 */
function statValue(label: string) {
  const labelNode = screen.getAllByText(label).find(node => node.nextElementSibling);
  return labelNode?.nextElementSibling?.textContent ?? null;
}

async function renderInsights() {
  render(<MemoryRouter initialEntries={['/journal/insights']}><JournalInsightsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByText('战役胜率').length).toBeGreaterThan(0));
}

describe('元监控 · 读收敛后的落库值', () => {
  beforeEach(() => {
    // 夹具的平仓时刻在 2026-01-01：把「现在」放在其后几天，落进默认的 30 天窗口
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(CORRECTED_LOSS_CLOSED_AT) + 3 * 24 * 3600_000));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('未收敛的落库行（盈利结束 +469.96）被算成赢——这正是需要列表后台跑自愈的原因', async () => {
    state.campaigns = [correctedLossStoredCampaign()];
    await renderInsights();
    expect(statValue('总战役')).toBe('1');
    expect(statValue('战役胜率')).toBe('100%');
  });

  it('自愈写回校正后的三个字段之后，同一场计为亏损、相对期望为负', async () => {
    const stored = correctedLossStoredCampaign();
    const legs = correctedLossLegs();
    const settlement = computeCampaignRealizedPnl(stored, legs, correctedLossTradeRecords(), correctedLossCorrections());
    const healed = reconcileCampaignWithSettlement(stored, legs, settlement);
    expect(healed.status).toBe('closed_loss');
    expect(healed.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(healed.final_r_multiple).toBeCloseTo(CORRECTED_TOTAL / PLANNED_MAX_LOSS_TOTAL, 8);
    state.campaigns = [healed];

    await renderInsights();
    expect(statValue('总战役')).toBe('1');
    expect(statValue('战役胜率')).toBe('0%');
    expect(Number(statValue('平均相对期望'))).toBeLessThan(0);
  });
});
