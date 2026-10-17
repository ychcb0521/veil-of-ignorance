import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FeatureView, type DeepDigNote, type DeepDigTab } from '@/components/journal/deepDig/FeatureView';
import { DeepDigDirectory } from '@/pages/JournalDeepDigPage';
import { deepDigRules, type DeepDigData, type DeepDigInference, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { DEFAULT_COMMANDS, runInference } from '@/lib/deepDig/commands';
import { campaignSample, DRIFT_SPEED_DEF, newFeatureTemplate, signalSample, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { DeepDigSeries } from '@/lib/deepDig/series';
import { driftEvents, makeData } from '@/lib/deepDig/__tests__/fixtures';
import { groupCampaign } from '@/lib/deepRsa/grouping';
import type { CampaignGroupRow } from '@/lib/deepRsa/report';

const DATA = makeData(driftEvents(240, -1e-4));
const SIGNALS: TradeSignal[] = [5, 4, 2, 1, undefined].map((quality, i) => ({ id: `s${i}`, symbol: 'SOLUSDT', timeMs: Date.parse('2026-08-01T00:00:00Z') + i * 86_400_000, timeLabel: '', fallbackZone: '', quality }));
const ALL_COMMANDS = `${DEFAULT_COMMANDS}\nregress(endRet ~ X + vol)\nanova(X, 实验组, 对照组, 其他, 随机)\nrsa(X, 组别, perm=19)\nml(实验组 ~ X + vol, cv=5, perm=9)`;
const INF = runInference(DATA, ALL_COMMANDS, { excludedKey: '' });

function campaignRow(id: string, b: number, r: number): CampaignGroupRow {
  const grouping = groupCampaign({
    campaignId: id, symbol: 'BTCUSDT', direction: 'main_long', deleted: false, status: 'closed_profit', settled: true, payoffBasis: 'records',
    correctionsComplete: true, anchorMs: 1, theoreticalB: b, theoreticalBApplicable: true, payoffRatio: r, initialExpectedMaxLoss: 100,
  });
  return { campaignId: id, symbol: 'BTCUSDT', title: '', anchorMs: 1, theoreticalB: b, payoffRatio: r, grouping, letters: { p: r * 100 - 100, c: 10, w: 0 } };
}

function Harness(p: {
  data?: DeepDigData | null; inference?: DeepDigInference | null; initialTab?: DeepDigTab; onOpenCampaign?: (id: string) => void;
  onDescribe?: () => void; onInfer?: (d: DeepDigData, k: string) => void; onSaveDef?: (d: DeepDigFeatureDef) => void; initialDef?: DeepDigFeatureDef; series?: DeepDigSeries | null;
}) {
  const [tab, setTab] = useState<DeepDigTab>(p.initialTab ?? 'describe');
  const [group, setGroup] = useState<DeepDigRowGroup>('positive');
  const [note, setNote] = useState<DeepDigNote | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [commands, setCommands] = useState(ALL_COMMANDS);
  const [def, setDef] = useState<DeepDigFeatureDef>(p.initialDef ?? DRIFT_SPEED_DEF);
  return (
    <FeatureView
      def={def} editing={editing} onEditingChange={setEditing} onSaveDef={d => { setDef(d); p.onSaveDef?.(d); }} onResetDef={() => {}}
      samples={{ campaigns: [campaignRow('a', 4, 1), campaignRow('b', 1, 0.2), campaignRow('c', 1, 1)].map(campaignSample), signals: SIGNALS.map(signalSample) }}
      data={p.data === undefined ? DATA : p.data} series={p.series} inference={p.inference === undefined ? INF : p.inference}
      describeStatus="idle" describeProgress={null} describeError={null} canDescribe blockedReason={null}
      onDescribe={p.onDescribe ?? vi.fn()} onCancel={vi.fn()} inferStatus="idle" inferError={null} onInfer={p.onInfer ?? vi.fn()} onDownload={vi.fn()}
      excluded={excluded} onExcludedChange={setExcluded} commands={commands} onCommandsChange={setCommands}
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
    expect(entries[0].textContent).toMatch(/买方推力的加速度 a.*实验组 -?\d+\.\d\d · 对照组 -?\d+\.\d\d 基点\/根 · t 检验 p/);
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
    expect(screen.getByTestId('deep-dig-removed-features')).toHaveTextContent('买方推力的加速度 a');
    fireEvent.click(screen.getByTestId(`deep-dig-restore-${DRIFT_SPEED_DEF.id}`));
    expect(onRestore).toHaveBeenCalledWith(DRIFT_SPEED_DEF.id);
  });

  it('定义区：显示公式与分组标准；编辑时写错公式给出行号，分组标准即时预览本机战役各组多少场；保存后提示按旧定义算', () => {
    const onSaveDef = vi.fn();
    render(<Harness onSaveDef={onSaveDef} />);
    expect(screen.getByTestId('deep-dig-def-formula')).toHaveTextContent('V = ema(U, hl, 0)');
    expect(screen.getByTestId('deep-dig-def-groups')).toHaveTextContent('Bₜ > 3 or b > 3');
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
    expect(screen.getByTestId('deep-dig-stale')).toHaveTextContent('公式、周期、半衰期或分组标准改过了');
  });

  it('【用户要求】分组标准可以就地改：描述统计「分组」处点「改标准」，写错不能保存，预览各组场数，保存后提示按新标准重跑', () => {
    const onSaveDef = vi.fn();
    render(<Harness onSaveDef={onSaveDef} />);
    const box = screen.getByTestId('deep-dig-describe-groups');
    expect(box).toHaveTextContent('Bₜ > 3 or b > 3');
    fireEvent.click(screen.getByTestId('deep-dig-describe-groups-edit'));
    fireEvent.change(screen.getByTestId('deep-dig-describe-groups-positive'), { target: { value: 'b > ' } });
    expect(screen.getByTestId('deep-dig-describe-groups-error')).toHaveTextContent('实验组条件');
    expect(screen.getByTestId('deep-dig-describe-groups-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('deep-dig-describe-groups-positive'), { target: { value: 'Bₜ > 2 and b > 0.5' } });
    expect(screen.getByTestId('deep-dig-describe-groups-preview')).toHaveTextContent('实验组 1 · 对照组 1 · 冲突 0 · 其他 1');
    expect(screen.getByTestId('deep-dig-describe-groups-default')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-describe-groups-save'));
    expect(onSaveDef).toHaveBeenCalledWith(expect.objectContaining({ positive: 'Bₜ > 2 and b > 0.5', control: 'Bₜ < 0.5 or b < 0.5', formula: DRIFT_SPEED_DEF.formula }));
    expect(screen.getByTestId('deep-dig-describe-groups')).toHaveTextContent('Bₜ > 2 and b > 0.5');
    expect(screen.getByTestId('deep-dig-def-groups')).toHaveTextContent('Bₜ > 2 and b > 0.5');
    expect(screen.getByTestId('deep-dig-stale')).toHaveTextContent('分组标准改过了');
    // 定义区那一处也能改，Esc 取消不保存
    fireEvent.click(screen.getByTestId('deep-dig-def-groups-edit'));
    fireEvent.change(screen.getByTestId('deep-dig-def-groups-control'), { target: { value: 'r < 0' } });
    fireEvent.keyDown(screen.getByTestId('deep-dig-def-groups-control'), { key: 'Escape' });
    expect(onSaveDef).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('deep-dig-def-groups')).toHaveTextContent('Bₜ < 0.5 or b < 0.5');
  });

  it('【用户要求】周期、半衰期可选：定义区点一下就保存，摘要换算成根数与观察窗；改了提示按旧定义算；默认值不写进定义', () => {
    const onSaveDef = vi.fn();
    render(<Harness onSaveDef={onSaveDef} />);
    expect(screen.getByTestId('deep-dig-kline-interval-5m')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('deep-dig-kline-hl-6')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('deep-dig-kline-hl-summary')).toHaveTextContent('hl = 72 根 5 分钟 K 线');
    expect(screen.getByTestId('deep-dig-kline-avg-summary')).toHaveTextContent('avgh = 288 根');
    expect(screen.getByTestId('deep-dig-kline-summary')).toHaveTextContent('观察窗：进场前 2 天的已收盘 5 分钟 K 线');
    expect(screen.queryByTestId('deep-dig-kline-avg-unused')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-kline-interval-15m'));
    expect(onSaveDef).toHaveBeenLastCalledWith(expect.objectContaining({ interval: '15m', halfLifeHours: undefined }));
    expect(screen.getByTestId('deep-dig-kline-hl-summary')).toHaveTextContent('hl = 24 根 15 分钟 K 线');
    expect(screen.getByTestId('deep-dig-kline-avg-summary')).toHaveTextContent('avgh = 96 根');
    expect(screen.getByTestId('deep-dig-stale')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-kline-hl-12'));
    expect(onSaveDef).toHaveBeenLastCalledWith(expect.objectContaining({ interval: '15m', halfLifeHours: 12 }));
    expect(screen.getByTestId('deep-dig-kline-summary')).toHaveTextContent('进场前 4 天');
    // 自定半衰期：回车生效；乱写不改
    fireEvent.change(screen.getByTestId('deep-dig-kline-hl-custom'), { target: { value: '3' } });
    fireEvent.keyDown(screen.getByTestId('deep-dig-kline-hl-custom'), { key: 'Enter' });
    expect(onSaveDef).toHaveBeenLastCalledWith(expect.objectContaining({ halfLifeHours: 3 }));
    const calls = onSaveDef.mock.calls.length;
    fireEvent.change(screen.getByTestId('deep-dig-kline-hl-custom'), { target: { value: 'abc' } });
    fireEvent.keyDown(screen.getByTestId('deep-dig-kline-hl-custom'), { key: 'Enter' });
    expect(onSaveDef).toHaveBeenCalledTimes(calls);
    // 【用户要求】平均时长：点选、自定都行
    fireEvent.click(screen.getByTestId('deep-dig-kline-avg-48'));
    expect(onSaveDef).toHaveBeenLastCalledWith(expect.objectContaining({ avgHours: 48 }));
    expect(screen.getByTestId('deep-dig-kline-avg-summary')).toHaveTextContent('avgh = 192 根');
    fireEvent.change(screen.getByTestId('deep-dig-kline-avg-custom'), { target: { value: '36' } });
    fireEvent.blur(screen.getByTestId('deep-dig-kline-avg-custom'));
    expect(onSaveDef).toHaveBeenLastCalledWith(expect.objectContaining({ avgHours: 36 }));
    expect(screen.getByTestId('deep-dig-kline-avg-custom')).toHaveValue('36');
    // 换回默认：不写进定义
    fireEvent.click(screen.getByTestId('deep-dig-kline-interval-5m'));
    fireEvent.click(screen.getByTestId('deep-dig-kline-hl-6'));
    fireEvent.click(screen.getByTestId('deep-dig-kline-avg-24'));
    expect(onSaveDef).toHaveBeenLastCalledWith(expect.objectContaining({ interval: undefined, halfLifeHours: undefined, avgHours: undefined }));
    expect(screen.queryByTestId('deep-dig-stale')).not.toBeInTheDocument();
  });

  it('公式里没用到的参数旁边注一句', () => {
    render(<Harness initialDef={{ ...DRIFT_SPEED_DEF, formula: 'ln(C / prev(C, 12))' }} />);
    expect(screen.getByTestId('deep-dig-kline-hl-unused')).toHaveTextContent('公式里没用 hl');
    expect(screen.getByTestId('deep-dig-kline-avg-unused')).toHaveTextContent('公式里没用 avgh');
  });

  it('【用户要求】推断统计选因变量：列出公式里的变量，默认最后一句；点选改命令里的 X = 一行；写明 X 是谁；数据里没有时提示重跑', () => {
    const onInfer = vi.fn();
    const def = { ...DRIFT_SPEED_DEF, formula: `${DRIFT_SPEED_DEF.formula}\nVV = avg(V, 24)` };
    // 描述统计数据带公式变量（VV 是最后一句 = 特征值）
    const data = { ...DATA, definition: { ...DATA.definition, formula: def.formula }, rows: DATA.rows.map(r => ({ ...r, vars: { N: 1, F: r.v == null ? null : -r.v, A: 0, G: 1, R: 0, U: 0, V: r.v, VV: r.v } })) };
    render(<Harness initialTab="infer" initialDef={def} data={data} inference={null} onInfer={onInfer} />);
    const chips = screen.getAllByRole('radio').map(b => b.getAttribute('data-testid'));
    expect(chips).toEqual(['N', 'F', 'A', 'G', 'R', 'U', 'V', 'VV'].map(n => `deep-dig-target-${n}`));
    expect(screen.getByTestId('deep-dig-target-VV')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('deep-dig-target-VV')).toHaveTextContent('VV结果');
    expect(screen.getByTestId('deep-dig-target-summary')).toHaveTextContent('X = VV（公式最后一句）× 10000 · 基点/根');
    fireEvent.click(screen.getByTestId('deep-dig-target-F'));
    expect(screen.getByTestId('deep-dig-target-F')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('deep-dig-target-VV')).toHaveAttribute('aria-checked', 'false');
    expect((screen.getByTestId('deep-dig-commands-input') as HTMLTextAreaElement).value.split('\n')[1]).toBe('X = F');
    expect(screen.getByTestId('deep-dig-target-summary')).toHaveTextContent('X = F × 10000');
    // 直接在命令里改也行，按钮跟着变
    fireEvent.change(screen.getByTestId('deep-dig-commands-input'), { target: { value: 'X = V\nttest(X, 实验组, 对照组)' } });
    expect(screen.getByTestId('deep-dig-target-V')).toHaveAttribute('aria-checked', 'true');
    // 公式里没有的：标红
    fireEvent.change(screen.getByTestId('deep-dig-commands-input'), { target: { value: 'X = Q\nttest(X, 实验组, 对照组)' } });
    expect(screen.getByTestId('deep-dig-target-summary')).toHaveTextContent('公式里没有这个变量');
    expect(screen.getByTestId('deep-dig-commands-errors')).toHaveTextContent('公式里没有「Q」');
    // 选回最后一句：删掉 X = 那一行
    fireEvent.click(screen.getByTestId('deep-dig-target-VV'));
    expect((screen.getByTestId('deep-dig-commands-input') as HTMLTextAreaElement).value).toBe('ttest(X, 实验组, 对照组)');
  });

  it('选了描述统计数据里还没有的变量：提示先重跑描述统计；结果上方写明这次的因变量', () => {
    const def = { ...DRIFT_SPEED_DEF, formula: `${DRIFT_SPEED_DEF.formula}\nVV = avg(V, 24)` };
    const withF = { ...DATA, rows: DATA.rows.map(r => ({ ...r, vars: { F: r.v, V: r.v } })) };
    const inf = runInference(withF, `X = F\n${DEFAULT_COMMANDS}`, { excludedKey: '' });
    render(<Harness initialTab="infer" initialDef={def} data={DATA} inference={inf} />);
    fireEvent.click(screen.getByTestId('deep-dig-target-F'));
    expect(screen.getByTestId('deep-dig-target-summary')).toHaveTextContent('描述统计的数据里还没有，先重新运行描述统计');
    expect(screen.getByTestId('deep-dig-infer-target')).toHaveTextContent('这次的因变量：X = F × 10000');
  });

  it('【用户要求】描述统计画各组的时间序列曲线：变量可选（默认公式最后一句），删掉的行不算；悬停看读数；可隐藏组、看数字', () => {
    const H = 3_600_000;
    const offsets = Array.from({ length: 49 }, (_, i) => (i - 24) * H);
    const names = ['N', 'F', 'A', 'G', 'R', 'U', 'V'];
    const byEvent: Record<string, Float32Array> = {};
    for (const r of DATA.rows) {
      if (r.v == null) continue;
      const a = new Float32Array(names.length * 49).fill(0);
      for (let k = 0; k < 49; k++) { a[6 * 49 + k] = r.v * (k / 24); a[1 * 49 + k] = -r.v; }
      byEvent[r.id] = a;
    }
    const series: DeepDigSeries = { finishedAt: DATA.finishedAt, offsets, names, result: 'V', byEvent };
    localStorage.clear();
    const { unmount } = render(<Harness series={null} />);
    expect(screen.getByTestId('deep-dig-series-empty')).toHaveTextContent('重新运行描述统计后显示');
    unmount();
    render(<Harness series={series} />);
    expect(screen.getByTestId('deep-dig-series-var-V')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('deep-dig-series-unit')).toHaveTextContent('V（公式最后一句） × 10000 · 基点/根');
    for (const g of ['positive', 'control', 'other', 'background']) expect(screen.getByTestId(`deep-dig-series-line-${g}`)).toBeInTheDocument();
    // 图例的 n = 有曲线的事件数（与分组表一致）
    const posN = DATA.groups.find(g => g.group === 'positive')!.n;
    expect(screen.getByTestId('deep-dig-series-legend-positive')).toHaveTextContent(`实验组${posN}`);
    // 看数字：τ = 0 的平均 = 分组表的均值（V 在 τ = 0 就是特征值）
    fireEvent.click(screen.getByTestId('deep-dig-series-table-toggle'));
    const table = screen.getByTestId('deep-dig-series-table');
    const head = within(table).getAllByRole('columnheader').map(h => h.textContent);
    const zeroCol = head.indexOf('进场');
    const posRow = within(table).getAllByRole('row').find(r => r.textContent?.startsWith('实验组'))!;
    const meanAt0 = within(posRow).getAllByRole('cell')[zeroCol].textContent;
    expect(meanAt0).toBe((DATA.groups.find(g => g.group === 'positive')!.mean! * 1e4).toFixed(2));
    fireEvent.click(screen.getByTestId('deep-dig-series-table-toggle'));
    // 换变量 F
    fireEvent.click(screen.getByTestId('deep-dig-series-var-F'));
    expect(screen.getByTestId('deep-dig-series-var-F')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('deep-dig-series-unit')).toHaveTextContent('F × 10000');
    // 隐藏一组
    fireEvent.click(screen.getByTestId('deep-dig-series-legend-other'));
    expect(screen.queryByTestId('deep-dig-series-line-other')).not.toBeInTheDocument();
    expect(screen.getByTestId('deep-dig-series-legend-other')).toHaveAttribute('aria-checked', 'false');
    // 悬停
    const hit = screen.getByTestId('deep-dig-series-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseMove(hit, { clientX: 50 });
    expect(screen.getByTestId('deep-dig-series-tooltip')).toHaveTextContent('进场');
    // 删掉一行实验组（数据表默认显示实验组）：图例的 n 少 1
    fireEvent.click(screen.getAllByTestId('deep-dig-row-delete')[0]);
    expect(screen.getByTestId('deep-dig-series-legend-positive')).toHaveTextContent(`实验组${posN - 1}`);
    localStorage.clear();
  });

  it('【用户要求】时间序列图的组别可以选取和删减：逐组勾选，表格跟着变，全部去掉有提示，「全部显示」恢复，选择记在本机', () => {
    localStorage.clear();
    const H = 3_600_000;
    const offsets = Array.from({ length: 49 }, (_, i) => (i - 24) * H);
    const byEvent: Record<string, Float32Array> = {};
    for (const r of DATA.rows) if (r.v != null) byEvent[r.id] = new Float32Array(49).fill(r.v);
    const series: DeepDigSeries = { finishedAt: DATA.finishedAt, offsets, names: ['V'], result: 'V', byEvent };
    const { unmount } = render(<Harness series={series} />);
    for (const g of ['positive', 'control', 'other', 'background']) expect(screen.getByTestId(`deep-dig-series-legend-${g}`)).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('deep-dig-series-groups-all')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-series-legend-other'));
    fireEvent.click(screen.getByTestId('deep-dig-series-legend-background'));
    expect(screen.getByTestId('deep-dig-series-line-positive')).toBeInTheDocument();
    expect(screen.queryByTestId('deep-dig-series-line-background')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-series-table-toggle'));
    expect(within(screen.getByTestId('deep-dig-series-table')).getAllByRole('row')).toHaveLength(3);
    fireEvent.click(screen.getByTestId('deep-dig-series-table-toggle'));
    // 换个页面再回来：选择还在
    unmount();
    render(<Harness series={series} />);
    expect(screen.getByTestId('deep-dig-series-legend-other')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('deep-dig-series-line-other')).not.toBeInTheDocument();
    // 全部去掉：提示
    fireEvent.click(screen.getByTestId('deep-dig-series-legend-positive'));
    fireEvent.click(screen.getByTestId('deep-dig-series-legend-control'));
    expect(screen.getByTestId('deep-dig-series-none')).toHaveTextContent('没有选组');
    // 全部显示
    fireEvent.click(screen.getByTestId('deep-dig-series-groups-all'));
    for (const g of ['positive', 'control', 'other', 'background']) expect(screen.getByTestId(`deep-dig-series-line-${g}`)).toBeInTheDocument();
    localStorage.clear();
  });

  it('【用户要求】分组表跟着时间序列图选的变量：选 F 就按 F 统计（n、均值、> 0 占比、点阵图、逐场数据），选回结果复原', () => {
    localStorage.clear();
    const def = { ...DRIFT_SPEED_DEF, formula: `${DRIFT_SPEED_DEF.formula}\nVV = avg(V, 24)` };
    // F = −2 × 结果；部分行 F 缺失
    const rows = DATA.rows.map((r, i) => ({ ...r, vars: { F: r.v == null || i % 10 === 0 ? null : -2 * r.v, V: r.v, VV: r.v } }));
    const data = { ...DATA, definition: { ...DATA.definition, formula: def.formula }, rows };
    const H = 3_600_000;
    const series: DeepDigSeries = { finishedAt: DATA.finishedAt, offsets: [-H, 0, H], names: ['F', 'V', 'VV'], result: 'VV', byEvent: {} };
    render(<Harness initialDef={def} data={data} series={series} />);
    const table = () => screen.getByTestId('deep-dig-groups');
    const posRow = () => within(table()).getAllByRole('row').find(r => r.textContent?.startsWith('实验组'))!;
    const cells = () => within(posRow()).getAllByRole('cell').map(c => c.textContent);
    expect(screen.getByTestId('deep-dig-groups-var')).toHaveTextContent('按 VV 统计 · 单位 基点/根');
    const pos = DATA.groups.find(g => g.group === 'positive')!;
    expect(cells()[1]).toBe(String(pos.n));
    expect(cells()[2]).toBe((pos.mean! * 1e4).toFixed(2));
    fireEvent.click(screen.getByTestId('deep-dig-series-var-F'));
    expect(screen.getByTestId('deep-dig-groups-var')).toHaveTextContent('按 F 统计（公式里的变量）· 原值 × 10000');
    const fPos = rows.filter(r => r.group === 'positive' && r.vars.F != null).map(r => r.vars.F!);
    expect(cells()[1]).toBe(String(fPos.length));
    expect(cells()[2]).toBe((fPos.reduce((a, b) => a + b, 0) / fPos.length * 1e4).toFixed(2));
    expect(within(table()).getAllByRole('columnheader').at(-1)).toHaveTextContent('F > 0');
    // 选回结果
    fireEvent.click(screen.getByTestId('deep-dig-series-var-VV'));
    expect(cells()[1]).toBe(String(pos.n));
  });

  it('【用户要求】公式可以就地改：写错提示行号且不能保存，保存后提示按新公式重跑，内置项可填回默认', () => {
    const onSaveDef = vi.fn();
    render(<Harness onSaveDef={onSaveDef} />);
    fireEvent.click(screen.getByTestId('deep-dig-def-formula-edit'));
    const box = screen.getByTestId('deep-dig-def-formula-inline');
    fireEvent.change(box, { target: { value: 'A = ln(C)\nZ + 1' } });
    expect(screen.getByTestId('deep-dig-def-formula-inline-error')).toHaveTextContent('第 2 行：不认识「Z」');
    expect(screen.getByTestId('deep-dig-def-formula-save')).toBeDisabled();
    fireEvent.change(box, { target: { value: 'ln(C / prev(C, 12))' } });
    fireEvent.click(screen.getByTestId('deep-dig-def-formula-save'));
    expect(onSaveDef).toHaveBeenCalledWith(expect.objectContaining({ formula: 'ln(C / prev(C, 12))', positive: DRIFT_SPEED_DEF.positive }));
    expect(screen.getByTestId('deep-dig-def-formula')).toHaveTextContent('ln(C / prev(C, 12))');
    expect(screen.getByTestId('deep-dig-stale')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deep-dig-def-formula-edit'));
    fireEvent.click(screen.getByTestId('deep-dig-def-formula-default'));
    expect((screen.getByTestId('deep-dig-def-formula-inline') as HTMLTextAreaElement).value).toBe(DRIFT_SPEED_DEF.formula);
  });

  it('【用户要求】分组样本可选信号库：切换后换成信号的默认条件（s 星级），预览按信号数；指标表列出可用字母', () => {
    const onSaveDef = vi.fn();
    render(<Harness onSaveDef={onSaveDef} />);
    fireEvent.click(screen.getByTestId('deep-dig-describe-groups-edit'));
    fireEvent.click(screen.getByTestId('deep-dig-describe-groups-letters-toggle'));
    const table = screen.getByTestId('metric-letter-table');
    expect(table).toHaveTextContent('首仓涨跌幅');
    expect(table).toHaveTextContent('盈亏比');
    expect(screen.getByTestId('metric-letter-Bt').className).toContain('bg-'); // 条件里用到的字母标亮
    fireEvent.click(screen.getByTestId('deep-dig-describe-groups-source-signals'));
    expect((screen.getByTestId('deep-dig-describe-groups-positive') as HTMLInputElement).value).toBe('s >= 3');
    expect(screen.getByTestId('deep-dig-describe-groups-preview')).toHaveTextContent('本机信号（去重前）：实验组 2 · 对照组 2 · 冲突 0 · 其他 1');
    expect(screen.getByTestId('metric-letter-table')).toHaveTextContent('信号评分');
    fireEvent.change(screen.getByTestId('deep-dig-describe-groups-positive'), { target: { value: 's >= 4' } });
    fireEvent.click(screen.getByTestId('deep-dig-describe-groups-save'));
    expect(onSaveDef).toHaveBeenCalledWith(expect.objectContaining({ source: 'signals', positive: 's >= 4', control: 's < 3', groupVars: 2 }));
    expect(screen.getByTestId('deep-dig-describe-groups-source')).toHaveTextContent('信号库');
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

  it('【用户要求】推断统计运行前给出命令与可选方法：勾选加行、取消删行，写错的行标红，改了命令提示重跑', () => {
    const onInfer = vi.fn();
    render(<Harness initialTab="infer" onInfer={onInfer} />);
    const input = screen.getByTestId('deep-dig-commands-input') as HTMLTextAreaElement;
    expect(input.value).toContain('ttest(X, 实验组, 对照组)');
    expect(screen.getByTestId('deep-dig-method-ttest')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('deep-dig-method-regress')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('deep-dig-infer-stale')).toBeNull();
    fireEvent.click(screen.getByTestId('deep-dig-method-regress'));
    expect(input.value.trim().split('\n').at(-1)).toBe('regress(endRet ~ X)');
    expect(screen.getByTestId('deep-dig-infer-stale')).toHaveTextContent('命令改过了');
    fireEvent.click(screen.getByTestId('deep-dig-method-ttest'));
    expect(input.value).not.toContain('ttest(');
    fireEvent.change(input, { target: { value: `${input.value}\nttest(X, 甲组)` } });
    expect(screen.getByTestId('deep-dig-commands-errors')).toHaveTextContent('不认识组名「甲组」');
    fireEvent.click(screen.getByTestId('deep-dig-commands-help-toggle'));
    expect(screen.getByTestId('deep-dig-commands-help')).toHaveTextContent('多元回归');
    fireEvent.click(screen.getByTestId('deep-dig-infer-run-button'));
    expect(onInfer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('deep-dig-commands-default'));
    expect(input.value).toBe(DEFAULT_COMMANDS);
  });

  it('推断统计结果：每条命令一张卡片（t 检验、排名比较、相关、五分位、多元回归、方差分析、RSA、机器学习）', () => {
    render(<Harness initialTab="infer" />);
    for (const k of ['ttest', 'mannwhitney', 'spearman', 'quintiles', 'regress', 'anova', 'rsa', 'ml']) expect(screen.getByTestId(`deep-dig-block-${k}`)).toBeInTheDocument();
    expect(screen.getByTestId('deep-dig-block-ttest')).toHaveTextContent('Welch');
    expect(screen.getByTestId('deep-dig-block-regress')).toHaveTextContent('多元线性回归');
    expect(screen.getByTestId('deep-dig-block-regress')).toHaveTextContent('调整 R²');
    expect(screen.getByTestId('deep-dig-block-anova')).toHaveTextContent('η²');
    expect(screen.getByTestId('deep-dig-block-ml')).toHaveTextContent('样本外 AUC');
    expect(within(screen.getByTestId('deep-dig-block-quintiles')).getAllByText(/^Q\d$/)).toHaveLength(5);
  });

  it('规律提取：默认是统计结果；可编辑、保存后标「手动修改」，可恢复为统计结果', () => {
    render(<Harness initialTab="rules" />);
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('统计得出');
    expect(within(screen.getByTestId('deep-dig-rules-list')).getAllByRole('listitem')).toHaveLength(deepDigRules(DATA, INF).length);
    expect(screen.getByTestId('deep-dig-rules-list')).toHaveTextContent('方差分析');
    fireEvent.click(screen.getByTestId('deep-dig-rules-edit'));
    fireEvent.change(screen.getByTestId('deep-dig-rules-input'), { target: { value: '只在 V 回落到 0 附近时进场\n\n仓位减半' } });
    fireEvent.click(screen.getByTestId('deep-dig-rules-save'));
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('手动修改');
    expect(within(screen.getByTestId('deep-dig-rules-list')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['1只在 V 回落到 0 附近时进场', '2仓位减半']);
    fireEvent.click(screen.getByTestId('deep-dig-rules-reset'));
    expect(screen.getByTestId('deep-dig-rules-source')).toHaveTextContent('统计得出');
  });
});
