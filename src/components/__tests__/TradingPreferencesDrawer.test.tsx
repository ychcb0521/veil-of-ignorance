// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TradingPreferencesDrawer } from '@/components/TradingPreferencesDrawer';
import { DEFAULT_TRADING_PREFERENCES, type PanelKey, type TradingPreferences } from '@/lib/tradingPreferences';

/** 受控壳：真实复现「抽屉改 prefs → 父组件回传新 prefs」这条回路。 */
function Harness({ panels, onPanelChange }: {
  panels?: Record<PanelKey, boolean>;
  onPanelChange?: (key: PanelKey, visible: boolean) => void;
}) {
  const [prefs, setPrefs] = useState<TradingPreferences>(DEFAULT_TRADING_PREFERENCES);
  return (
    <TradingPreferencesDrawer
      open
      onClose={() => {}}
      prefs={prefs}
      onChange={setPrefs}
      panels={panels}
      onPanelChange={onPanelChange}
    />
  );
}

const openPage = (label: string) => {
  fireEvent.click(screen.getAllByText((_, el) => el?.textContent?.trim().startsWith(label) === true
    && el.tagName === 'BUTTON')[0]);
};

describe('TradingPreferencesDrawer', () => {
  it('首页条目与顺序对齐币安', () => {
    render(<Harness />);
    const labels = ['账户模式', '下单确认', '仓位模式', '资产模式', '默认交易设置',
      '价差保护', '订单修改', '通知设置', '涨跌幅与图表时区'];
    for (const label of labels) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('拨动开关后停在原页，不被弹回首页', () => {
    // 回归用例：重置 effect 曾把 prefs 列进依赖，而抽屉自己就是 prefs 的写方，
    // 于是每拨一次开关就自触发一次「回到首页」。
    render(<Harness />);
    openPage('下单确认');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('下单确认');

    const toggle = screen.getByRole('switch', { name: '市价 订单' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('下单确认');
    expect(screen.getByRole('switch', { name: '市价 订单' })).toHaveAttribute('aria-checked', 'true');
  });

  it('默认触发类型可切到标记价格并在首页回显', () => {
    render(<Harness />);
    openPage('默认交易设置');
    expect(screen.getByText('最新价格')).toBeInTheDocument();
    openPage('默认触发类型');
    fireEvent.click(screen.getByTestId('trigger-type-MARK'));
    expect(screen.getByTestId('prefs-back')).toBeInTheDocument(); // 仍在该页
    fireEvent.click(screen.getByTestId('prefs-back'));
    expect(screen.getByText('标记价格')).toBeInTheDocument();
  });

  it('杠杆页是草稿式的：点确认前不写回偏好', () => {
    const onChange = vi.fn();
    render(
      <TradingPreferencesDrawer open onClose={() => {}} prefs={DEFAULT_TRADING_PREFERENCES} onChange={onChange} />,
    );
    openPage('默认交易设置');
    openPage('默认杠杆和保证金模式');
    fireEvent.click(screen.getByTestId('pref-margin-cross'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('pref-confirm'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ defaultMarginMode: 'cross' }));
  });

  it('杠杆页写明全仓仍会被硬阻断——设置不得与硬约束互相矛盾', () => {
    render(<Harness />);
    openPage('默认交易设置');
    openPage('默认杠杆和保证金模式');
    expect(screen.getByText(/强制逐仓/)).toBeInTheDocument();
  });

  it('模块显隐把开关交给交易页，不自存一份', () => {
    const onPanelChange = vi.fn();
    render(<Harness panels={{ orderBook: true, pGap: false }} onPanelChange={onPanelChange} />);
    fireEvent.click(screen.getByTestId('prefs-tab-ui'));
    expect(screen.getByRole('switch', { name: '订单簿' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'P_gap 优势边际' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('switch', { name: '订单簿' }));
    expect(onPanelChange).toHaveBeenCalledWith('orderBook', false);
  });

  it('重置为默认布局把所有面板打开', () => {
    const onPanelChange = vi.fn();
    render(<Harness panels={{ orderBook: false, pGap: false }} onPanelChange={onPanelChange} />);
    fireEvent.click(screen.getByTestId('prefs-tab-ui'));
    fireEvent.click(screen.getByTestId('reset-layout'));
    expect(onPanelChange).toHaveBeenCalledWith('orderBook', true);
    expect(onPanelChange).toHaveBeenCalledWith('pGap', true);
  });

  it('本系统无对应的页面照样打得开，并说明为何不可用', () => {
    render(<Harness />);
    for (const [entry, marker] of [['账户模式', /统一账户/], ['资产模式', /联合保证金/],
      ['价差保护', /误伤止盈止损策略/], ['涨跌幅与图表时区', /UTC\+8/]] as const) {
      openPage(entry);
      expect(screen.getAllByText(marker).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByTestId('prefs-back'));
    }
  });
});
