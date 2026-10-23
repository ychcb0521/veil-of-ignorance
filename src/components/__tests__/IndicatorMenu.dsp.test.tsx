import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IndicatorMenu } from '@/components/IndicatorMenu';
import type { IndicatorConfig } from '@/components/CandlestickChart';

function open(indicators: IndicatorConfig[]) {
  const onIndicatorsChange = vi.fn();
  render(<IndicatorMenu open indicators={indicators} onIndicatorsChange={onIndicatorsChange} onClose={() => {}} />);
  return onIndicatorsChange;
}

describe('【用户要求】动态谢林点：可以隐去主图的 DSP 线，只要 a / A 副图', () => {
  it('【用户要求】名称下面注明 a 的定义，悬停给出计算步骤（主图入口保留）', () => {
    open([]);
    const defs = screen.getAllByText(/买方推力漂移速度 DSP·a：共识价每根 K 线往上/);
    expect(defs).toHaveLength(1);
    for (const d of defs) {
      expect(d.getAttribute('title')).toContain('⑥ 买方推力漂移速度 aₜ = ρ·aₜ₋₁ + (1 − ρ)·Fₜ');
      expect(d.getAttribute('title')).toContain('a = 2.24 基点 / 根');
    }
  });

  it('面板底部显示当前页面的版本号（用来核对 Lovable 是否已发布）', async () => {
    const { BUILD_STAMP } = await import('@/lib/buildStamp');
    open([]);
    expect(screen.getByTestId('indicator-menu-build').textContent).toBe(BUILD_STAMP.replace('veil-build:', '版本 '));
  });

  it('隐藏普通 DSP·a，保留 Z 分数版和含主图 DSP 入口', () => {
    open([]);
    expect(screen.queryByText('买方推力漂移速度 DSP·a')).not.toBeInTheDocument();
    expect(screen.getByText('DSP·az')).toBeInTheDocument();
    expect(screen.getByText('动态谢林点 DSP（含 a / A 副图）')).toBeInTheDocument();
  });

  it('保留的 Z 分数版可独立添加，不影响已有主图和其他指标', () => {
    const initial: IndicatorConfig[] = [{ type: 'DSP', period: 2, avgHours: 48, color: '#F0B90B', enabled: true }, { type: 'MA', period: 7, enabled: true }];
    const onChange = open(initial);
    fireEvent.click(screen.getByText('DSP·az'));
    expect(onChange).toHaveBeenCalledWith([
      ...initial,
      { type: 'DSP_Z', period: 6, zscore: true, color: '#F0B90B', enabled: true },
    ]);
  });

  it('反过来也一样；没开时就按默认半衰期 6 小时加上；老设置没有均线时长 → 24', () => {
    const onChange = open([{ type: 'DSP_VA', period: 12, color: '#F0B90B', enabled: true }]);
    fireEvent.click(screen.getByText('动态谢林点 DSP（含 a / A 副图）'));
    expect(onChange).toHaveBeenCalledWith([{ type: 'DSP', period: 12, avgHours: 24, color: '#F0B90B', enabled: true }]);
  });
});
