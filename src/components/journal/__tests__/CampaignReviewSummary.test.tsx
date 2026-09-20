import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CampaignReviewSummary } from '../CampaignReviewSummary';
import { readCampaignReviewSummary, withCampaignReviewSummary } from '@/lib/campaignReviewSummary';
import { buildCampaignDeviationRuleDrafts } from '@/lib/campaignDeviationRules';

describe('CampaignReviewSummary', () => {
  it('保存独立总结保留逐腿备注，空总结明确持久化，且不生成交易规则', () => {
    const original = { leg1: { reason: '过早拆对冲', fix: '确认再拆' } };
    const notes = withCampaignReviewSummary(original, '自己判断的结论');
    expect(notes.leg1).toEqual(original.leg1);
    expect(original).toEqual({ leg1: { reason: '过早拆对冲', fix: '确认再拆' } });
    expect(readCampaignReviewSummary(notes)).toBe('自己判断的结论');
    expect(readCampaignReviewSummary(withCampaignReviewSummary(notes, ''))).toBe('');
    expect(buildCampaignDeviationRuleDrafts(notes, [])).toEqual([]);
  });

  it('提示只在点选时填入，不自动认定事实；手写内容不被覆盖', () => {
    render(<CampaignReviewSummary value="" canEdit onSave={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: '复盘总结' });
    expect(field).toHaveValue('');
    fireEvent.change(field, { target: { value: '我的结论' } });
    fireEvent.click(screen.getByRole('button', { name: '止损线太浅' }));
    expect(field).toHaveValue('我的结论\n止损线太浅');
    expect(screen.getByText(/不代表本场事实/)).toBeInTheDocument();
  });

  it('保存失败保留草稿和重试入口；成功后显示已保存', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce(undefined);
    render(<CampaignReviewSummary value="旧总结" canEdit onSave={save} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新总结' } });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    expect(screen.getByRole('textbox')).toHaveValue('新总结');
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存到本战役'));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('新总结');
  });

  it('请求期间继续书写仍保留后写的草稿，不能把未保存文字误报为已保存', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<CampaignReviewSummary value="" canEdit onSave={save} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第一稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第二稿' } });
    await act(async () => finish());
    expect(save).toHaveBeenCalledWith('第一稿');
    expect(screen.getByRole('textbox')).toHaveValue('第二稿');
    expect(screen.getByRole('status')).toHaveTextContent('有未保存的修改');
  });

  it('换战役卸载旧编辑器，旧保存返回不会污染新战役', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { rerender } = render(<CampaignReviewSummary key="a" value="A" canEdit onSave={save} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A 修改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    rerender(<CampaignReviewSummary key="b" value="B" canEdit onSave={vi.fn()} />);
    await act(async () => finish());
    expect(screen.getByRole('textbox')).toHaveValue('B');
    expect(screen.getByRole('status')).toHaveTextContent('已保存到本战役');
  });
});
