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
});
