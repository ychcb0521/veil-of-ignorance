import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FishPanel } from '@/components/FishPanel';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { fishCardsKey, readFishCards } from '@/lib/fish/cards';

vi.mock('@/hooks/useFishFeatures', () => ({ useFishFeatures: () => [{ ...CBI2_DEF, formula: 'C', scale: 1 }] }));
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

it('adds the 50th rule, blocks the 51st, restores all settings and sends all 50 to capture', async () => {
  const cards = Array.from({ length: 49 }, (_, i) => ({
    id: i === 0 ? 'first' : `extra-${i}`, featureId: 'cbi2', enabled: true,
    pref: { statistic: '结果', direction: '>', threshold: (0.1 + i / 1000).toFixed(3), thresholdDefaultsVersion: 1, constraints: [] },
  }));
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  const start = vi.fn();
  const panel = () => <FishPanel signals={[]} progress={null} inputs={{ time: '', threshold: '' }} onInputsChange={() => {}}
    selection={{ exchanges: ['binance'], includeDuplicates: false }} onSelectionChange={() => {}}
    onStart={start} onCancel={() => {}} onJump={() => {}} onDelete={() => {}} onRate={() => {}}
    jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()} />;
  render(panel());
  const add = screen.getByRole('button', { name: '+ 算法' });
  expect(add).toBeEnabled();
  expect(add).toHaveAttribute('title', '添加一个算法（最多 50 个）');
  fireEvent.click(add);
  expect(screen.getByLabelText('算法 50 阈值')).toHaveValue(0.1);
  expect(add).toBeDisabled();
  fireEvent.click(add);
  expect(screen.queryByLabelText('算法 51 阈值')).toBeNull();
  expect(readFishCards()).toHaveLength(50);
  cleanup(); render(panel());
  expect(screen.getByLabelText('算法 49 阈值')).toHaveValue(0.148);
  expect(screen.getByLabelText('算法 50 阈值')).toHaveValue(0.1);
  fireEvent.click(screen.getByRole('button', { name: '开始捕捞' }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0][0].algorithms).toHaveLength(50);
  expect(start.mock.calls[0][0].algorithms[48].algorithm.threshold).toBe(0.148);
  fireEvent.click(screen.getByRole('button', { name: '算法 50 的更多操作' }));
  fireEvent.click(screen.getByRole('button', { name: '删除算法 50' }));
  expect(screen.getByRole('button', { name: '+ 算法' })).toBeEnabled();
}, 20000);
