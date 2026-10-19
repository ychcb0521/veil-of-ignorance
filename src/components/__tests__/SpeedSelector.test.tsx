import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeedSelector } from '@/components/SpeedSelector';
import { DEFAULT_PINNED_SPEEDS, normalizePinnedSpeeds } from '@/hooks/useSpeedPrefs';

const mainSpeeds = () => [...screen.getByTestId('speed-selector').querySelectorAll('[data-testid^="speed-"][aria-pressed]')].map(b => b.textContent);

describe('【用户要求】2026-10-19 倍速：主栏只写数字、置顶档位可编辑（与周期选择同一模式）', () => {
  beforeEach(() => localStorage.clear());

  it('默认置顶几档、不带「x」；按下即选一次（不会因 click 再选一遍）', () => {
    const onSelect = vi.fn();
    render(<SpeedSelector speed={1} onSelect={onSelect} />);
    expect(mainSpeeds()).toEqual(DEFAULT_PINNED_SPEEDS.map(String));
    expect(screen.getByTestId('speed-selector').textContent).not.toMatch(/\dx/);
    const b = screen.getByTestId('speed-1800');
    fireEvent.pointerDown(b, { button: 0 });
    fireEvent.click(b);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1800);
  });

  it('下拉里编辑：移除 / 加入置顶，按升序摆；至少留一档；选中不在主栏的档位时下拉按钮写出它', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<SpeedSelector speed={1} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('speed-more'));
    fireEvent.click(screen.getByTestId('speed-edit'));
    fireEvent.click(screen.getByTestId('speed-option-10'));
    fireEvent.click(screen.getByTestId('speed-option-5'));
    expect(mainSpeeds()).toEqual(['1', '5', '60', '300', '1800', '3600']);
    for (const s of [1, 5, 60, 300, 1800, 3600]) fireEvent.click(screen.getByTestId(`speed-option-${s}`));
    expect(mainSpeeds()).toEqual(['3600']);
    fireEvent.click(screen.getByTestId('speed-edit')); // 完成
    fireEvent.click(screen.getByTestId('speed-option-900'));
    expect(onSelect).toHaveBeenLastCalledWith(900);
    expect(screen.queryByTestId('speed-panel')).not.toBeInTheDocument();
    rerender(<SpeedSelector speed={900} onSelect={onSelect} />);
    expect(screen.getByTestId('speed-more')).toHaveTextContent('900');
  });

  it('读回的脏数据：只留合法档位、去重升序，空了回到默认', () => {
    expect(normalizePinnedSpeeds([3600, 7, 1, 1, 'x'])).toEqual([1, 3600]);
    expect(normalizePinnedSpeeds(null)).toEqual([...DEFAULT_PINNED_SPEEDS]);
    expect(normalizePinnedSpeeds([])).toEqual([...DEFAULT_PINNED_SPEEDS]);
  });
});
