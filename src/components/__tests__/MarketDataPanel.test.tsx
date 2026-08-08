import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketDataPanel, type MarketDataTab } from '@/components/MarketDataPanel';

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({ getSymbolSettlementMode: () => 'usdt' }),
}));

function renderPanel(overrides: Partial<React.ComponentProps<typeof MarketDataPanel>> = {}) {
  const props = {
    symbol: 'BTCUSDT',
    currentPrice: 100,
    pricePrecision: 2,
    tab: 'orderBook' as MarketDataTab,
    onTabChange: vi.fn(),
    collapsed: true,
    onToggleCollapsed: vi.fn(),
    ...overrides,
  };
  return { ...render(<MarketDataPanel {...props} />), props };
}

describe('MarketDataPanel', () => {
  it('三个页签合并在一个模块里，顺序为订单簿 / 最新成交 / 市场异动', () => {
    renderPanel();
    expect(
      ['orderBook', 'trades', 'movers'].map(key => screen.getByTestId(`market-tab-${key}`).textContent),
    ).toEqual(['订单簿', '最新成交', '市场异动']);
  });

  it('折叠时只剩表头，不渲染任何盘口内容', () => {
    renderPanel({ collapsed: true });
    expect(screen.getByTestId('market-data-panel')).toHaveAttribute('data-collapsed', 'true');
    // 订单簿的列头与成交流水都不应存在
    expect(screen.queryByText('市场异动 · 即将上线')).not.toBeInTheDocument();
    expect(screen.queryByText(/合计\(/)).not.toBeInTheDocument();
    expect(screen.getByTestId('market-collapse-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('展开后渲染当前页签内容', () => {
    renderPanel({ collapsed: false, tab: 'movers' });
    expect(screen.getByText('市场异动 · 即将上线')).toBeInTheDocument();
    expect(screen.getByTestId('market-collapse-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('折叠状态下点页签＝选中并展开，省一次点击', () => {
    const { props } = renderPanel({ collapsed: true });
    fireEvent.click(screen.getByTestId('market-tab-trades'));
    expect(props.onTabChange).toHaveBeenCalledWith('trades');
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('已展开时点页签只切换，不会误折叠', () => {
    const { props } = renderPanel({ collapsed: false, tab: 'orderBook' });
    fireEvent.click(screen.getByTestId('market-tab-movers'));
    expect(props.onTabChange).toHaveBeenCalledWith('movers');
    expect(props.onToggleCollapsed).not.toHaveBeenCalled();
  });

  it('订单簿嵌入时不重复渲染自带表头', () => {
    renderPanel({ collapsed: false, tab: 'orderBook' });
    // 模块表头里的「订单簿」是页签；OrderBook 自带的标题被 hideHeader 隐藏
    expect(screen.getAllByText('订单簿')).toHaveLength(1);
  });
});
