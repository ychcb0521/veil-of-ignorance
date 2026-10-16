import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FeatureView, type DeepDigNote, type DeepDigTab } from '@/components/journal/deepDig/FeatureView';
import { DeepDigDirectory } from '@/pages/JournalDeepDigPage';
import { deepDigRules, inferDeepDig, type DeepDigData, type DeepDigInference, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { DRIFT_SPEED_DEF, newFeatureTemplate, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { driftEvents, makeData } from '@/lib/deepDig/__tests__/fixtures';
import { groupCampaign } from '@/lib/deepRsa/grouping';
import type { CampaignGroupRow } from '@/lib/deepRsa/report';

const DATA = makeData(driftEvents(240, -1e-4));
const INF = inferDeepDig(DATA, { permutations: 199, bootstrap: 49, excludedKey: '' });

function campaignRow(id: string, b: number, r: number): CampaignGroupRow {
  const grouping = groupCampaign({
    campaignId: id, symbol: 'BTCUSDT', direction: 'main_long', deleted: false, status: 'closed_profit', settled: true, payoffBasis: 'records',
    correctionsComplete: true, anchorMs: 1, theoreticalB: b, theoreticalBApplicable: true, payoffRatio: r, initialExpectedMaxLoss: 100,
  });
  return { campaignId: id, symbol: 'BTCUSDT', title: '', anchorMs: 1, theoreticalB: b, payoffRatio: r, grouping, metrics: { pnl: r * 100 - 100, chg: 10, wear: 0 } };
}

function Harness(p: {
  data?: DeepDigData | null; inference?: DeepDigInference | null; initialTab?: DeepDigTab; onOpenCampaign?: (id: string) => void;
  onDescribe?: () => void; onInfer?: (d: DeepDigData, k: string) => void; onSaveDef?: (d: DeepDigFeatureDef) => void; initialDef?: DeepDigFeatureDef;
}) {
  const [tab, setTab] = useState<DeepDigTab>(p.initialTab ?? 'describe');
  const [group, setGroup] = useState<DeepDigRowGroup>('positive');
  const [note, setNote] = useState<DeepDigNote | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [def, setDef] = useState<DeepDigFeatureDef>(p.initialDef ?? DRIFT_SPEED_DEF);
  return (
    <FeatureView
      def={def} editing={editing} onEditingChange={setEditing} onSaveDef={d => { setDef(d); p.onSaveDef?.(d); }} onResetDef={() => {}}
      groupRows={[campaignRow('a', 4, 1), campaignRow('b', 1, 0.2), campaignRow('c', 1, 1)]}
      data={p.data === undefined ? DATA : p.data} inference={p.inference === undefined ? INF : p.inference}
      describeStatus="idle" describeProgress={null} describeError={null} canDescribe blockedReason={null}
      onDescribe={p.onDescribe ?? vi.fn()} onCancel={vi.fn()} inferStatus="idle" inferError={null} onInfer={p.onInfer ?? vi.fn()} onDownload={vi.fn()}
      excluded={excluded} onExcludedChange={setExcluded}
      tab={tab} onTabChange={setTab} group={group} onGroupChange={setGroup} showAll={showAll} onShowAllChange={setShowAll}
      onOpenCampaign={p.onOpenCampaign ?? vi.fn()} note={note} onSaveNote={setNote}
    />
  );
}

describe('【用户要求】Deep dig 特征值页', { timeout: 60_000 }, () => {
  it('目录：列出特征值、三个模块入口、摘要；底部有「新增特征值」', () => {
    const onOpen = vi.fn();
    const onAdd = vi.fn();
    const custom = newFeatureTemplate(1);
    render(<DeepDigDirectory defs={[DRIFT_SPEED_DEF, custom]} results={{ [DRIFT_SPEED_DEF.id]: { data: DATA, inference: INF } }} notes={{}} onOpen={onOpen} onAdd={onAdd} />);
    const entries = screen.getAllByTestId('deep-dig-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toMatch(/多空博弈均衡点漂移速度 V.*实验组 -?\d+\.\d\d · 对照组 -?\d+\.\d\d 基点\/根 · t 检验 p/);
    expect(entries[1]).toHaveTextContent('未运行');
    fireEvent.click(screen.getByTestId(`deep-dig-open-${custom.id}-infer`));
    expect(onOpen).toHaveBeenCalledWith(custom.id, 'infer');
    fireEvent.click(screen.getByTestId('deep-dig-add'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('【用户要求】删除特征值：平时隐形，点 × 还要确认；新增项直接删，内置项从目录删掉后底部可恢复', () => {
    const onDelete = vi.fn();
    const onRestore = vi.fn();
    const custom = newFeatureTemplate(1);
    render(<DeepDigDirectory defs={[custom]} results={{}} notes={{}} onOpen={vi.fn()} onAdd={vi.fn()} onDelete={onDelete} removed={[DRIFT_SPEED_DEF]} onRestore={onRestore} />);
    const x = screen.getByTestId(`deep-dig-delete-${custom.id}`);
    expect(x.className).toContain('opacity-0');
    fireEvent.click(x);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`deep-dig-delete-confirm-${custom.id}`));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: custom.id }));
    expect(screen.getByTestId('deep-dig-removed-features')).toHaveTextContent('多空博弈均衡点漂移速度 V');
    fireEvent.click(screen.getByTestId(`deep-dig-restore-${DRIFT_SPEED_DEF.id}`));
    expect(onRestore).toHaveBeenCalledWith(DRIFT_SPEED_DEF.id);
  });

  it('定义区：显示公式与分组标准；编辑时写错公式给出行号，分组标准即时预览本机战役各组多少场；保存后提示按旧定义算', () => {
    const onSaveDef = vi.fn();
    render(<Harness onSaveDef={onSaveDef} />);
    expect(screen.getByTestId('deep-dig-def-formula')).toHaveTextContent('V = ema(U, 6, 0)');
    expect(screen.getByTestId('deep-dig-def-groups')).toHaveTextContent('b > 3 or r > 3');
    fireEvent.click(screen.getByTestId('deep-dig-def-edit'));
    expect(screen.getByTestId('deep-dig-def-preview')).toHaveTextContent('实验组 1 · 对照组 1 · 冲突 0 · 其他 1');
    fireEvent.change(screen.getByTestId('deep-dig-def-formula-input'), { target: { value: 'X = ln(C)\nY * 2' } });
    expect(screen.getByTestId('deep-dig-def-formula-error')).toHaveTextContent('第 2 行：不认识「Y」');
    fireEvent.click(screen.getByTestId('deep-dig-def-save'));
    expect(onSaveDef).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('deep-dig-def-formula-input'), { target: { value: 'ln(C / prev(C, 12))' } });
    fireEvent.change(screen.getByTestId('deep-dig-def-positive'), { target: { value: 'r > 2' } });
    expect(screen.getByTestId('deep-dig-def-preview')).toHaveTextContent('实验组 0');
    fireEvent.click(screen.getByTestId('deep-dig-def-help-toggle'));
    expect(screen.getByTestId('deep-dig-def-help')).toHaveTextContent('ema(x, h, 初值)');
    fireEvent.click(screen.getByTestId('deep-dig-def-save'));
    expect(onSaveDef).toHaveBeenCalledWith(expect.objectContaining({ formula: 'ln(C / prev(C, 12))', positive: 'r > 2' }));
    expect(screen.getByTestId('deep-dig-def-formula')).toHaveTextContent('ln(C / prev(C, 12))');
    expect(screen.getByTestId('deep-dig-stale')).toHaveTextContent('公式或分组标准改过了');
  });

  it('【用户要求】分组标准可以就地改：描述统计「分组」处点「改标准」，写错不能保存，预览各组场数，保存后提示按新标准重跑', () => {
    const onSaveDef = vi.fn();
    render(<Harness onSaveDef={onSaveDef} />);
    const box = screen.getByTestId('deep-dig-describe-groups');
    expect(box).toHaveTextContent('b > 3 or r > 3');
    fireEvent.click(screen.getByTestId('deep-dig-describe-groups-edit'));
    fireEvent.change(screen.getByTestId('deep-dig-describe-groups-positive'), { target: { value: 'b > ' } });
    expect(screen.getByTestId('deep-dig-describe-groups-error')).toHaveTextContent('实验组条件');
    expect(screen.getByTestId('deep-dig-describe-groups-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('deep-dig-describe-groups-positive'), { target: { value: 'b > 2 and r > 0.5' } });
    expect(screen.getByTestId('deep-dig-describe-groups-preview')).toHaveTextContent('实验组 1 · 对照组 1 · 冲突 0 · 其他 1');
    expect(screen.getByTestId('deep-dig-describe-groups-default')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-describe-groups-save'));
    expect(onSaveDef).toHaveBeenCalledWith(expect.objectContaining({ positive: 'b > 2 and r > 0.5', control: 'b < 0.5 or r < 0.5', formula: DRIFT_SPEED_DEF.formula }));
    expect(screen.getByTestId('deep-dig-describe-groups')).toHaveTextContent('b > 2 and r > 0.5');
    expect(screen.getByTestId('deep-dig-def-groups')).toHaveTextContent('b > 2 and r > 0.5');
    expect(screen.getByTestId('deep-dig-stale')).toHaveTextContent('分组标准改过了');
    // 定义区那一处也能改，Esc 取消不保存
    fireEvent.click(screen.getByTestId('deep-dig-def-groups-edit'));
    fireEvent.change(screen.getByTestId('deep-dig-def-groups-control'), { target: { value: 'r < 0' } });
    fireEvent.keyDown(screen.getByTestId('deep-dig-def-groups-control'), { key: 'Escape' });
    expect(onSaveDef).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('deep-dig-def-groups')).toHaveTextContent('b < 0.5 or r < 0.5');
  });

  it('描述统计与推断统计各有自己的运行按钮；推断统计没有描述数据时不能运行', () => {
    const onDescribe = vi.fn();
    const onInfer = vi.fn();
    render(<Harness data={null} inference={null} onDescribe={onDescribe} onInfer={onInfer} />);
    fireEvent.click(screen.getByTestId('deep-dig-describe-run-button'));
    expect(onDescribe).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('deep-dig-tab-infer'));
    expect(screen.getByTestId('deep-dig-infer-run-button')).toBeDisabled();
    expect(screen.getByTestId('deep-dig-infer-run')).toHaveTextContent('先运行描述统计');
  });

  it('描述统计：分组表、点阵图、逐场数据；点一行打开战役；整行删掉后不进统计，可查看恢复；推断统计提示重跑并在删减后的数据上运行', () => {
    const onOpen = vi.fn();
    const onInfer = vi.fn();
    render(<Harness onOpenCampaign={onOpen} onInfer={onInfer} />);
    const nPos = DATA.groups.find(g => g.group === 'positive')!.n;
    expect(screen.getByTestId('deep-dig-groups')).toHaveTextContent('标准差');
    expect(screen.getByTestId('deep-dig-strip')).toBeInTheDocument();
    expect(within(screen.getByTestId('deep-dig-rows')).getAllByTestId('deep-dig-row')).toHaveLength(15);
    fireEvent.click(screen.getByTestId('deep-dig-rows-toggle'));
    const rows = within(screen.getByTestId('deep-dig-rows')).getAllByTestId('deep-dig-row');
    expect(rows).toHaveLength(nPos);
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith(expect.stringMatching(/^c\d+/));
    onOpen.mockClear();
    const del = within(rows[0]).getByTestId('deep-dig-row-delete');
    expect(del.className).toContain('opacity-0'); // 不常用：平时隐形，鼠标移到这一行才出现
    fireEvent.click(del);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId('deep-dig-group-positive')).toHaveTextContent(String(nPos - 1));
    expect(screen.getByTestId('deep-dig-details')).toHaveTextContent('手动删掉 1 行');
    fireEvent.click(screen.getByTestId('deep-dig-removed-toggle'));
    expect(screen.getAllByTestId('deep-dig-removed-row')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('deep-dig-tab-infer'));
    expect(screen.getByTestId('deep-dig-infer-stale')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-infer-run-button'));
    expect(onInfer).toHaveBeenCalledWith(expect.objectContaining({ rows: expect.any(Array) }), expect.any(String));
    expect(onInfer.mock.calls[0][0].rows).toHaveLength(DATA.rows.length - 1);
    fireEvent.click(screen.getByTestId('deep-dig-tab-describe'));
    fireEvent.click(screen.getByTestId('deep-dig-removed-toggle'));
    fireEvent.click(screen.getByTestId('deep-dig-row-restore'));
    expect(screen.getByTestId('deep-dig-group-positive')).toHaveTextContent(String(nPos));
    expect(screen.queryByTestId('deep-dig-removed')).toBeNull();
  });

  it('推断统计：t 检验、排名比较、相关（含确认集）、五分位', () => {
    render(<Harness initialTab="infer" />);
    expect(screen.getByTestId('deep-dig-ttest')).toHaveTextContent('Welch');
    expect(screen.getByTestId('deep-dig-auc')).toHaveTextContent('AUC');
    for (const k of ['endRet', 'maxUp', 'maxDown']) expect(screen.getByTestId(`deep-dig-assoc-${k}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('deep-dig-quintiles')).getAllByText(/^Q\d$/)).toHaveLength(5);
    expect(screen.queryByTestId('deep-dig-infer-stale')).toBeNull();
  });

  it('规律提取：默认是统计结果；可编辑、保存后标「手动修改」，可恢复为统计结果', () => {
    render(<Harness initialTab="rules" />);
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('统计得出');
    expect(within(screen.getByTestId('deep-dig-rules-list')).getAllByRole('listitem')).toHaveLength(deepDigRules(DATA, INF).length);
    fireEvent.click(screen.getByTestId('deep-dig-rules-edit'));
    fireEvent.change(screen.getByTestId('deep-dig-rules-input'), { target: { value: '只在 V 回落到 0 附近时进场\n\n仓位减半' } });
    fireEvent.click(screen.getByTestId('deep-dig-rules-save'));
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('手动修改');
    expect(within(screen.getByTestId('deep-dig-rules-list')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['1只在 V 回落到 0 附近时进场', '2仓位减半']);
    fireEvent.click(screen.getByTestId('deep-dig-rules-reset'));
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('统计得出');
  });
});
