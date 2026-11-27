import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { readPendingInstantCampaignJobs, syncInstantCampaign } from '@/lib/fish/instantCampaignStore';
import { useInstantCampaigns } from '../useInstantCampaigns';
import type { FishCdaTracking } from '../useFishCdaTracking';

vi.mock('@/lib/fish/instantCampaignStore', () => ({
  readInstantPositionLedger: vi.fn(async () => ({ positions: [], history: [] })),
  reconcileOpenInstantPositions: vi.fn(async () => undefined),
  readPendingInstantCampaignJobs: vi.fn(),
  saveInstantCampaignInput: vi.fn(),
  saveInstantCampaignSnapshot: vi.fn(),
  saveInstantPosition: vi.fn(),
  subscribeInstantCampaigns: vi.fn(() => () => undefined),
  syncInstantCampaign: vi.fn(),
}));

vi.mock('../useFish', () => ({
  buildPageInstantCampaign: vi.fn(),
  openPageInstantPosition: vi.fn(),
}));

it('retries reading existing archive jobs after a storage failure without waiting for a new signal', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('indexedDB', {});
  const jobs = vi.mocked(readPendingInstantCampaignJobs);
  const snapshot = { id: 'fish-instant-fixture', sell: { at: 2000 } };
  const storageError = new Error('浏览器数据库暂不可用');
  jobs.mockRejectedValueOnce(storageError).mockRejectedValueOnce(storageError);
  jobs.mockResolvedValue([{ input: snapshot, snapshot }] as Awaited<ReturnType<typeof readPendingInstantCampaignJobs>>);
  const tracking: FishCdaTracking = {
    enabled: true, active: 0, awaitingMail: 0, alerts: new Map(), error: '', saving: false, setEnabled: vi.fn(),
  };
  const view = renderHook(() => useInstantCampaigns('fixture-owner', tracking, true));
  try {
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(view.result.current.issue).toContain('浏览器数据库暂不可用');
    expect(syncInstantCampaign).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(syncInstantCampaign).toHaveBeenCalledExactlyOnceWith('fixture-owner', snapshot, expect.any(AbortSignal));
    expect(view.result.current.issue).toBe('');
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it('keeps the frozen sale for retry and clears a stale warning after another tab completes it', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('indexedDB', {});
  const snapshot = { id:'fish-instant-sei', source:{symbol:'SEIUSDT'}, sell:{at:2000} };
  const jobs = vi.mocked(readPendingInstantCampaignJobs);
  jobs.mockResolvedValue([{input:snapshot,snapshot}] as Awaited<ReturnType<typeof readPendingInstantCampaignJobs>>);
  const sync = vi.mocked(syncInstantCampaign);
  sync.mockClear().mockRejectedValueOnce(new Error('<!DOCTYPE html><html>' + 'x'.repeat(5000)))
    .mockRejectedValueOnce(new Error('站点安全验证待完成'));
  const tracking: FishCdaTracking = {
    enabled:true, active:0, awaitingMail:0, alerts:new Map(), error:'', saving:false, setEnabled:vi.fn(),
  };
  const view = renderHook(() => useInstantCampaigns('fixture-owner', tracking, true));
  try {
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(view.result.current.issue).toMatch(/^SEIUSDT · 战役待同步（云端接口返回了网页/);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenLastCalledWith('fixture-owner',snapshot,expect.any(AbortSignal));
    expect(view.result.current.issue).toContain('站点安全验证待完成');
    jobs.mockResolvedValue([]);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(view.result.current.issue).toBe('');
    expect(sync).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
