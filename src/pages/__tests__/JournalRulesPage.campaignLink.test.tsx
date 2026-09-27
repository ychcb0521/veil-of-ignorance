import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import JournalRulesPage from '../JournalRulesPage';
import type { TradeCampaign, TradingRule } from '@/types/journal';

const mocks = vi.hoisted(() => ({
  authValue: { user: { id: 'user-1' } },
  bindLocalTradingRuleSourceCampaign: vi.fn(),
  sourceIndex: {
    byText: {} as Record<string, string>,
    byRuleId: {} as Record<string, string>,
  },
  ruleText: '【战役偏离】 违规操作： hedge_initial_a：入场价格低于谢林点、长期横盘、且存在一浅一深的支撑位，此时居然开单！而且还用了浅的支撑位作为止损位。。 修正后的规则： 入场价格低于谢林点且长期横盘时，不能开单! 更不能用浅的支撑位作为止损位。不能妄图所有好结果都与自己有关系！因为凡事皆有代价！',
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  activeCampaigns: [] as unknown[],
  activatedAt: null as string | null,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mocks.authValue,
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({ tradeHistory: [], ordersMap: {}, filledOrders: [], positionsMap: {} }),
}));

// 战役列表缓存：操作时间按腿上的客观操作时间算（与战役列表同一个函数）
const listRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/hooks/useCampaignList', () => ({
  useCampaignList: () => ({ rows: listRows.rows }),
}));

vi.mock('@/lib/journalApi', () => ({
  bindLocalTradingRuleSourceCampaign: mocks.bindLocalTradingRuleSourceCampaign,
  createPrinciple: vi.fn(),
  deleteRule: mocks.deleteRule,
  getLocalTradingRuleSourceCampaignIndex: vi.fn(() => mocks.sourceIndex),
  listActiveCampaigns: vi.fn(async () => mocks.activeCampaigns),
  listAllCampaigns: vi.fn(async () => [
    {
      id: 'campaign-1',
      user_id: 'user-1',
      campaign_code: 'C00000001',
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
      rule_text: mocks.ruleText,
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
      activated_at: mocks.activatedAt,
      created_at: '2026-06-30T04:00:00.000Z',
      updated_at: '2026-06-30T04:00:00.000Z',
    } satisfies TradingRule,
  ]),
  updateRule: mocks.updateRule,
}));

describe('JournalRulesPage campaign link', () => {
  beforeEach(() => {
    mocks.bindLocalTradingRuleSourceCampaign.mockClear();
    mocks.sourceIndex = { byText: {}, byRuleId: {} };
    mocks.ruleText = '【战役偏离】 违规操作： hedge_initial_a：入场价格低于谢林点、长期横盘、且存在一浅一深的支撑位，此时居然开单！而且还用了浅的支撑位作为止损位。。 修正后的规则： 入场价格低于谢林点且长期横盘时，不能开单! 更不能用浅的支撑位作为止损位。不能妄图所有好结果都与自己有关系！因为凡事皆有代价！';
    mocks.bindLocalTradingRuleSourceCampaign.mockImplementation((_userId: string, ruleId: string, campaignId: string) => {
      mocks.sourceIndex = {
        ...mocks.sourceIndex,
        byRuleId: {
          ...mocks.sourceIndex.byRuleId,
          [ruleId]: campaignId,
        },
      };
    });
  });

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
    expect(mocks.bindLocalTradingRuleSourceCampaign).toHaveBeenCalledWith('user-1', 'rule-1', 'campaign-1');
  });

  it('keeps the campaign link after the rule text is edited', async () => {
    mocks.sourceIndex = { byText: {}, byRuleId: { 'rule-1': 'campaign-1' } };
    mocks.ruleText = '这条规则文字已经被手动重写，但来源战役仍然应该保持绑定';

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
    expect(mocks.bindLocalTradingRuleSourceCampaign).not.toHaveBeenCalled();
  });
});

describe('【用户要求】每行一个不显眼的小按钮：编辑与删除', () => {
  const renderPage = () => render(
    <MemoryRouter initialEntries={['/journal/rules']}>
      <Routes>
        <Route path="/journal/rules" element={<JournalRulesPage />} />
      </Routes>
    </MemoryRouter>,
  );

  beforeEach(() => {
    mocks.updateRule.mockReset();
    mocks.deleteRule.mockReset();
    mocks.activeCampaigns = [];
    mocks.activatedAt = null;
    mocks.ruleText = '原来的规则文字';
  });

  it('点铅笔原位改文字，保存写回；取消不写', async () => {
    renderPage();
    const edit = await screen.findByTestId('rule-edit');
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    const box = screen.getByLabelText('规则文字');
    fireEvent.change(box, { target: { value: '改过的规则文字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.updateRule).toHaveBeenCalledWith('rule-1', { rule_text: '改过的规则文字' }));
    expect(await screen.findByText('改过的规则文字')).toBeInTheDocument();
    expect(screen.queryByTestId('rule-editor')).not.toBeInTheDocument();
  });

  it('删除收在编辑里，要确认；确认后这一行消失', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    const edit = await screen.findByTestId('rule-edit');
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    fireEvent.click(screen.getByTestId('rule-delete'));
    expect(mocks.deleteRule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('rule-delete'));
    await waitFor(() => expect(mocks.deleteRule).toHaveBeenCalledWith('rule-1'));
    await waitFor(() => expect(screen.queryAllByTestId('rule-row')).toHaveLength(0));
    confirm.mockRestore();
  });

  it('刚激活 7 天冷却期内删除停用', async () => {
    mocks.activatedAt = new Date(Date.now() - 86_400_000).toISOString();
    renderPage();
    const edit = await screen.findByTestId('rule-edit');
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    expect(screen.getByTestId('rule-delete')).toBeDisabled();
  });

  it('有进行中的战役时规则冻结：铅笔停用', async () => {
    mocks.activeCampaigns = [{ id: 'active-1' }];
    renderPage();
    await screen.findByText('原来的规则文字');
    await waitFor(() => expect(screen.getByTestId('rule-edit')).toBeDisabled());
  });
});
