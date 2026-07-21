import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import JournalCampaignClassifyPage from '../JournalCampaignClassifyPage';

describe('JournalCampaignClassifyPage', () => {
  it('only renders the page header and symbol search input', () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/classify?symbol=raveusdt']}>
        <JournalCampaignClassifyPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '归类历史交易' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看所有战役' })).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: '标的名称' });
    expect(input).toHaveValue('RAVEUSDT');
    fireEvent.change(input, { target: { value: 'btcusdt' } });
    expect(input).toHaveValue('BTCUSDT');

    expect(screen.queryByText('筛选归类项')).not.toBeInTheDocument();
    expect(screen.queryByText('归类为新战役')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
