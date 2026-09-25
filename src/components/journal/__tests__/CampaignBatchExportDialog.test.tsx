import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignBatchExportDialog } from '../CampaignBatchExportDialog';
import type { CampaignBatchExportWorkerProps } from '@/lib/campaignBatchExportContext';

const mocks = vi.hoisted(() => ({ worker: vi.fn(), zip: vi.fn(), downloads: [] as string[] }));
vi.mock('../CampaignBatchExportWorker', () => ({ CampaignBatchExportWorker: (props: CampaignBatchExportWorkerProps) => {
  mocks.worker(props);
  return <div data-testid="mock-worker">{props.campaignId}
    <button onClick={() => props.onComplete({ blob: new Blob(['png']), fileName: `${props.campaignId}.png` })}>完成 {props.campaignId}</button>
    <button onClick={() => props.onComplete({ blob: new Blob(['png']), fileName: `${props.campaignId}.png`, chartOmitted: '交易所没有这段时间的 K 线' })}>无K线 {props.campaignId}</button>
    <button onClick={() => props.onError(new Error('网络失败'))}>失败 {props.campaignId}</button>
  </div>;
} }));
vi.mock('@/lib/campaignPngZip', () => ({ buildCampaignPngZip: mocks.zip }));
const campaigns = [{ id: 'b', title: '战役 B' }, { id: 'a', title: '战役 A' }];
const latestWorker = () => mocks.worker.mock.calls.at(-1)![0] as CampaignBatchExportWorkerProps;
const start = () => fireEvent.click(screen.getByRole('button', { name: '生成 2 张图片' }));
const row = (id: string) => screen.getAllByTestId('campaign-batch-row').find(item => item.dataset.campaignId === id)!;
const zipNames = (call: number) => mocks.zip.mock.calls[call][0].map((file: { name: string }) => file.name);
beforeEach(() => {
  mocks.worker.mockClear(); mocks.zip.mockReset(); mocks.downloads.length = 0;
  mocks.zip.mockResolvedValue(new Blob(['zip']));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:batch') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    mocks.downloads.push(this.download);
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('批量下载队列', () => {
  it('一次只挂一个工人，按冻结的顺序与设置生成，并以本批导出时刻命名 ZIP', async () => {
    const onClose = vi.fn();
    const view = render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={onClose} />);
    expect(screen.getAllByTestId('campaign-batch-row').map(item => item.dataset.campaignId)).toEqual(['b', 'a']);
    fireEvent.click(screen.getByLabelText('操作日情绪日记'));
    fireEvent.click(screen.getByRole('radio', { name: '5分钟' }));
    start();
    const first = latestWorker();
    expect(first.campaignId).toBe('b');
    expect(first.options.sections.emotionDiary).toBe(false);
    expect(first.options.interval).toBe('5m');
    expect(first.snapshot.currentAccountEquity).toBe(100);
    expect(row('b')).toHaveAttribute('data-state', 'running');
    expect(row('a')).toHaveAttribute('data-state', 'waiting');
    view.rerender(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={200} onClose={onClose} />);
    expect(screen.getAllByTestId('mock-worker')).toHaveLength(1);
    fireEvent.click(screen.getByText('完成 b'));
    expect(row('b')).toHaveAttribute('data-state', 'done');
    expect(latestWorker().campaignId).toBe('a');
    expect(latestWorker().snapshot).toBe(first.snapshot);
    expect(screen.getByRole('progressbar', { name: '批量生成进度' })).toHaveAttribute('aria-valuenow', '1');
    fireEvent.click(screen.getByText('完成 a'));
    expect(screen.queryByTestId('mock-worker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（2 张）' }));
    await waitFor(() => expect(mocks.downloads).toHaveLength(1));
    expect(zipNames(0)).toEqual(['001_b.png', '002_a.png']);
    expect(mocks.zip.mock.calls[0][1].exportedAt).toBe(first.snapshot.exportedAt);
    expect(mocks.downloads[0]).toMatch(/^交易战役_\d{8}-\d{4}_2张\.zip$/);
    expect(screen.getByTestId('campaign-batch-last-zip')).toHaveTextContent(mocks.downloads[0]);
    // 进了已下载 ZIP 的行改标「已下载」
    expect(row('b')).toHaveAttribute('data-state', 'downloaded');
    expect(row('a')).toHaveTextContent('已下载');
    // 全部下载过：直接关闭，不再确认，并告诉列表页可以退出选择模式
    fireEvent.click(screen.getByTestId('campaign-batch-close'));
    expect(onClose).toHaveBeenCalledWith({ allDownloaded: true });
  });

  it('失败后接着下一场；逐场列出原因，可单场重试或一次重试全部失败项，已生成的图不丢', async () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start(); fireEvent.click(screen.getByText('失败 b')); fireEvent.click(screen.getByText('完成 a'));
    expect(row('b')).toHaveAttribute('data-state', 'failed');
    expect(within(row('b')).getByText('网络失败')).toBeInTheDocument();
    fireEvent.click(within(row('b')).getByRole('button', { name: '重试：战役 B' }));
    expect(latestWorker().campaignId).toBe('b');
    fireEvent.click(screen.getByText('失败 b'));
    fireEvent.click(screen.getByRole('button', { name: '重试失败的 1 场' }));
    expect(row('b')).toHaveAttribute('data-state', 'running');
    fireEvent.click(screen.getByText('完成 b'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（2 张）' }));
    await waitFor(() => expect(mocks.zip).toHaveBeenCalledOnce());
    expect(zipNames(0)).toEqual(['001_b.png', '002_a.png']);
  });

  it('交易所没有 K 线的战役算成功，并在队列里标出「无 K 线」', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start(); fireEvent.click(screen.getByText('无K线 b'));
    expect(row('b')).toHaveAttribute('data-state', 'done');
    expect(within(row('b')).getByText('无 K 线')).toHaveAttribute('title', '交易所没有这段时间的 K 线');
    fireEvent.click(screen.getByText('完成 a'));
    expect(screen.getByTestId('campaign-batch-progress')).toHaveTextContent('1 场交易所没有 K 线，盘面从略');
  });

  it('只画盈亏概览、交易所又没有 K 线时，同样标「无 K 线」，进度区写峰值浮盈按已实现盈亏兜底（不写「盘面从略」）', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('K 线盘面'));
    start();
    const peakFallback = '交易所没有这段时间的 XYZUSDT K 线：「峰值浮盈」缺少 K 线路径，按已实现盈亏兜底。';
    act(() => latestWorker().onComplete({ blob: new Blob(['png']), fileName: 'b.png', peakFallback }));
    expect(row('b')).toHaveAttribute('data-state', 'done');
    expect(within(row('b')).getByText('无 K 线')).toHaveAttribute('title', peakFallback);
    act(() => latestWorker().onComplete({ blob: new Blob(['png']), fileName: 'a.png' }));
    expect(within(row('a')).queryByText('无 K 线')).not.toBeInTheDocument();
    const progress = screen.getByTestId('campaign-batch-progress');
    expect(progress).toHaveTextContent('1 场交易所没有 K 线，峰值浮盈按已实现盈亏兜底');
    expect(progress).not.toHaveTextContent('盘面从略');
    // 这不是账户样本说明：弹窗的黄色样本提示不出现
    expect(screen.queryByTestId('campaign-batch-sample-note')).not.toBeInTheDocument();
  });

  it('指定周期在某场盘面上放不下而放宽时，逐行标出实际周期，进度区报场数；自动档不标', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '1分钟' }));
    start();
    act(() => latestWorker().onComplete({ blob: new Blob(['png']), fileName: 'b.png', chartInterval: '5m' }));
    act(() => latestWorker().onComplete({ blob: new Blob(['png']), fileName: 'a.png', chartInterval: '1m' }));
    const badge = within(row('b')).getByText('5分钟');
    expect(badge).toHaveAttribute('title', '所选 1分钟 在这场战役的盘面上放不下，已放宽到 5分钟');
    expect(within(row('a')).queryByText('1分钟')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-batch-progress')).toHaveTextContent('周期 1分钟 · 1.1x 视窗 ｜ 1 场盘面放不下，已放宽周期');
  });

  it('「自动」档按每场各自选周期，不算放宽', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start();
    act(() => latestWorker().onComplete({ blob: new Blob(['png']), fileName: 'b.png', chartInterval: '15m' }));
    expect(within(row('b')).queryByText('15分钟')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-batch-progress')).not.toHaveTextContent('放宽');
  });

  it('账户样本缺场时照常出图，并在进度区说明缺了哪几场', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start();
    const sampleNote = '账户样本缺 1 场（「ETH 镜像止盈」读取失败），不对称风险贡献按其余 23 场计算。';
    act(() => latestWorker().onComplete({ blob: new Blob(['png']), fileName: 'b.png', sampleNote }));
    expect(row('b')).toHaveAttribute('data-state', 'done');
    const note = screen.getByTestId('campaign-batch-sample-note');
    expect(note).toHaveTextContent(`${sampleNote}图中「盈亏概览」下已注明。`);
    // 窄屏只在「），」之后换行：后两句各自整句不折行，不会把「不对称」拆成「不 / 对称」
    const unbroken = [...note.querySelectorAll('.whitespace-nowrap')].map(node => node.textContent);
    expect(unbroken).toEqual(['不对称风险贡献按其余 23 场计算。', '图中「盈亏概览」下已注明。']);
  });

  it('【用户要求】盘面视窗可选 1.1x / 2x / 3x …，默认 1.1 倍；所选倍数交给离屏详情页，进度区写明', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    const group = screen.getByTestId('campaign-batch-view-multiplier');
    const options = within(group).getAllByRole('radio').map(input => (input as HTMLInputElement).value);
    expect(options).toEqual(['1.1', '2', '3', '5', '11', '21', '31', '41', '51']);
    expect(within(group).getByRole('radio', { name: '1.1x' })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: '3x' }));
    start();
    expect(latestWorker().options.viewMultiplier).toBe(3);
    expect(screen.getByTestId('campaign-batch-progress')).toHaveTextContent('3x 视窗');
  });

  it('没画 K 线盘面时视窗单选停用、说明原因，进度区不写视窗；默认倍数照样是 1.1', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    const group = screen.getByTestId('campaign-batch-view-multiplier');
    expect(group).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('K 线盘面'));
    expect(group).toBeDisabled();
    expect(group).toHaveTextContent('未画 K 线盘面，不用视窗');
    start();
    expect(latestWorker().options.viewMultiplier).toBe(1.1);
    expect(screen.getByTestId('campaign-batch-progress')).not.toHaveTextContent('视窗');
  });

  it('K 线盘面与盈亏概览都不画时，周期单选调暗停用并说明原因，进度区也不写周期', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    const group = screen.getByTestId('campaign-batch-interval');
    expect(group).not.toBeDisabled();
    expect(screen.queryByTestId('campaign-batch-interval-unused')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('K 线盘面'));
    // 只去掉盘面：盈亏概览的峰值浮盈仍按周期的 K 线路径算，周期照常可选
    expect(group).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('盈亏概览'));
    expect(group).toBeDisabled();
    expect(screen.getByRole('radio', { name: '5分钟' })).toBeDisabled();
    expect(screen.getByTestId('campaign-batch-interval-unused')).toHaveTextContent('未画 K 线盘面与盈亏概览，不用周期');
    start();
    const progress = screen.getByTestId('campaign-batch-progress');
    expect(progress).toHaveTextContent('战役原数据 · 操作日情绪日记 · 完整 Legs 列表');
    expect(progress).not.toHaveTextContent('周期');
    expect(progress).not.toHaveTextContent('｜');
  });

  it('画了盈亏概览（没画盘面）时进度区照常写周期', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('K 线盘面'));
    fireEvent.click(screen.getByRole('radio', { name: '15分钟' }));
    start();
    expect(screen.getByTestId('campaign-batch-progress')).toHaveTextContent('周期 15分钟');
  });

  it('状态句在窄屏上换行读全，只有「正在生成：标题」一行截断并带完整标题', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start();
    expect(screen.getByTestId('campaign-batch-status')).toHaveClass('truncate');
    expect(screen.getByTestId('campaign-batch-status')).toHaveAttribute('title', '正在生成：战役 B');
    fireEvent.click(screen.getByText('失败 b')); fireEvent.click(screen.getByText('完成 a'));
    const status = screen.getByTestId('campaign-batch-status');
    expect(status).toHaveTextContent('1 场没能生成，可以重试，或先下载已生成的图片。');
    expect(status).not.toHaveClass('truncate');
    expect(status).not.toHaveAttribute('title');
    // 按意群分段、每段不折行：窄屏上只在逗号后换行，不会剩「图片。」孤零零挂到下一行
    expect([...status.children].map(node => node.textContent)).toEqual(['1 场没能生成，', '可以重试，', '或先下载已生成的图片。']);
    for (const segment of status.children) expect(segment).toHaveClass('whitespace-nowrap');
  });

  it('已生成的图都下载过后，状态句不再劝「先下载已生成的图片」', async () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start(); fireEvent.click(screen.getByText('失败 b')); fireEvent.click(screen.getByText('完成 a'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（1 张）' }));
    await waitFor(() => expect(mocks.downloads).toHaveLength(1));
    const status = screen.getByTestId('campaign-batch-status');
    expect(status).toHaveTextContent(/^1 场没能生成，可以重试。$/);
    expect(status).not.toHaveTextContent('先下载');
  });

  it('右上角的关闭叉读屏名是「关闭」（手机上页脚「关闭」隐藏，它是唯一的关闭控件），生成中点它同样先确认', () => {
    const onClose = vi.fn();
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={onClose} />);
    start();
    const buttons = screen.getAllByRole('button', { name: '关闭' });
    const corner = buttons.find(button => button !== screen.getByTestId('campaign-batch-close'))!;
    expect(corner).toBeDefined();
    fireEvent.click(corner);
    expect(screen.getByRole('alert')).toHaveTextContent('关闭会停止本批导出。确定关闭？');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('暂停后与继续后，旧一代工人的迟到结果都被丢弃', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start(); const old = latestWorker();
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(screen.queryByTestId('mock-worker')).not.toBeInTheDocument();
    act(() => old.onComplete({ blob: new Blob(['late']), fileName: 'late.png' }));
    expect(screen.queryByRole('button', { name: /下载 ZIP/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续生成 2 场' }));
    act(() => old.onError(new Error('late error')));
    expect(latestWorker().campaignId).toBe('b');
    expect(screen.queryByText(/late error/)).not.toBeInTheDocument();
  });

  it('单场卡住超过 150 秒记为失败并接着下一场', () => {
    vi.useFakeTimers();
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start();
    act(() => vi.advanceTimersByTime(150_000));
    expect(latestWorker().campaignId).toBe('a');
    expect(within(row('b')).getByText(/读取或绘制超过 150 秒/)).toBeInTheDocument();
  });

  it('切到其他标签页的时间不计入单场 150 秒：浏览器暂停绘图时不会把整批判成超时', () => {
    vi.useFakeTimers();
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start();
    act(() => vi.advanceTimersByTime(100_000));
    hidden = true;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(row('b')).toHaveAttribute('data-state', 'running');
    hidden = false;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => vi.advanceTimersByTime(49_000));
    expect(row('b')).toHaveAttribute('data-state', 'running');
    act(() => vi.advanceTimersByTime(1_000));
    expect(row('b')).toHaveAttribute('data-state', 'failed');
    expect(latestWorker().campaignId).toBe('a');
  });

  it('至少要选一项内容才能开始', () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(screen.getByRole('button', { name: '生成 2 张图片' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('至少选择一项内容');
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('取消打包不会发起下载，图片仍可再次下载', async () => {
    let resolveZip!: (value: Blob) => void;
    mocks.zip.mockReturnValue(new Promise<Blob>(resolve => { resolveZip = resolve; }));
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start(); fireEvent.click(screen.getByText('完成 b')); fireEvent.click(screen.getByText('完成 a'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（2 张）' }));
    fireEvent.click(screen.getByRole('button', { name: '取消打包' }));
    expect(mocks.zip.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolveZip(new Blob(['cancelled'])));
    expect(mocks.downloads).toHaveLength(0);
    expect(screen.getByRole('button', { name: '下载 ZIP（2 张）' })).toBeEnabled();
  });

  it('打包失败后可以直接重新下载，不重新生成图片', async () => {
    mocks.zip.mockRejectedValueOnce(new Error('打包失败测试'));
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start(); fireEvent.click(screen.getByText('完成 b')); fireEvent.click(screen.getByText('完成 a'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（2 张）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('打包失败：打包失败测试');
    const renders = mocks.worker.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（2 张）' }));
    await waitFor(() => expect(mocks.downloads).toHaveLength(1));
    expect(mocks.worker.mock.calls.length).toBe(renders);
  });

  it('达到内存预算时暂停分包：下载第 1 包后接着生成，序号与快照不变，包名带「第 N 包」', async () => {
    const onClose = vi.fn();
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={onClose} />);
    start(); const first = latestWorker();
    const blob = new Blob(['large']); Object.defineProperty(blob, 'size', { value: 256 * 1024 * 1024 });
    act(() => first.onComplete({ blob, fileName: 'b.png' }));
    expect(screen.queryByTestId('mock-worker')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /继续生成/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-batch-status')).toHaveTextContent('已生成的图片接近 256 MB，先下载第 1 包，再接着生成剩下的 1 场。');
    fireEvent.click(screen.getByRole('button', { name: '下载第 1 包并继续' }));
    await waitFor(() => expect(screen.getByTestId('mock-worker')).toHaveTextContent('a'));
    expect(row('b')).toHaveAttribute('data-state', 'packed');
    expect(row('b')).toHaveTextContent('已在第 1 包');
    expect(latestWorker().snapshot).toBe(first.snapshot);
    fireEvent.click(screen.getByText('完成 a'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（1 张）' }));
    await waitFor(() => expect(mocks.zip).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.downloads).toHaveLength(2));
    expect(zipNames(1)).toEqual(['002_a.png']);
    expect(mocks.downloads[0]).toMatch(/_第1包_1张\.zip$/);
    expect(mocks.downloads[1]).toMatch(/_第2包_1张\.zip$/);
    expect(row('a')).toHaveTextContent('已在第 2 包');
    fireEvent.click(screen.getByTestId('campaign-batch-close'));
    expect(onClose).toHaveBeenCalledWith({ allDownloaded: true });
  });

  it('随前一包下载走、从内存放掉的图，队列里照旧标「无 K 线」，进度区照旧计数', async () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('K 线盘面'));
    start();
    const blob = new Blob(['large']); Object.defineProperty(blob, 'size', { value: 256 * 1024 * 1024 });
    const peakFallback = '交易所没有这段时间的 XYZUSDT K 线：「峰值浮盈」缺少 K 线路径，按已实现盈亏兜底。';
    act(() => latestWorker().onComplete({ blob, fileName: 'b.png', peakFallback }));
    fireEvent.click(screen.getByRole('button', { name: '下载第 1 包并继续' }));
    await waitFor(() => expect(row('b')).toHaveAttribute('data-state', 'packed'));
    expect(within(row('b')).getByText('无 K 线')).toHaveAttribute('title', peakFallback);
    expect(screen.getByTestId('campaign-batch-progress')).toHaveTextContent('1 场交易所没有 K 线，峰值浮盈按已实现盈亏兜底');
  });

  it('分包运行里最后一包下完再重试补上的一场，下一次下载是新的一包：只装新图，包号顺延', async () => {
    const three = [{ id: 'b', title: '战役 B' }, { id: 'a', title: '战役 A' }, { id: 'c', title: '战役 C' }];
    render(<CampaignBatchExportDialog campaigns={three} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '生成 3 张图片' }));
    const blob = new Blob(['large']); Object.defineProperty(blob, 'size', { value: 256 * 1024 * 1024 });
    act(() => latestWorker().onComplete({ blob, fileName: 'b.png' }));
    fireEvent.click(screen.getByRole('button', { name: '下载第 1 包并继续' }));
    await waitFor(() => expect(screen.getByTestId('mock-worker')).toHaveTextContent('a'));
    fireEvent.click(screen.getByText('失败 a'));
    fireEvent.click(screen.getByText('完成 c'));
    // 最后一包：只有 c
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（1 张）' }));
    await waitFor(() => expect(mocks.downloads).toHaveLength(2));
    expect(zipNames(1)).toEqual(['003_c.png']);
    expect(mocks.downloads[1]).toMatch(/_第2包_1张\.zip$/);
    expect(row('c')).toHaveTextContent('已在第 2 包');
    expect(screen.queryByRole('button', { name: /下载 ZIP/ })).not.toBeInTheDocument();
    // 重试失败的 a：再下载只装 a，包号顺延到第 3 包，不把 c 再装一遍
    fireEvent.click(screen.getByRole('button', { name: '重试失败的 1 场' }));
    fireEvent.click(screen.getByText('完成 a'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（1 张）' }));
    await waitFor(() => expect(mocks.downloads).toHaveLength(3));
    expect(zipNames(2)).toEqual(['002_a.png']);
    expect(mocks.downloads[2]).toMatch(/_第3包_1张\.zip$/);
    expect(new Set(mocks.downloads).size).toBe(3);
    expect(row('a')).toHaveTextContent('已在第 3 包');
    expect(screen.getByTestId('campaign-batch-status')).toHaveTextContent('全部图片已下载。');
  });

  it('没分过包时下载后仍可再下载一次；补上重试的一场后再下载，是一份完整的 ZIP', async () => {
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={vi.fn()} />);
    start(); fireEvent.click(screen.getByText('失败 b')); fireEvent.click(screen.getByText('完成 a'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（1 张）' }));
    await waitFor(() => expect(mocks.downloads).toHaveLength(1));
    expect(row('a')).toHaveAttribute('data-state', 'downloaded');
    fireEvent.click(screen.getByRole('button', { name: '重试失败的 1 场' }));
    fireEvent.click(screen.getByText('完成 b'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（2 张）' }));
    await waitFor(() => expect(mocks.downloads).toHaveLength(2));
    expect(zipNames(1)).toEqual(['001_b.png', '002_a.png']);
    expect(mocks.downloads[1]).toMatch(/^交易战役_\d{8}-\d{4}_2张\.zip$/);
  });

  it('生成中或有没下载的图时，关闭要先在弹窗内确认', async () => {
    const onClose = vi.fn();
    render(<CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100} onClose={onClose} />);
    start();
    fireEvent.click(screen.getByTestId('campaign-batch-close'));
    expect(screen.getByRole('alert')).toHaveTextContent('关闭会停止本批导出。确定关闭？');
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('完成 b')); fireEvent.click(screen.getByText('失败 a'));
    fireEvent.keyDown(screen.getByTestId('campaign-batch-export-dialog'), { key: 'Escape' });
    expect(screen.getByRole('alert')).toHaveTextContent('关闭会丢弃 1 张尚未下载的图片');
    fireEvent.click(screen.getByRole('button', { name: '丢弃并关闭' }));
    expect(onClose).toHaveBeenCalledWith({ allDownloaded: false });
  });
});

/** 与列表页一样：弹窗关掉即卸载，焦点由 onReturnFocus 还给打开它的按钮。 */
function FocusHarness({ onClose }: { onClose?: (outcome: { allDownloaded: boolean }) => void }) {
  const [open, setOpen] = useState(true);
  const opener = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={opener} type="button">下载选中</button>
    {open && <CampaignBatchExportDialog campaigns={campaigns} userId="u" currentAccountEquity={100}
      onClose={outcome => { onClose?.(outcome); setOpen(false); }}
      onReturnFocus={() => opener.current?.focus()} />}
  </>;
}

describe('批量下载弹窗关闭后的焦点', () => {
  const opener = () => screen.getByRole('button', { name: '下载选中' });
  const dialog = () => screen.queryByTestId('campaign-batch-export-dialog');

  it.each([
    ['Esc', () => fireEvent.keyDown(screen.getByTestId('campaign-batch-export-dialog'), { key: 'Escape' })],
    ['取消', () => fireEvent.click(screen.getByRole('button', { name: '取消' }))],
    ['右上角关闭叉', () => fireEvent.click(screen.getByRole('button', { name: '关闭' }))],
  ])('%s 关闭：焦点回到打开它的「下载选中」，不落到 <body>', async (_label, closeDialog) => {
    render(<FocusHarness />);
    await waitFor(() => expect(dialog()).toContainElement(document.activeElement as HTMLElement));
    closeDialog();
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await waitFor(() => expect(opener()).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('页脚「关闭」与「丢弃并关闭」同样把焦点还回去', async () => {
    const onClose = vi.fn();
    const first = render(<FocusHarness onClose={onClose} />);
    start(); fireEvent.click(screen.getByText('完成 b')); fireEvent.click(screen.getByText('完成 a'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP（2 张）' }));
    await waitFor(() => expect(mocks.downloads).toHaveLength(1));
    fireEvent.click(screen.getByTestId('campaign-batch-close'));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await waitFor(() => expect(opener()).toHaveFocus());
    expect(onClose).toHaveBeenCalledWith({ allDownloaded: true });
    first.unmount();

    render(<FocusHarness />);
    start();
    fireEvent.click(screen.getByTestId('campaign-batch-close'));
    fireEvent.click(screen.getByRole('button', { name: '丢弃并关闭' }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await waitFor(() => expect(opener()).toHaveFocus());
  });
});
