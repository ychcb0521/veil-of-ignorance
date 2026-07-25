import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImeSafeInput, ImeSafeTextarea } from '@/components/ui/ime-safe-text-field';

function TextareaHarness() {
  const [value, setValue] = useState('原评价');
  const [, forceRender] = useState(0);

  return (
    <>
      <ImeSafeTextarea
        aria-label="平仓评价"
        value={value}
        onValueChange={setValue}
      />
      <output data-testid="saved-review">{value}</output>
      <button type="button" onClick={() => forceRender(current => current + 1)}>
        父级重渲染
      </button>
    </>
  );
}

describe('IME-safe text fields', () => {
  it('keeps a Chinese textarea composition visible across parent rerenders and commits it once', () => {
    render(<TextareaHarness />);
    const field = screen.getByLabelText('平仓评价');

    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'pingcang' } });

    expect(field).toHaveValue('pingcang');
    expect(screen.getByTestId('saved-review')).toHaveTextContent('原评价');

    fireEvent.click(screen.getByRole('button', { name: '父级重渲染' }));
    expect(field).toHaveValue('pingcang');

    fireEvent.change(field, { target: { value: '平仓评价' } });
    fireEvent.compositionEnd(field);

    expect(field).toHaveValue('平仓评价');
    expect(screen.getByTestId('saved-review')).toHaveTextContent('平仓评价');
  });

  it('does not publish a counterfactual input value until Chinese composition ends', () => {
    const onValueChange = vi.fn();

    render(
      <ImeSafeInput
        aria-label="修正后的规则"
        value=""
        onValueChange={onValueChange}
      />,
    );
    const field = screen.getByLabelText('修正后的规则');

    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'xiuzheng' } });
    expect(field).toHaveValue('xiuzheng');
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '修正后的规则' } });
    fireEvent.compositionEnd(field);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith('修正后的规则');
  });
});
