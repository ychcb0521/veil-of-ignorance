import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BreakEvenCurve } from '@/components/BreakEvenCurve';

describe('BreakEvenCurve', () => {
  it('以当前动态赔率为滑条起点，并给出该赔率下的平衡胜率', () => {
    render(<BreakEvenCurve currentPayoffRatio={1} />);
    expect(screen.getByTestId('break-even-odds-value')).toHaveTextContent('1.0');
    // b=1 → P = 1/(1+1) = 50%
    expect(screen.getByTestId('break-even-rate')).toHaveTextContent('50.0%');
  });

  it('拖动滑条：赔率增大，门槛急速下降', () => {
    render(<BreakEvenCurve currentPayoffRatio={1} />);
    const slider = screen.getByTestId('break-even-odds-slider');

    fireEvent.change(slider, { target: { value: '2' } });
    expect(screen.getByTestId('break-even-rate')).toHaveTextContent('33.3%');

    fireEvent.change(slider, { target: { value: '9' } });
    expect(screen.getByTestId('break-even-rate')).toHaveTextContent('10.0%');
  });

  it('给出主观胜率时算出你与门槛的差额，正绿负红', () => {
    const { rerender } = render(<BreakEvenCurve currentPayoffRatio={1} winRate={0.6} />);
    // 60% − 50% = +10%
    const edge = screen.getByTestId('break-even-edge');
    expect(edge).toHaveTextContent('+10.0%');
    expect(edge).toHaveStyle({ color: '#0ECB81' });

    rerender(<BreakEvenCurve currentPayoffRatio={1} winRate={0.4} />);
    const negative = screen.getByTestId('break-even-edge');
    expect(negative).toHaveTextContent('-10.0%');
    expect(negative).toHaveStyle({ color: '#F6465D' });
  });

  it('未给出主观胜率时不臆造优势', () => {
    render(<BreakEvenCurve currentPayoffRatio={2} />);
    expect(screen.getByTestId('break-even-edge')).toHaveTextContent('—');
  });

  it('起点赔率超出量程时收敛到上限，不画到图外', () => {
    render(<BreakEvenCurve currentPayoffRatio={999} maxOdds={20} />);
    expect(screen.getByTestId('break-even-odds-value')).toHaveTextContent('20.0');
  });
});
