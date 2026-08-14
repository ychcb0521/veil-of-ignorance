import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PGapPanel } from '@/components/PGapPanel';

function setPrices(k: number, t: number) {
  fireEvent.change(screen.getByTestId('p-gap-stop-number'), { target: { value: String(k) } });
  fireEvent.change(screen.getByTestId('p-gap-target-number'), { target: { value: String(t) } });
}

function setSurvival(pct: number) {
  fireEvent.change(screen.getByTestId('p-gap-survival-number'), { target: { value: String(pct) } });
}

function setBreakout(pct: number) {
  fireEvent.change(screen.getByTestId('p-gap-breakout-number'), { target: { value: String(pct) } });
}

function setDeadBreakout(pct: number) {
  fireEvent.change(screen.getByTestId('p-gap-dead-breakout-number'), { target: { value: String(pct) } });
}

/**
 * 让 P 恰为 pct：P₁=pct、P₂=100%、P₃=0 ⇒ P = pct·1 + (1−pct)·0 = pct。
 * 旧用例的 gap 断言语义因此完全不变。
 */
function setWinRate(pct: number) {
  setSurvival(pct);
  setBreakout(100);
  setDeadBreakout(0);
}

describe('PGapPanel', () => {
  // P_gap 的手填量按标的存进 localStorage；用例之间必须互不继承。
  beforeEach(() => localStorage.clear());

  it('S 居中时 P₀ 为 50%，P 高于基线给出绿色优势边际', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    setWinRate(60);

    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('50.0%');
    const gap = screen.getByTestId('p-gap-value');
    expect(gap).toHaveTextContent('+10.0%');
    expect(gap).toHaveAttribute('data-gap-sign', 'positive');
    expect(gap).toHaveStyle({ color: '#0ECB81' });
    // 「优势边际」与数值同处一行，合起来读作「优势边际 +10.0%」
    expect(gap.closest('div')).toHaveTextContent('优势边际');
    expect(screen.getByText('市场免费给你的胜率，P 必须高于它')).toBeInTheDocument();
  });

  it('P 不高于基线时显示优势已耗尽并转红', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    setWinRate(50);

    const gap = screen.getByTestId('p-gap-value');
    expect(gap).toHaveTextContent('优势已耗尽');
    expect(gap).toHaveAttribute('data-gap-sign', 'non-positive');
    expect(gap).toHaveStyle({ color: '#F6465D' });
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
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('请填写 P₁ / P₂ / P₃');
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('待填');
  });

  it('T === K 时退化，不出数字', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(100, 100);
    expect(screen.getByTestId('p-gap-invalid')).toHaveTextContent('基线概率无意义');
    expect(screen.queryByTestId('p-gap-baseline')).not.toBeInTheDocument();
  });

  it('S 冲破止损时 P₀ 转负仍显示，但不再判「方向不成立」', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    // K=101 已在现价之上：S 冲破止损 → P₀ =（100−101）÷（110−101）≈ −11.1%
    setPrices(101, 110);
    expect(screen.queryByTestId('p-gap-invalid')).not.toBeInTheDocument();
    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('-11.1%');
  });

  it('触及止损后不显示优势——K=90/T=110/S=80 不得读作「+122%」', () => {
    // 现价 80 已跌破止损 90：即便填了 P=72%，也不能拿负的 P₀ 去相减
    render(<PGapPanel currentPrice={80} pricePrecision={2} />);
    setPrices(90, 110);
    setSurvival(90);
    setBreakout(80);
    setDeadBreakout(0); // P = 0.9×0.8 + 0.1×0 = 72%

    const gap = screen.getByTestId('p-gap-value');
    expect(gap).toHaveTextContent('已触及止损 K');
    expect(gap).toHaveAttribute('data-gap-sign', 'stop-breached');
    expect(gap.textContent).not.toContain('122');
    expect(gap.textContent).not.toContain('%');
    // P₀ 的越界值仍然显示，用于说明价格跑出区间多远
    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('-50.0%');
    // P 本身照常算，只是不再参与 gap
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('72.0%');
  });

  it('价格回到止损之上，优势边际立即恢复出数', () => {
    const { rerender } = render(<PGapPanel currentPrice={80} pricePrecision={2} />);
    setPrices(90, 110);
    setSurvival(90);
    setBreakout(80);
    setDeadBreakout(0);
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('已触及止损 K');

    rerender(<PGapPanel currentPrice={100} pricePrecision={2} />);
    // P₀=50%、P=72% → gap=+22%
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('+22.0%');
  });

  it('越过目标 T 不特判：P₀ 超 100% 自然读作优势已耗尽', () => {
    render(<PGapPanel currentPrice={120} pricePrecision={2} />);
    setPrices(90, 110);
    setSurvival(90);
    setBreakout(80);
    setDeadBreakout(0);
    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('150.0%');
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('优势已耗尽');
  });

  it('空头 T < S < K 同样成立', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(110, 90);
    setWinRate(60);

    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('50.0%');
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('+10.0%');
  });

  it('默认完整显示，不折叠', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} onToggleCollapsed={() => {}} />);
    expect(screen.getByTestId('p-gap-panel')).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByTestId('p-gap-collapse-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('p-gap-stop-number')).toBeInTheDocument();
  });

  it('折叠后只留表头，并把 gap 读数收进表头', () => {
    const { rerender } = render(
      <PGapPanel currentPrice={100} pricePrecision={2} onToggleCollapsed={() => {}} />,
    );
    setPrices(90, 110);
    setWinRate(60);

    rerender(<PGapPanel currentPrice={100} pricePrecision={2} collapsed onToggleCollapsed={() => {}} />);
    expect(screen.getByTestId('p-gap-panel')).toHaveAttribute('data-collapsed', 'true');
    // 输入区与大读数都收起
    expect(screen.queryByTestId('p-gap-stop-number')).not.toBeInTheDocument();
    expect(screen.queryByTestId('p-gap-baseline')).not.toBeInTheDocument();
    // 但仪表仍在说话
    expect(screen.getByTestId('p-gap-collapsed-value')).toHaveTextContent('+10.0%');
  });

  it('折叠按钮低调但可点', () => {
    const onToggleCollapsed = vi.fn();
    render(<PGapPanel currentPrice={100} pricePrecision={2} onToggleCollapsed={onToggleCollapsed} />);
    const toggle = screen.getByTestId('p-gap-collapse-toggle');
    expect(toggle.className).toContain('opacity-30');
    fireEvent.click(toggle);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('P 按全概率公式：P₁P₂ +（1−P₁)P₃', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    setSurvival(90);
    setBreakout(80);
    setDeadBreakout(20);
    // 0.9×0.8 + 0.1×0.2 = 0.72 + 0.02 = 74%
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('74.0%');
    // P₃=0 时退化回旧的纯乘积：0.9×0.4 = 36%
    setBreakout(40);
    setDeadBreakout(0);
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('36.0%');
    // P₀=50%，P=36% → gap 为负 → 优势已耗尽
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('优势已耗尽');
  });

  it('P₃ 只会把 P 抬高，绝不使其为负或越过 100%', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    // 若误写成减法，P₁=50%、P₂=40%、P₃=80% 会得到 −20%
    setSurvival(50);
    setBreakout(40);
    setDeadBreakout(80);
    // 正解：0.5×0.4 + 0.5×0.8 = 0.2 + 0.4 = 60%
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('60.0%');
    expect(screen.getByTestId('p-gap-computed-p').textContent).not.toContain('-');

    // 三项全为 100% 时恰好封顶在 100%，不越界
    setSurvival(100); setBreakout(100); setDeadBreakout(100);
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('100.0%');
  });

  it('任一项变化时 P 实时更新，且没有可手改 P 的输入框', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    setSurvival(90);
    setBreakout(40);
    setDeadBreakout(0);
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('36.0%');
    setBreakout(80);
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('72.0%');
    setSurvival(50);
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('40.0%');
    // 改 P₃ 同样实时反映：0.5×0.8 + 0.5×0.6 = 70%
    setDeadBreakout(60);
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('70.0%');
    // P 只读：不存在旧的 winrate 输入框
    expect(screen.queryByTestId('p-gap-winrate-number')).not.toBeInTheDocument();
  });

  it('三项未填齐时 P 不出数，gap 同样等待', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 110);
    setSurvival(90);
    setBreakout(80); // 仍缺 P₃
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('待填');
    expect(screen.getByTestId('p-gap-value')).toHaveTextContent('请填写 P₁ / P₂ / P₃');
  });

  it('战役整体胜率仅作参考展示，不再落种、不可点击回填', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} defaultWinRatePct={62} winRateSampleCount={23} />);
    // 不落种：两项输入为空、P 为占位
    expect(screen.getByTestId('p-gap-survival-number')).toHaveValue(null);
    expect(screen.getByTestId('p-gap-breakout-number')).toHaveValue(null);
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('待填');
    const source = screen.getByTestId('p-gap-winrate-source');
    expect(source).toHaveTextContent('参考：本账号战役整体胜率 62%（n=23）');
    expect(source.tagName).not.toBe('BUTTON');
  });

  it('无战役胜率时参考行隐藏', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} defaultWinRatePct={null} />);
    expect(screen.queryByTestId('p-gap-winrate-source')).not.toBeInTheDocument();
  });

  it('说明浮层默认隐藏，点开后给出每个指标的算法与作用', async () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    expect(screen.queryByTestId('p-gap-help-content')).not.toBeInTheDocument();

    const help = screen.getByTestId('p-gap-help');
    expect(help.className).toContain('opacity-25');
    fireEvent.click(help);

    const content = await screen.findByTestId('p-gap-help-content');
    expect(content).toHaveTextContent('P₀ = (S − K) ÷ (T − K)');
    expect(content).toHaveTextContent('gap = P − P₀');
    expect(content).toHaveTextContent('市场免费给你的胜率');
    expect(content).toHaveTextContent('优势已耗尽');
    expect(content).toHaveTextContent('T 在 K 之上为多头');
    expect(content).toHaveTextContent('P₁·P₂ + (1−P₁)·P₃');
  });

  it('显示动态赔率 b =（T − S）÷（S − K）', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 120); // 赚 20 / 亏 10 → b = 2
    expect(screen.getByTestId('p-gap-payoff-ratio')).toHaveTextContent('b 2.00');
  });

  it('b 是低调入口：点开呈现盈亏平衡胜率曲线，且门槛与 P₀ 一致', async () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    setPrices(90, 120);
    setWinRate(60);
    expect(screen.queryByTestId('p-gap-payoff-chart')).not.toBeInTheDocument();

    const entry = screen.getByTestId('p-gap-payoff-ratio');
    expect(entry.className).toContain('opacity-60');
    fireEvent.click(entry);

    const chart = await screen.findByTestId('p-gap-payoff-chart');
    expect(chart).toHaveTextContent('P = 1 ÷ (1 + b)');
    expect(screen.getByTestId('break-even-curve')).toBeInTheDocument();
    // 恒等式：b=2 的平衡胜率 33.3% 即面板的基线概率 P₀
    expect(screen.getByTestId('break-even-rate')).toHaveTextContent('33.3%');
    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('33.3%');
    // 你的优势 = P − 门槛 = 60% − 33.3%
    expect(screen.getByTestId('break-even-edge')).toHaveTextContent('+26.7%');
  });

  it('b 可落袋：此刻立即止盈能拿到几个 R', () => {
    // 开仓 100、止损 90 → 每 R = 10；现价 115 → +1.5R
    render(<PGapPanel currentPrice={115} pricePrecision={2} longEntryPrice={100} longPositionCount={1} />);
    setPrices(90, 130);
    const bankable = screen.getByTestId('p-gap-bankable');
    expect(bankable).toHaveTextContent('+1.50R');
    expect(bankable).toHaveAttribute('data-bankable-state', 'positive');
    expect(bankable).toHaveStyle({ color: '#0ECB81' });
    expect(screen.getByText(/开仓 100\.00/)).toBeInTheDocument();
  });

  it('现价跌回开仓价下方时落袋即亏，转红', () => {
    render(<PGapPanel currentPrice={95} pricePrecision={2} longEntryPrice={100} longPositionCount={1} />);
    setPrices(90, 130);
    const bankable = screen.getByTestId('p-gap-bankable');
    expect(bankable).toHaveTextContent('-0.50R');
    expect(bankable).toHaveAttribute('data-bankable-state', 'negative');
    expect(bankable).toHaveStyle({ color: '#F6465D' });
  });

  it('没有多单时明说「当前无多单」，不臆造 R', () => {
    render(<PGapPanel currentPrice={115} pricePrecision={2} />);
    setPrices(90, 130);
    const bankable = screen.getByTestId('p-gap-bankable');
    expect(bankable).toHaveTextContent('当前无多单');
    expect(bankable).toHaveAttribute('data-bankable-state', 'none');
  });

  it('K₀ 不在开仓价下方时不出数——预期最大亏损无意义', () => {
    // 无锚可用 → 退回情景 K=105，高于开仓价 → 不出数并提示
    render(<PGapPanel currentPrice={115} pricePrecision={2} longEntryPrice={100} longPositionCount={1} />);
    setPrices(105, 130);
    expect(screen.getByTestId('p-gap-bankable')).toHaveTextContent('K₀ 需低于开仓价');
  });

  it('K₀ 默认取该多单最早设定的止损，不跟随面板情景 K', () => {
    render(<PGapPanel currentPrice={115} pricePrecision={2} longEntryPrice={100} longPositionCount={1} longRiskAnchorPrice={90} />);
    // 情景 K 拖到开仓价上方——以前这会杀掉读数；现在分母用锚 K₀=90，照常出数
    setPrices(105, 130);
    expect(screen.getByTestId('p-gap-riskk-number')).toHaveValue(90);
    expect(screen.getByTestId('p-gap-bankable')).toHaveTextContent('+1.50R');
  });

  it('K₀ 可手动修改，修改立即生效', () => {
    render(<PGapPanel currentPrice={115} pricePrecision={2} longEntryPrice={100} longPositionCount={1} longRiskAnchorPrice={90} />);
    setPrices(90, 130);
    fireEvent.change(screen.getByTestId('p-gap-riskk-number'), { target: { value: '95' } });
    // 每 R 从 10 变 5 → +3.00R
    expect(screen.getByTestId('p-gap-bankable')).toHaveTextContent('+3.00R');
    // 清空 → 恢复默认锚 90 → +1.50R
    fireEvent.change(screen.getByTestId('p-gap-riskk-number'), { target: { value: '' } });
    expect(screen.getByTestId('p-gap-bankable')).toHaveTextContent('+1.50R');
  });

  it('无可追溯止损时退回面板情景 K；换标的得到该标的自己的存档', () => {
    const { rerender } = render(
      <PGapPanel currentPrice={115} pricePrecision={2} longEntryPrice={100} longPositionCount={1} symbol="AUSDT" />,
    );
    setPrices(90, 130); // 无锚 → 用情景 K=90
    expect(screen.getByTestId('p-gap-bankable')).toHaveTextContent('+1.50R');

    fireEvent.change(screen.getByTestId('p-gap-riskk-number'), { target: { value: '95' } });
    expect(screen.getByTestId('p-gap-bankable')).toHaveTextContent('+3.00R');

    // 换标的 → BUSDT 尚无存档，价格重新起手、手动锚不跟随
    rerender(
      <PGapPanel currentPrice={115} pricePrecision={2} longEntryPrice={100} longPositionCount={1} symbol="BUSDT" />,
    );
    expect(screen.getByTestId('p-gap-stop-number')).toHaveValue(112.7);

    // 切回 AUSDT → 原存档（含手动锚 95）原样恢复
    rerender(
      <PGapPanel currentPrice={115} pricePrecision={2} longEntryPrice={100} longPositionCount={1} symbol="AUSDT" />,
    );
    expect(screen.getByTestId('p-gap-riskk-number')).toHaveValue(95);
    expect(screen.getByTestId('p-gap-bankable')).toHaveTextContent('+3.00R');
  });

  it('刷新页面后同一标的的填写原样恢复', () => {
    const { unmount } = render(
      <PGapPanel currentPrice={100} pricePrecision={2} symbol="AUSDT" longEntryPrice={95} longPositionCount={1} />,
    );
    setPrices(90, 130);
    setSurvival(91.5);
    setBreakout(78.5);
    setDeadBreakout(12);
    // 0.915×0.785 + 0.085×0.12 = 0.71828 + 0.0102 = 72.8%
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('72.8%');

    // 卸载再挂载 = 刷新页面（状态只存在 localStorage 里）
    unmount();
    render(
      <PGapPanel currentPrice={100} pricePrecision={2} symbol="AUSDT" longEntryPrice={95} longPositionCount={1} />,
    );
    expect(screen.getByTestId('p-gap-stop-number')).toHaveValue(90);
    expect(screen.getByTestId('p-gap-target-number')).toHaveValue(130);
    expect(screen.getByTestId('p-gap-survival-number')).toHaveValue(91.5);
    expect(screen.getByTestId('p-gap-breakout-number')).toHaveValue(78.5);
    expect(screen.getByTestId('p-gap-dead-breakout-number')).toHaveValue(12);
    expect(screen.getByTestId('p-gap-computed-p')).toHaveTextContent('72.8%');
  });

  it('多笔多单标注为均价', () => {
    render(<PGapPanel currentPrice={115} pricePrecision={2} longEntryPrice={100} longPositionCount={3} />);
    setPrices(90, 130);
    expect(screen.getByText(/3 笔均价/)).toBeInTheDocument();
  });

  it('gap 只做 P 对 P₀ 的几何对比，不与持仓成本价比较', () => {
    // 持多单开仓 100、S=95 已浮亏。K=90,T=130 → P₀=5/40=12.5%，P=60% → gap=+47.5%
    // 浮亏与否不参与 gap：读数照常为正绿，不加负号、不换色。
    render(<PGapPanel currentPrice={95} pricePrecision={2} longEntryPrice={100} longPositionCount={1} longRiskAnchorPrice={90} />);
    setPrices(90, 130);
    setWinRate(60);

    const gap = screen.getByTestId('p-gap-value');
    expect(gap).toHaveTextContent('+47.5%');
    expect(gap.textContent).not.toContain('−');
    expect(gap).toHaveAttribute('data-gap-sign', 'positive');
    expect(gap).toHaveStyle({ color: '#0ECB81' });
    // P₀ 恒为正；优势条按原始正 gap 满格
    expect(screen.getByTestId('p-gap-baseline')).toHaveTextContent('12.5%');
    expect(screen.getByTestId('p-gap-bar')).toHaveAttribute('data-remaining', '1.0000');
    // 持仓盈亏另有其表：b 可落袋照常显示浮亏
    expect(screen.getByTestId('p-gap-bankable')).toHaveTextContent('-0.50R');
  });

  it('无论持仓浮盈浮亏，同样的 S/K/T/P 给出同样的 gap', () => {
    const { rerender } = render(
      <PGapPanel currentPrice={95} pricePrecision={2} longEntryPrice={100} longPositionCount={1} longRiskAnchorPrice={90} />,
    );
    setPrices(90, 130);
    setWinRate(60);
    const underwaterGap = screen.getByTestId('p-gap-value').textContent;

    // 换成浮盈持仓（开仓价降到 92），gap 不应有任何变化
    rerender(<PGapPanel currentPrice={95} pricePrecision={2} longEntryPrice={92} longPositionCount={1} longRiskAnchorPrice={90} />);
    expect(screen.getByTestId('p-gap-value').textContent).toBe(underwaterGap);

    // 完全无持仓，同样不变
    rerender(<PGapPanel currentPrice={95} pricePrecision={2} />);
    expect(screen.getByTestId('p-gap-value').textContent).toBe(underwaterGap);
  });

  it('折叠表头读数同样只反映 gap 本身', () => {
    const { rerender } = render(
      <PGapPanel currentPrice={95} pricePrecision={2} longEntryPrice={100} longPositionCount={1}
        longRiskAnchorPrice={90} onToggleCollapsed={() => {}} />,
    );
    setPrices(90, 130);
    setWinRate(60);
    rerender(
      <PGapPanel currentPrice={95} pricePrecision={2} longEntryPrice={100} longPositionCount={1}
        longRiskAnchorPrice={90} collapsed onToggleCollapsed={() => {}} />,
    );
    const collapsed = screen.getByTestId('p-gap-collapsed-value');
    expect(collapsed).toHaveTextContent('+47.5%');
    expect(collapsed).toHaveStyle({ color: '#0ECB81' });
  });


  it('是独立模块：自带 P_gap 表头，不再寄居在成交页签里', () => {
    render(<PGapPanel currentPrice={100} pricePrecision={2} />);
    expect(screen.getByText('P_gap')).toBeInTheDocument();
    expect(screen.getByText('优势边际')).toBeInTheDocument();
    // 成交流水的表头不属于这个模块
    expect(screen.queryByText('价格(USDT)')).not.toBeInTheDocument();
  });
});
