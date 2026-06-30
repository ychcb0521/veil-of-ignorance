import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import JournalRulesPage from '../JournalRulesPage';
import type { TradeCampaign, TradingRule } from '@/types/journal';

const mocks = vi.hoisted(() => ({
  updateRule: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/journalApi', () => ({
  createPrinciple: vi.fn(),
  deleteRule: vi.fn(),
  getLocalTradingRuleSourceCampaigns: vi.fn(() => ({})),
  listActiveCampaigns: vi.fn(async () => []),
  listAllCampaigns: vi.fn(async () => [
    {
      id: 'campaign-1',
      user_id: 'user-1',
      symbol: 'POWERUSDT',
      direction: 'main_long',
      status: 'closed_profit',
      strategy_template: 'main_dual_hedge_mirror_tp',
      title: 'POWERUSDT 2026-02-10 多战役',
      opened_at: '2026-02-10T08:16:00.000Z',
      closed_at: '2026-02-10T12:03:00.000Z',
      initial_main_size_usdt: null,
      initial_leverage: null,
      final_realized_pnl: null,
      final_r_multiple: null,
      peak_unrealized_pnl: null,
      peak_drawdown: null,
      importance_weight: 0,
      notes: null,
      actual_evolution: [],
      deviation_notes: {
        'leg-1': {
          category: 'hedge_initial_a',
          reason: '入场价格低于谢林点、长期横盘、且存在一浅一深的支撑位，此时居然开单！而且还用了浅的支撑位作为止损位。',
          fix: '入场价格低于谢林点且长期横盘时，不能开单！更不能用浅的支撑位作为止损位。不能妄图所有好结果都与自己有关系！因为凡事皆有代价！',
        },
      },
      created_at: '2026-02-10T08:16:00.000Z',
      updated_at: '2026-02-10T12:03:00.000Z',
    } satisfies TradeCampaign,
  ]),
  listPatterns: vi.fn(async () => []),
  listPrinciples: vi.fn(async () => []),
  listRules: vi.fn(async () => [
    {
      id: 'rule-1',
      user_id: 'user-1',
      source_pattern_id: null,
      rule_text: '【战役偏离】 违规操作： hedge_initial_a：入场价格低于谢林点、长期横盘、且存在一浅一深的支撑位，此时居然开单！而且还用了浅的支撑位作为止损位。。 修正后的规则： 入场价格低于谢林点且长期横盘时，不能开单! 更不能用浅的支撑位作为止损位。不能妄图所有好结果都与自己有关系！因为凡事皆有代价！',
      is_active: true,
      added_to_checklist: true,
      trigger_threshold: null,
      required: false,
      rule_category: 'core',
      weight: 95,
      principle_id: null,
      evolution_level: 3,
      ui_order: 0,
      snooze_until: null,
      activated_at: null,
      created_at: '2026-06-30T04:00:00.000Z',
      updated_at: '2026-06-30T04:00:00.000Z',
    } satisfies TradingRule,
  ]),
  updateRule: mocks.updateRule,
}));

describe('JournalRulesPage campaign link', () => {
  it('lets deviation rules jump to their source campaign even when old text punctuation differs', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/rules']}>
        <Routes>
          <Route path="/journal/rules" element={<JournalRulesPage />} />
          <Route path="/journal/campaigns/:campaignId" element={<div>已进入战役详情</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: '跳到对应交易战役' });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    expect(await screen.findByText('已进入战役详情')).toBeInTheDocument();
  });
});
