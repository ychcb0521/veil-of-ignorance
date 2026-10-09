import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReductionCalculator } from '../ReductionCalculator';
import calculatorHtml from '@/assets/reductionCalculator.html?raw';

describe('ReductionCalculator', () => {
  it('embeds the complete original calculator without rewriting it', () => {
    render(<ReductionCalculator open onClose={() => {}} />);
    expect(screen.getByTitle('减仓计算器 · X / T 双向计算')).toHaveAttribute('srcdoc', calculatorHtml);
  });
  it('closes without submitting a trading order', () => {
    const close = vi.fn();
    render(<ReductionCalculator open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('seeds editable prices only when the frame loads, not on market rerenders', () => {
    const seed = { T: 103, S: 100, K: 98 };
    const view = render(<ReductionCalculator open onClose={() => {}} seed={seed} />);
    const frame = screen.getByTitle('减仓计算器 · X / T 双向计算') as HTMLIFrameElement;
    const setSeed = vi.fn();
    Object.assign(frame.contentWindow!, { ReductionCalculator: { setSeed } });
    fireEvent.load(frame);
    expect(setSeed).toHaveBeenCalledWith(seed);
    view.rerender(<ReductionCalculator open onClose={() => {}} seed={{ ...seed, T: 104 }} />);
    expect(setSeed).toHaveBeenCalledTimes(1);
  });
});
