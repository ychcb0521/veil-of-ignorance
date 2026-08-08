import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PGapPanel } from '@/components/PGapPanel';
import { RecentTrades } from '@/components/RecentTrades';

function setPrices(k: number, t: number) {
  fireEvent.change(screen.getByTestId('p-gap-stop-number'), { target: { value: String(k) } });
  fireEvent.change(screen.getByTestId('p-gap-target-number'), { target: { value: String(t) } });
}

function setWinRate(pct: number) {
  fireEvent.change(screen.getByTestId('p-gap-winrate-number'), { target: { value: String(pct) } });
}

describe('PGapPanel', () => {
  it('S 居中时 P₀ 为 50%，P 高于基线给出绿色优势边际', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    setWinRate(60);

    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('50.0%');
    const gap = screen.getByTestId('p-gap-value');
    expect(gap).toHaveTextContent('优势边际 +10.0%');
    expect(gap).toHaveAttribute('data-gap-sign', 'positive');
    expect(gap.className).toContain('text-trading-green');
    expect(screen.getByText('市场免费给你的胜率，P 必须高于它')).toBeInTheDocument();
  });

  it('P 不高于基线时显示优势已耗尽并转红', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    setWinRate(50);

    const gap = screen.getByTestId('p-gap-value');
    expect(gap).toHaveTextContent('优势已耗尽');
    expect(gap).toHaveAttribute('data-gap-sign', 'non-positive');
    expect(gap.className).toContain('text-trading-red');
  });

  it('S 随行情跳动即时重算：基线抬高、优势条向零收缩', () => {
    const { rerender } = render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    setWinRate(60);
    expect(screen.getByTestId('p-gap-bar')).toHaveAttribute('data-remaining', '1.0000');

    // 价格向目标推进 → P₀ 从 50% 抬到 70%，gap 由 +10% 收缩到 −10%
    rerender(<PGapPanel currentPrice={104} pricePrecision={2} />);
    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('70.0%');
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('优势已耗尽');
    expect(screen.getByTestId('p-gap-bar')).toHaveAttribute('data-remaining', '0.0000');
  });

  it('P 未给出时只显示基线，不臆造 gap', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);

    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('50.0%');
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('请给出主观胜率 P');
    expect(screen.getByTestId('p-gap-winrate-number')).toHaveValue(null);
  });

  it('T === K 与方向不成立时不出数字，只出提示', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);

    setPrices(100, 100);
    expect(screen.getByTestId('p-gap-invalid')).toHaveTextContent('基线概率无意义');
    expect(screen.queryByTestId('p-gap-baseline')).not.toBeInTheDocument();

    // S 落在 K、T 同侧：多头 K<S<T 与空头 T<S<K 均不成立
    setPrices(101, 110);
    expect(screen.getByTestId('p-gap-invalid')).toHaveTextContent('方向不成立');
    expect(screen.queryByTestId('p-gap-value')).not.toBeInTheDocument();
  });

  it('空头 T < S < K 同样成立', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(110, 90);
    setWinRate(60);

    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('50.0%');
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('优势边际 +10.0%');
  });

  it('作为第三个页签挂在最新成交/市场异动之后，且默认选中', () => {
    render(<RecentTrades currentPrice={100} pricePrecision={2} />);

    const tabLabels = Array.from(
      screen.getByTestId('p-gap-tab').parentElement?.querySelectorAll('button') ?? [],
    ).map(node => node.textContent);
    expect(tabLabels).toEqual(['最新成交', '市场异动', 'P_gap']);

    // 默认就停在 P_gap 上，无需点击
    expect(screen.getByTestId('p-gap-panel')).toBeInTheDocument();
    expect(screen.queryByText('价格(USDT)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('最新成交'));
    expect(screen.queryByTestId('p-gap-panel')).not.toBeInTheDocument();
    expect(screen.getByText('价格(USDT)')).toBeInTheDocument();
  });
});
