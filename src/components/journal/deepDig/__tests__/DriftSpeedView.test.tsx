import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { DriftSpeedView, type DeepDigNote, type DeepDigTab } from '@/components/journal/deepDig/DriftSpeedView';
import { DeepDigDirectory } from '@/pages/JournalDeepDigPage';
import { analyzeDriftSpeed, driftRules, type DriftGroup, type DriftSpeedResult } from '@/lib/deepDig/driftSpeed';
import { driftEvents } from '@/lib/deepDig/__tests__/fixtures';

function result(): DriftSpeedResult {
  const { split, ...a } = analyzeDriftSpeed(driftEvents(240, -1e-4), { permutations: 199, bootstrap: 49 });
  return {
    ...a, codeVersion: 'test', startedAt: 0, finishedAt: Date.parse('2026-10-16T08:00:00Z'),
    coverage: { campaigns: 200, clusters: 160, failed: 0, lowCoverage: 0, outcomeMissing: 0, featureMissing: 2, ...split },
  };
}

function Harness({ r, onOpenCampaign = vi.fn(), initialTab = 'describe' }: { r: DriftSpeedResult | null; onOpenCampaign?: (id: string) => void; initialTab?: DeepDigTab }) {
  const [tab, setTab] = useState<DeepDigTab>(initialTab);
  const [group, setGroup] = useState<DriftGroup>('positive');
  const [note, setNote] = useState<DeepDigNote | null>(null);
  const [showAll, setShowAll] = useState(false);
  return (
    <DriftSpeedView
      result={r} status="idle" progress={null} error={null} canRun onRun={vi.fn()} onCancel={vi.fn()} onDownload={vi.fn()}
      tab={tab} onTabChange={setTab} group={group} onGroupChange={setGroup} showAll={showAll} onShowAllChange={setShowAll} onOpenCampaign={onOpenCampaign} note={note} onSaveNote={setNote}
    />
  );
}

describe('【用户要求】Deep dig：按特征值做目录，每个特征值分描述统计 / 推断统计 / 规律提取', { timeout: 60_000 }, () => {
  it('目录：多空博弈均衡点漂移速度 V，下面是三个模块的入口；跑过后显示两组中位数与 p', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<DeepDigDirectory result={null} notes={{}} onOpen={onOpen} />);
    expect(screen.getByTestId('deep-dig-directory')).toHaveTextContent('多空博弈均衡点漂移速度 V');
    expect(screen.getByTestId('deep-dig-directory')).toHaveTextContent('未运行');
    fireEvent.click(screen.getByTestId('deep-dig-open-drift-speed-infer'));
    expect(onOpen).toHaveBeenCalledWith('drift-speed', 'infer');
    rerender(<DeepDigDirectory result={result()} notes={{ 'drift-speed': { text: 'x', savedAt: 1 } }} onOpen={onOpen} />);
    expect(screen.getByTestId('deep-dig-directory').textContent).toMatch(/实验组 -?\d+\.\d\d · 对照组 -?\d+\.\d\d 基点\/根 · t 检验 p/);
    expect(screen.getByTestId('deep-dig-open-drift-speed-rules')).toHaveTextContent('已改');
  });

  it('描述统计：四组的 n / 均值 / 标准差 / 中位数，点阵图，细节，逐场数据；点一行打开战役', () => {
    const onOpen = vi.fn();
    const r = result();
    render(<Harness r={r} onOpenCampaign={onOpen} />);
    const groups = screen.getByTestId('deep-dig-groups');
    for (const label of ['实验组', '对照组', '其他战役', '随机时点']) expect(groups).toHaveTextContent(label);
    expect(groups).toHaveTextContent('标准差');
    expect(screen.getByTestId('deep-dig-strip')).toBeInTheDocument();
    expect(screen.getByTestId('deep-dig-details')).toHaveTextContent('成交额数据不足的记缺失（2 个）');
    const nPos = r.groups.find(g => g.group === 'positive')!.n;
    expect(nPos).toBeGreaterThan(15);
    // 默认只列 15 条，点「展开全部」才列完
    expect(within(screen.getByTestId('deep-dig-rows')).getAllByTestId('deep-dig-row')).toHaveLength(15);
    fireEvent.click(screen.getByTestId('deep-dig-rows-toggle'));
    const rows = within(screen.getByTestId('deep-dig-rows')).getAllByTestId('deep-dig-row');
    expect(rows).toHaveLength(nPos);
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith(expect.stringMatching(/^c\d+$/));
    fireEvent.click(screen.getByTestId('deep-dig-group-background'));
    expect(within(screen.getByTestId('deep-dig-rows')).getAllByTestId('deep-dig-row')).toHaveLength(r.groups.find(g => g.group === 'background')!.n);
  });

  it('推断统计：t 检验、排名比较、相关（含确认集）、五分位，每种方法先写过程再给结果', () => {
    render(<Harness r={result()} initialTab="infer" />);
    const t = screen.getByTestId('deep-dig-ttest');
    expect(t).toHaveTextContent('Welch');
    expect(t.textContent).toMatch(/差异显著|差异不显著/);
    expect(screen.getByTestId('deep-dig-auc')).toHaveTextContent('AUC');
    for (const k of ['endRet', 'maxUp', 'maxDown']) expect(screen.getByTestId(`deep-dig-assoc-${k}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('deep-dig-quintiles')).getAllByText(/^Q\d$/)).toHaveLength(5);
  });

  it('规律提取：默认是统计结果；可编辑、保存后标「手动修改」，可恢复为统计结果', () => {
    const r = result();
    render(<Harness r={r} initialTab="rules" />);
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('统计得出');
    const defaults = driftRules(r);
    expect(within(screen.getByTestId('deep-dig-rules-list')).getAllByRole('listitem')).toHaveLength(defaults.length);
    fireEvent.click(screen.getByTestId('deep-dig-rules-edit'));
    fireEvent.change(screen.getByTestId('deep-dig-rules-input'), { target: { value: '只在 V 回落到 0 附近时进场\n\n仓位减半' } });
    fireEvent.click(screen.getByTestId('deep-dig-rules-save'));
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('手动修改');
    expect(within(screen.getByTestId('deep-dig-rules-list')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['1只在 V 回落到 0 附近时进场', '2仓位减半']);
    fireEvent.click(screen.getByTestId('deep-dig-rules-reset'));
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('统计得出');
  });

  it('没运行：描述 / 推断写「还没运行」，规律提取可以先手写', () => {
    render(<Harness r={null} />);
    expect(screen.getByTestId('deep-dig-empty')).toHaveTextContent('还没运行');
    expect(screen.getByTestId('deep-dig-run-button')).toHaveTextContent('运行');
    fireEvent.click(screen.getByTestId('deep-dig-tab-rules'));
    expect(screen.getByTestId('deep-dig-rules-edit')).not.toBeDisabled();
  });
});
