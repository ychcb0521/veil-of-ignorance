import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CampaignReviewSummary } from '../CampaignReviewSummary';
import {
  campaignReviewRuleText,
  readCampaignReviewRule,
  readCampaignReviewSummary,
  withCampaignReviewRule,
  withCampaignReviewSummary,
} from '@/lib/campaignReviewSummary';
import { parseRuleTextParts } from '@/lib/ruleTextParts';
import { planCampaignReviewRuleSync } from '@/lib/journalApi';
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
    fireEvent.change(screen.getByRole('textbox', { name: '复盘总结' }), { target: { value: '新总结' } });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    expect(screen.getByRole('textbox', { name: '复盘总结' })).toHaveValue('新总结');
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存到本战役'));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('新总结', { violation: '', fix: '' });
  });

  it('请求期间继续书写仍保留后写的草稿，不能把未保存文字误报为已保存', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<CampaignReviewSummary value="" canEdit onSave={save} />);
    fireEvent.change(screen.getByRole('textbox', { name: '复盘总结' }), { target: { value: '第一稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    fireEvent.change(screen.getByRole('textbox', { name: '复盘总结' }), { target: { value: '第二稿' } });
    await act(async () => finish());
    expect(save).toHaveBeenCalledWith('第一稿', { violation: '', fix: '' });
    expect(screen.getByRole('textbox', { name: '复盘总结' })).toHaveValue('第二稿');
    expect(screen.getByRole('status')).toHaveTextContent('有未保存的修改');
  });

  it('换战役卸载旧编辑器，旧保存返回不会污染新战役', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { rerender } = render(<CampaignReviewSummary key="a" value="A" canEdit onSave={save} />);
    fireEvent.change(screen.getByRole('textbox', { name: '复盘总结' }), { target: { value: 'A 修改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    rerender(<CampaignReviewSummary key="b" value="B" canEdit onSave={vi.fn()} />);
    await act(async () => finish());
    expect(screen.getByRole('textbox', { name: '复盘总结' })).toHaveValue('B');
    expect(screen.getByRole('status')).toHaveTextContent('已保存到本战役');
  });
});

describe('【用户要求】复盘总结里的「违规 / 修正」两行，保存后纳入规则', () => {
  it('两行与总结一起保存；只改违规 / 修正也算有改动', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<CampaignReviewSummary value="总结" canEdit onSave={save} />);
    const button = screen.getByRole('button', { name: '保存总结' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '违规' }), { target: { value: '加仓后对冲触发，硬拆了对冲' } });
    fireEvent.change(screen.getByRole('textbox', { name: '修正' }), { target: { value: '加仓后对冲触发就不要动' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledWith('总结', { violation: '加仓后对冲触发，硬拆了对冲', fix: '加仓后对冲触发就不要动' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('「修正」已纳入规则'));
  });

  it('存进战役批注的专用键，不碰逐腿备注与总结；读回原样', () => {
    const original = { leg1: { reason: '过早拆对冲', fix: '确认再拆' } };
    const notes = withCampaignReviewRule(withCampaignReviewSummary(original, '总结'), { violation: ' 违规 ', fix: ' 修正 ' });
    expect(notes.leg1).toEqual(original.leg1);
    expect(readCampaignReviewSummary(notes)).toBe('总结');
    expect(readCampaignReviewRule(notes)).toEqual({ violation: '违规', fix: '修正' });
  });

  it('规则文字与战役偏离同一种格式，规则页拆得回违规 / 修正；修正为空不生成规则', () => {
    const text = campaignReviewRuleText({ violation: '开仓阶段：高位横盘依然开单', fix: '没有新支撑位就放过' })!;
    expect(text).toBe('【战役偏离】违规操作：开仓阶段：高位横盘依然开单。修正后的规则：没有新支撑位就放过');
    expect(parseRuleTextParts(text)).toEqual({ phase: '开仓阶段', violation: '高位横盘依然开单', fix: '没有新支撑位就放过' });
    expect(campaignReviewRuleText({ violation: '只写了违规', fix: '' })).toBeNull();
    expect(campaignReviewRuleText({ violation: '', fix: '只写修正' })).toBe('【战役偏离】修正后的规则：只写修正');
  });

  it('同步规则：没有就新建；改了就原地改上一次那一条；文字已存在就不重复建', () => {
    const before = campaignReviewRuleText({ violation: '硬拆对冲', fix: '不要动' });
    const after = campaignReviewRuleText({ violation: '硬拆对冲', fix: '对冲触发后就不要动' });
    expect(planCampaignReviewRuleSync([], null, before)).toEqual({ action: 'create' });
    expect(planCampaignReviewRuleSync([{ id: 'r1', rule_text: before! }], before, after)).toEqual({ action: 'update', ruleId: 'r1' });
    expect(planCampaignReviewRuleSync([{ id: 'r1', rule_text: after! }], before, after)).toEqual({ action: 'unchanged', ruleId: 'r1' });
    // 上一次那条已被删：重新建
    expect(planCampaignReviewRuleSync([], before, after)).toEqual({ action: 'create' });
    expect(planCampaignReviewRuleSync([{ id: 'r1', rule_text: before! }], before, null)).toEqual({ action: 'none' });
  });

  it('别人的战役只读：违规 / 修正分两行显示', () => {
    render(<CampaignReviewSummary value="总结" rule={{ violation: '硬拆对冲', fix: '不要动' }} canEdit={false} onSave={vi.fn()} />);
    expect(screen.getByText('硬拆对冲')).toBeInTheDocument();
    expect(screen.getByText('不要动')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
