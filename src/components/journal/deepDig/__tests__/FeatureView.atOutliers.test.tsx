import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FeatureView, type DeepDigNote, type DeepDigTab } from '@/components/journal/deepDig/FeatureView';
import { describeGroup, DEEP_DIG_GROUPS, exclusionKey, findOutliers, type DeepDigData, type DeepDigInference, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { DEFAULT_COMMANDS, runInference } from '@/lib/deepDig/commands';
import { DRIFT_SPEED_DEF } from '@/lib/deepDig/features';
import type { DeepDigSeries } from '@/lib/deepDig/series';
import { makeData } from '@/lib/deepDig/__tests__/fixtures';

const H = 3_600_000;
// jsdom 没有 PointerEvent：用 MouseEvent 补一个（带 clientX / button / pointerId）
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  }
  (window as unknown as { PointerEvent: typeof PointerEventShim }).PointerEvent = PointerEventShim;
}
// 实验组第一行放一个极端大的值
const BASE = makeData();
const BIG_ID = BASE.rows.find(r => r.group === 'positive' && r.v != null)!.id;
const rows = BASE.rows.map(r => (r.id === BIG_ID ? { ...r, v: 0.05, vars: { a: 0.05 } } : { ...r, vars: { a: r.v } }));
const DATA: DeepDigData = { ...BASE, rows, groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g && r.v != null).map(r => r.v!))) };
// 曲线：+1h = 3 × 特征值
const SERIES: DeepDigSeries = {
  finishedAt: DATA.finishedAt, offsets: [-H, 0, H], names: ['a'], result: 'a',
  byEvent: Object.fromEntries(DATA.rows.filter(r => r.v != null).map(r => [r.id, Float32Array.from([r.v! / 2, r.v!, 3 * r.v!])])),
};

function Harness({ onInfer, tab: initialTab = 'describe', inference = null }: { onInfer?: (d: DeepDigData, k: string) => void; tab?: DeepDigTab; inference?: DeepDigInference | null }) {
  const [tab, setTab] = useState<DeepDigTab>(initialTab);
  const [group, setGroup] = useState<DeepDigRowGroup>('positive');
  const [note, setNote] = useState<DeepDigNote | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [commands, setCommands] = useState(DEFAULT_COMMANDS);
  return (
    <FeatureView
      def={DRIFT_SPEED_DEF} editing={false} onEditingChange={() => {}} onSaveDef={() => {}}
      samples={{ campaigns: [], signals: [] }} data={DATA} series={SERIES} inference={inference}
      describeStatus="idle" describeProgress={null} describeError={null} canDescribe blockedReason={null}
      onDescribe={vi.fn()} onCancel={vi.fn()} inferStatus="idle" inferError={null} onInfer={onInfer ?? vi.fn()} onDownload={vi.fn()}
      excluded={excluded} onExcludedChange={setExcluded} commands={commands} onCommandsChange={setCommands}
      tab={tab} onTabChange={setTab} group={group} onGroupChange={setGroup} showAll={showAll} onShowAllChange={setShowAll}
      onOpenCampaign={vi.fn()} note={note} onSaveNote={setNote}
    />
  );
}
const posCell = (col: number) => {
  const row = within(screen.getByTestId('deep-dig-groups')).getAllByRole('row').find(r => r.textContent?.startsWith('实验组'))!;
  return within(row).getAllByRole('cell')[col].textContent;
};

describe('【用户要求】Deep dig 描述统计：拖竖线选时刻、极端值暂时删除', { timeout: 60_000 }, () => {
  it('竖线默认在进场；← → 一格一格移，分组表换成那一刻的值；指针按下拖动也能选；「回到进场」复原', () => {
    sessionStorage.clear();
    localStorage.clear();
    render(<Harness />);
    const handle = screen.getByTestId('deep-dig-series-at-handle');
    expect(handle).toHaveAttribute('aria-valuetext', '进场');
    expect(screen.getByTestId('deep-dig-groups-at')).toHaveTextContent('进场时');
    const n0 = posCell(1);
    const mean0 = Number(posCell(2));
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(screen.getByTestId('deep-dig-series-at-handle')).toHaveAttribute('aria-valuetext', '+1h');
    expect(screen.getByTestId('deep-dig-groups-at')).toHaveTextContent('+1h（进场后）');
    expect(posCell(1)).toBe(n0);
    expect(Number(posCell(2))).toBeCloseTo(3 * mean0, 0);
    expect(screen.getByTestId('deep-dig-details')).toHaveTextContent('用到了进场后的数据，只作描述');
    fireEvent.click(screen.getByTestId('deep-dig-series-at-reset'));
    expect(screen.getByTestId('deep-dig-groups-at')).toHaveTextContent('进场时');
    expect(screen.queryByTestId('deep-dig-series-at-reset')).not.toBeInTheDocument();
    // 指针：在图的最左端按下 → −1h
    const hit = screen.getByTestId('deep-dig-series-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(hit, { clientX: 1, button: 0, pointerId: 1 });
    expect(screen.getByTestId('deep-dig-groups-at')).toHaveTextContent('−1h（进场前）');
    fireEvent.pointerMove(hit, { clientX: 99, pointerId: 1 });
    expect(screen.getByTestId('deep-dig-groups-at')).toHaveTextContent('+1h（进场后）');
    fireEvent.pointerUp(hit, { pointerId: 1 });
    fireEvent.pointerMove(hit, { clientX: 50, pointerId: 1 });
    expect(screen.getByTestId('deep-dig-groups-at')).toHaveTextContent('+1h（进场后）');
    fireEvent.keyDown(screen.getByTestId('deep-dig-series-at-handle'), { key: 'Home' });
    expect(screen.getByTestId('deep-dig-groups-at')).toHaveTextContent('进场时');
  });

  it('极端值列出来（数据表里也标「极端」）；暂时删除 → 统计重算、推断统计也去掉；恢复 / 全部暂时删除 / 全部恢复；换页回来还在', () => {
    sessionStorage.clear();
    localStorage.clear();
    const onInfer = vi.fn();
    const { unmount } = render(<Harness onInfer={onInfer} />);
    const list = screen.getByTestId('deep-dig-outliers');
    expect(list).toHaveTextContent('各组四分位距 1.5 倍以外');
    // 【用户要求】表格可以折叠：默认收起，点「极端值」展开、再点收起
    const toggle = screen.getByTestId('deep-dig-outliers-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('deep-dig-outlier-rows')).not.toBeInTheDocument();
    expect(screen.getByTestId('deep-dig-outliers-remove-all')).toBeInTheDocument(); // 收起时「全部暂时删除」照常可用
    fireEvent.click(toggle);
    expect(screen.getByTestId('deep-dig-outliers-toggle')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByTestId('deep-dig-outliers-toggle'));
    expect(screen.queryByTestId('deep-dig-outlier-rows')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-outliers-toggle'));
    const big = screen.getAllByTestId('deep-dig-outlier-row').find(r => r.textContent?.includes('500.00'))!;
    expect(big).toHaveTextContent('偏高');
    fireEvent.click(screen.getByTestId('deep-dig-rows-toggle'));
    expect(screen.getAllByTestId('deep-dig-row-outlier').length).toBeGreaterThan(0);
    const n0 = Number(posCell(1));
    fireEvent.click(within(big).getByTestId('deep-dig-outlier-remove'));
    expect(Number(posCell(1))).toBe(n0 - 1);
    expect(within(screen.getAllByTestId('deep-dig-outlier-row').find(r => r.textContent?.includes('500.00'))!).getByTestId('deep-dig-outlier-restore')).toBeInTheDocument();
    expect(screen.getByTestId('deep-dig-outliers')).toHaveTextContent('已暂时删除 1 行');
    expect(screen.getByTestId('deep-dig-details')).toHaveTextContent('暂时删除 1 行');
    // 换个页面再回来：暂时删除还在、表格仍展开（这次浏览里）
    unmount();
    render(<Harness onInfer={onInfer} />);
    expect(Number(posCell(1))).toBe(n0 - 1);
    expect(screen.getByTestId('deep-dig-outliers-toggle')).toHaveAttribute('aria-expanded', 'true');
    // 推断统计用删掉之后的数据
    fireEvent.click(screen.getByTestId('deep-dig-tab-infer'));
    expect(screen.getByText(/暂时删除的 1 行/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-infer-run-button'));
    const [inferData, key] = onInfer.mock.calls[0];
    expect(inferData.rows.some((r: { id: string }) => r.id === BIG_ID)).toBe(false);
    expect(key).toContain(BIG_ID);
    fireEvent.click(screen.getByTestId('deep-dig-tab-describe'));
    // 恢复
    fireEvent.click(screen.getByTestId('deep-dig-outlier-restore'));
    expect(Number(posCell(1))).toBe(n0);
    expect(sessionStorage.getItem(`veil.deepDig.tempExcluded:${DRIFT_SPEED_DEF.id}`)).toBeNull();
    // 全部暂时删除 → 全部恢复
    const all = screen.getAllByTestId('deep-dig-outlier-remove').length;
    fireEvent.click(screen.getByTestId('deep-dig-outliers-remove-all'));
    expect(screen.queryAllByTestId('deep-dig-outlier-remove')).toHaveLength(0);
    expect(screen.getAllByTestId('deep-dig-outlier-restore')).toHaveLength(all);
    fireEvent.click(screen.getByTestId('deep-dig-outliers-restore-all'));
    expect(Number(posCell(1))).toBe(n0);
    sessionStorage.clear();
  });

  it('【用户要求】推断统计页写明极端值：按因变量判几个、上次结果含不含、现在的数据里还在不在；就地全部暂时删除 / 恢复', () => {
    sessionStorage.clear();
    localStorage.clear();
    const ids = findOutliers(DATA).map(o => o.id);
    expect(ids).toContain(BIG_ID);
    // 上次结果：没去掉任何行 → 含全部极端值
    const withAll = runInference(DATA, DEFAULT_COMMANDS, { excludedKey: '' });
    const { unmount } = render(<Harness tab="infer" inference={withAll} />);
    const box = () => screen.getByTestId('deep-dig-infer-outliers');
    expect(box()).toHaveTextContent('按因变量 X = a（进场时的值）· 各组四分位距 1.5 倍以外');
    expect(screen.getByTestId('deep-dig-infer-outliers-ran')).toHaveTextContent(`上次结果：含 ${ids.length} 个极端值`);
    expect(screen.getByTestId('deep-dig-infer-outliers-now')).toHaveTextContent('现在：都在数据里，运行会包含');
    fireEvent.click(screen.getByTestId('deep-dig-infer-outliers-remove-all'));
    expect(screen.getByTestId('deep-dig-infer-outliers-now')).toHaveTextContent('现在：已全部暂时删除，运行不含');
    expect(screen.getByTestId('deep-dig-infer-stale')).toBeInTheDocument(); // 删减变了，提示重跑
    unmount();
    // 上次结果是去掉极端值之后跑的 → 不含
    const without = runInference(DATA, DEFAULT_COMMANDS, { excludedKey: exclusionKey(DATA, ids) });
    render(<Harness tab="infer" inference={without} />);
    expect(screen.getByTestId('deep-dig-infer-outliers-ran')).toHaveTextContent(`上次结果：不含极端值（${ids.length} 个都去掉了）`);
    fireEvent.click(screen.getByTestId('deep-dig-infer-outliers-restore-all'));
    expect(screen.getByTestId('deep-dig-infer-outliers-now')).toHaveTextContent('现在：都在数据里，运行会包含');
    sessionStorage.clear();
  });
});
