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
  it('【用户要求】名称下面注明 a 的定义，悬停给出计算步骤（两项都有）', () => {
    open([]);
    const defs = screen.getAllByText(/买方推力漂移速度 DSP·a：共识价每根 K 线往上/);
    expect(defs).toHaveLength(2);
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

  it('菜单里保留独立 DSP·a 副图与含主图 DSP 两个入口', () => {
    open([]);
    expect(screen.getByText('买方推力漂移速度 DSP·a')).toBeInTheDocument();
    expect(screen.getByText('动态谢林点 DSP（含 a / A 副图）')).toBeInTheDocument();
  });

  it('二选一：开着 DSP 时点「只要副图」→ 换成只要副图，半衰期与均线时长沿用', () => {
    const onChange = open([{ type: 'DSP', period: 2, avgHours: 48, color: '#F0B90B', enabled: true }, { type: 'MA', period: 7, enabled: true }]);
    fireEvent.click(screen.getByText('买方推力漂移速度 DSP·a'));
    expect(onChange).toHaveBeenCalledWith([
      { type: 'MA', period: 7, enabled: true },
      { type: 'DSP_VA', period: 2, avgHours: 48, color: '#F0B90B', enabled: true },
    ]);
  });

  it('反过来也一样；没开时就按默认半衰期 6 小时加上；老设置没有均线时长 → 24', () => {
    const onChange = open([{ type: 'DSP_VA', period: 12, color: '#F0B90B', enabled: true }]);
    fireEvent.click(screen.getByText('动态谢林点 DSP（含 a / A 副图）'));
    expect(onChange).toHaveBeenCalledWith([{ type: 'DSP', period: 12, avgHours: 24, color: '#F0B90B', enabled: true }]);
  });
});
