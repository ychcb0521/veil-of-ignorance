/**
 * 【用户要求】「请你检查交易战役里设计到的爆仓单子的逻辑，现在是错的，现在没有按照爆仓的特殊逻辑。」
 *
 * 战役页此前完全看不出一条腿是被强平的：状态只有已平仓 / 挂单中 / 进行中，
 * 而时间线与仓位面板早就有红色的「爆仓」标记。这里钉住三件事：
 *   · 角色标签上带一枚红色的「爆仓」（与挂单中的空心、进行中的圆点同一套画法）；
 *   · 平仓价格子说清「按破产价结算：亏损 = 保证金」——否则三个价格格子算出的 −920
 *     与盈亏列的 −1000 对不上，只有手续费提示能解释；
 *   · 强平价不在那一分钟 K 线里仍报「强平异常」，但盈亏与显示的平仓价都不按 K 线改——
 *     否则这一行会写着「平仓价 0.9900 / 涨跌幅 −1%」而盈亏是 −1000，三格与盈亏来自两对价。
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const at = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
const ms = (hhmm: string) => Date.parse(at(hhmm));

const legFor = (over: Partial<TradeJournal> & { id: string }): TradeJournal => ({
  user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'live', symbol: 'XUSDT', direction: 'long', leverage: 20, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: at('01:00'),
  created_at: at('00:00'), updated_at: at('00:00'),
  ...over,
} as TradeJournal);

/** 逐仓多单：1.0000 × 20,000 币、20 倍 → 保证金 1,000；破产价结算亏掉的恰好是这 1,000。 */
const liquidation: TradeRecord = {
  id: 'rec-liq',
  positionId: 'pos-liq',
  fillId: 'pos-liq',
  symbol: 'XUSDT',
  side: 'LONG',
  type: 'MARKET',
  action: 'LIQUIDATION',
  exit_method: 'liquidation',
  liquidationSettlement: 'bankruptcy',
  entryPrice: 1,
  exitPrice: 0.954,
  quantity: 20_000,
  leverage: 20,
  pnl: -1000,
  fee: 12,
  liquidationFeeUsd: 8,
  slippage: 0,
  openTime: ms('01:00'),
  closeTime: ms('02:00'),
} as TradeRecord;

const legs = (): TradeJournal[] => [
  legFor({ id: 'liq', trade_record_id: 'pos-liq', pre_entry_price: 1, pre_position_size: 20_000 }),
  legFor({
    id: 'normal', leg_sequence: 2, leg_role: 'main_add_1', trade_record_id: 'pos-normal',
    pre_entry_price: 1, pre_position_size: 1_000,
  }),
];

const normalClose = {
  ...liquidation,
  id: 'rec-normal',
  positionId: 'pos-normal',
  fillId: 'pos-normal',
  action: 'CLOSE',
  exit_method: 'sl',
  liquidationSettlement: undefined,
  quantity: 1_000,
  pnl: -46,
} as TradeRecord;

const renderList = (props: Partial<Parameters<typeof CampaignLegsList>[0]> = {}) => render(
  <MemoryRouter>
    <CampaignLegsList legs={legs()} tradeRecords={[liquidation, normalClose]} initialExpectedMaxLoss={1_000} {...props} />
  </MemoryRouter>,
);

const roleCell = (id: string) => screen.getByTestId(`leg-frozen-role-${id}`);
const chipOf = (id: string) => roleCell(id).querySelector<HTMLElement>('[data-role-chip]')!;

describe('【用户要求】Legs 表要认得出爆仓的腿', () => {
  it('爆仓腿：角色标签仍是自己的颜色，后面跟一枚红色的「爆仓」；悬停说明写清破产价结算', () => {
    renderList();
    const chip = chipOf('liq');
    expect(chip.dataset.status).toBe('liquidated');
    expect(chip.dataset.roleChip).toBe('main_open');
    const flag = chip.querySelector<HTMLElement>('[data-status-flag]')!;
    expect(flag.textContent).toBe('爆仓');
    expect(flag.className).toContain('text-[#F6465D]');
    // 角色本身还是绿的：这一行的例外是「爆仓」两个字，不是它的角色
    expect(chip.className).toContain('text-[#0ECB81]');
    expect(chip.getAttribute('title')).toContain('爆仓：交易所强制平仓');
    // 普通平仓的腿不带任何状态
    expect(chipOf('normal').dataset.status).toBeUndefined();
    expect(chipOf('normal').querySelector('[data-status-flag]')).toBeNull();
  });

  it('平仓价格子：说明「按破产价结算：亏损 = 保证金 1000.00 USDT」，普通平仓不挂这句话', () => {
    renderList();
    const title = screen.getByTestId('leg-exit-price-liq').getAttribute('title') ?? '';
    expect(title).toContain('按破产价结算');
    expect(title).toContain('1000.00 USDT');
    expect(title).toContain('与开仓价 / 平仓价的价差无关');
    expect(screen.getByTestId('leg-exit-price-normal').getAttribute('title')).toBeNull();
  });

  it('爆仓腿照常计入占比与合计（它是已平仓的一种，不是挂单）', () => {
    renderList();
    expect(screen.getByTestId('leg-position-share-liq')).toBeTruthy();
    expect(screen.getByTestId('legs-total-position-long')).toBeTruthy();
  });

  it('强平价不在那一分钟 K 线里：仍报「强平异常」，但格子里显示的仍是记录上的强平价', () => {
    renderList({
      legExitPriceCorrections: {
        liq: { exitPrice: 0.99, originalExitPrice: 0.954, candleLow: 0.98, candleHigh: 1.0 },
      },
    });
    const cell = screen.getByTestId('leg-exit-price-liq');
    expect(within(cell).getByTestId('leg-liquidation-anomaly')).toBeTruthy();
    // 显示的是 0.954（交易所的强平价），不是 K 线收盘 0.99——与这一行的盈亏 −1000 同一对价
    expect(cell.textContent).toContain('0.954');
    expect(cell.textContent).not.toContain('0.99');
    const title = cell.getAttribute('title') ?? '';
    expect(title).toContain('强平异常');
    expect(title).toContain('本格仍显示记录里的强平价');
    // 普通平仓的腿照常按 K 线改显示价
    renderList({
      legExitPriceCorrections: {
        normal: { exitPrice: 0.99, originalExitPrice: 0.954, candleLow: 0.98, candleHigh: 1.0 },
      },
    });
    expect(screen.getAllByTestId('leg-exit-price-normal')[1].textContent).toContain('0.99');
  });
});
