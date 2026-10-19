import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FeatureView, type DeepDigNote, type DeepDigTab } from '@/components/journal/deepDig/FeatureView';
import { describeGroup, DEEP_DIG_GROUPS, type DeepDigData, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { DEFAULT_COMMANDS } from '@/lib/deepDig/commands';
import { DRIFT_SPEED_DEF } from '@/lib/deepDig/features';
import type { DeepDigSeries } from '@/lib/deepDig/series';
import { makeData } from '@/lib/deepDig/__tests__/fixtures';

const H = 3_600_000;
const BASE = makeData();
const rows = BASE.rows.map(r => ({ ...r, vars: { a: r.v } }));
const DATA: DeepDigData = { ...BASE, rows, groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g && r.v != null).map(r => r.v!))) };
// 曲线：+1h = 特征值的相反数（换时刻后条件「a > 0」筛出的是另一批）
const SERIES: DeepDigSeries = {
  finishedAt: DATA.finishedAt, offsets: [-H, 0, H], names: ['a'], result: 'a',
  byEvent: Object.fromEntries(DATA.rows.filter(r => r.v != null).map(r => [r.id, Float32Array.from([r.v! / 2, r.v!, -r.v!])])),
};
const real = DATA.rows.filter(r => r.group !== 'background' && r.v != null);

function Harness() {
  const [tab, setTab] = useState<DeepDigTab>('describe');
  const [group, setGroup] = useState<DeepDigRowGroup>('positive');
  const [note, setNote] = useState<DeepDigNote | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [commands, setCommands] = useState(DEFAULT_COMMANDS);
  return (
    <FeatureView
      def={DRIFT_SPEED_DEF} editing={false} onEditingChange={() => {}} onSaveDef={() => {}}
      samples={{ campaigns: [], signals: [] }} data={DATA} series={SERIES} inference={null}
      describeStatus="idle" describeProgress={null} describeError={null} canDescribe blockedReason={null}
      onDescribe={vi.fn()} onCancel={vi.fn()} inferStatus="idle" inferError={null} onInfer={vi.fn()} onDownload={vi.fn()}
      excluded={excluded} onExcludedChange={setExcluded} commands={commands} onCommandsChange={setCommands}
      tab={tab} onTabChange={setTab} group={group} onGroupChange={setGroup} showAll={showAll} onShowAllChange={setShowAll}
      onOpenCampaign={vi.fn()} note={note} onSaveNote={setNote}
    />
  );
}
const nOf = (key: string) => Number(within(screen.getByTestId(`deep-dig-pattern-row-${key}`)).getAllByRole('cell')[1].textContent);

describe('【用户要求】2026-10-19 Deep dig 描述统计 · 总体模式识别', { timeout: 60_000 }, () => {
  it('不写条件：全部样本 = 实验组 + 对照组 + 其他（不含随机时点），另有随机时点参照、分布、曲线与五档', () => {
    localStorage.clear(); sessionStorage.clear();
    render(<Harness />);
    expect(screen.getByTestId('deep-dig-pattern-block')).toHaveTextContent('总体模式识别');
    expect(nOf('all')).toBe(real.length);
    expect(nOf('bg')).toBe(DATA.rows.filter(r => r.group === 'background' && r.v != null).length);
    expect(screen.queryByTestId('deep-dig-pattern-row-pass')).not.toBeInTheDocument();
    expect(screen.getByTestId('deep-dig-pattern-hist')).toBeInTheDocument();
    expect(screen.getAllByTestId('deep-dig-pattern-bin')).toHaveLength(5);
    // 借用的曲线图：只列有数据的线、不重复显示变量选择
    const legend = screen.getByTestId('deep-dig-pattern-series-legend');
    expect(legend).toHaveTextContent('全部样本');
    expect(legend).toHaveTextContent('随机时点');
    expect(legend).not.toHaveTextContent('满足条件');
    expect(screen.queryByTestId('deep-dig-pattern-series-var-a')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('deep-dig-series-chart')).toHaveLength(1);
  });

  it('写条件：满足 + 不满足 = 全部样本；随机时点按同一条件筛；条件记在本机；写错给提示；用到结果时提醒', () => {
    localStorage.clear(); sessionStorage.clear();
    const { unmount } = render(<Harness />);
    fireEvent.change(screen.getByTestId('deep-dig-pattern-filter'), { target: { value: 'a > 0' } });
    const pass = real.filter(r => r.v! > 0).length;
    expect(nOf('pass')).toBe(pass);
    expect(nOf('pass') + nOf('fail')).toBe(nOf('all'));
    expect(nOf('bg')).toBe(DATA.rows.filter(r => r.group === 'background' && r.v != null && r.v > 0).length);
    expect(screen.getByTestId('deep-dig-pattern-row-bg')).toHaveTextContent('随机时点（同条件）');
    expect(screen.getByTestId('deep-dig-pattern-series-legend')).toHaveTextContent('满足条件');
    unmount();
    render(<Harness />);
    expect(screen.getByTestId('deep-dig-pattern-filter')).toHaveValue('a > 0');
    fireEvent.change(screen.getByTestId('deep-dig-pattern-filter'), { target: { value: 'a > zz' } });
    expect(screen.getByTestId('deep-dig-pattern-error')).toHaveTextContent('不认识「zz」');
    expect(screen.queryByTestId('deep-dig-pattern-row-pass')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('deep-dig-pattern-filter'), { target: { value: 'maxUp > 0.05' } });
    expect(screen.getByTestId('deep-dig-pattern-outcome')).toHaveTextContent('只能作事后描述');
    fireEvent.click(screen.getByTestId('deep-dig-pattern-filter-clear'));
    expect(localStorage.getItem(`veil.deepDig.patternFilter:${DRIFT_SPEED_DEF.id}`)).toBeNull();
  });

  it('条件与读数跟着竖线时刻：拖到 +1h，a 的符号反过来，满足条件的换成另一批；两张图的竖线同步', () => {
    localStorage.clear(); sessionStorage.clear();
    render(<Harness />);
    fireEvent.change(screen.getByTestId('deep-dig-pattern-filter'), { target: { value: 'a > 0' } });
    fireEvent.keyDown(screen.getByTestId('deep-dig-pattern-series-at-handle'), { key: 'ArrowRight' });
    expect(screen.getByTestId('deep-dig-series-at-handle')).toHaveAttribute('aria-valuetext', '+1h');
    expect(nOf('pass')).toBe(real.filter(r => r.v! < 0).length);
    expect(screen.getByTestId('deep-dig-pattern-aside')).toHaveTextContent('+1h');
  });
});
