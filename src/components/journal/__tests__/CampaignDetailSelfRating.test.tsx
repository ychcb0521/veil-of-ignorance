import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CampaignDetailSelfRating } from '../CampaignDetailSelfRating';
const mocks = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/journalApi', () => ({ updateCampaignImportance: mocks.save }));
vi.mock('@/lib/campaignListCache', () => ({ waitForCampaignListHeal: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/notificationCenter', () => ({ toast: { success: vi.fn(), error: mocks.error } }));
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockImplementation(async (_id, score) => score); });
it('显示已有自评，保存新分数并通知详情', async () => {
  const change = vi.fn();
  render(<CampaignDetailSelfRating campaignId="a" value={3} editable onChange={change} />);
  expect(screen.getByRole('button', { name: '3 一般' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '5 非常好' }));
  await waitFor(() => expect(change).toHaveBeenCalledWith(5));
  expect(mocks.save).toHaveBeenCalledWith('a', 5);
});
it('再次点击当前分数清除', async () => {
  render(<CampaignDetailSelfRating campaignId="a" value={3} editable onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '3 一般' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('a', 0));
});
it('他人战役只读；不发起写入', () => {
  render(<CampaignDetailSelfRating campaignId="a" value={3} editable={false} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: '5 非常好' })).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('保存失败保留原分数并提示', async () => {
  mocks.save.mockRejectedValue(new Error('保存失败'));
  const change = vi.fn();
  render(<CampaignDetailSelfRating campaignId="a" value={3} editable onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: '5 非常好' }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('保存失败'));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '3 一般' })).toHaveAttribute('aria-pressed', 'true');
});
