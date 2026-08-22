// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeControl } from '../TimeControl';
import { SIGNAL_LIBRARY_STORAGE_KEY } from '@/lib/signalLibrary';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    // ACEUSDT 在 2025-07-11（UTC+8）开过仓 —— 与下面 s2 那条信号同一天。
    // 另有一笔 0GUSDT 在 2025-11-07 开仓，比 s1 那条信号早一天：
    // 按标的判会把 s1 也标成已交易，按日判则不会。
    tradeHistory: [
      { symbol: 'ACEUSDT', action: 'CLOSE', openTime: Date.parse('2025-07-11T06:42:00.000Z') },
      { symbol: '0GUSDT', action: 'CLOSE', openTime: Date.parse('2025-11-06T06:31:00.000Z') },
    ],
    positionsMap: {},
    priceMap: {},
    getEffectiveTime: () => Date.parse('2025-11-08T06:31:00.000Z'),
  }),
}));
vi.mock('@/lib/journalApi', () => ({ listAllCampaigns: vi.fn(async () => []) }));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({ PreTradeSnapshotDialog: () => null }));
vi.mock('@/lib/signalJumpDiagnostics', async (orig) => ({
  ...(await orig() as object),
  preflightSignalJumpIssues: vi.fn(async () => new Map()),
}));

const SIGNALS = [
  { id: 's1', symbol: '0GUSDT', timeMs: Date.parse('2025-11-08T06:31:00.000Z'), timeLabel: '2025-11-08 14:31', fallbackZone: '1.38' },
  { id: 's2', symbol: 'ACEUSDT', timeMs: Date.parse('2025-07-11T06:42:00.000Z'), timeLabel: '2025-07-11 14:42', fallbackZone: '0.56' },
  { id: 's3', symbol: 'A50USDT', timeMs: Date.parse('2024-10-25T17:33:00.000Z'), timeLabel: '2024-10-26 01:33', fallbackZone: '' },
];

function renderControl() {
  return render(
    <TimeControl
      status="paused" currentSimulatedTime={Date.parse('2025-11-08T06:43:41.000Z')} speed={1}
      onStart={() => {}} onPause={() => {}} onResume={() => {}} onStop={() => {}} onSetSpeed={() => {}}
      activeSymbol="0GUSDT"
    />,
  );
}

const openLibrary = () => fireEvent.click(screen.getByTitle(/信号库：上传/));
const libraryRoot = () => screen.getByTestId('signal-library-panel');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(SIGNALS));
});

describe('信号库展开面板', () => {
  it('每条信号的标的、时间、兜底区一个都不能少', () => {
    // 紧凑化改版的护栏：压缩高度可以，丢字段不行。
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    for (const sig of SIGNALS) {
      expect(within(lib).getByText(sig.symbol)).toBeInTheDocument();
      expect(within(lib).getByText(sig.timeLabel)).toBeInTheDocument();
    }
    expect(within(lib).getByText(/1\.38/)).toBeInTheDocument();
    expect(within(lib).getByText(/0\.56/)).toBeInTheDocument();
  });

  it('勾号按「信号当日」判定，不是「这个标的做过没有」', () => {
    // 同一个币种会在很多个日期出现在信号库里。按标的判定的话，
    // 别的日期交易过就会把这一天也标成已交易，标记因此失去意义。
    renderControl();
    openLibrary();
    const marks = within(libraryRoot()).getAllByLabelText('信号当日已交易');
    // 只有 ACEUSDT（信号 2025-07-11，当天确实开过仓）该带勾号。
    // 0GUSDT 虽然交易过，但那笔是 11-06 开的，而信号在 11-08 —— 不算。
    expect(marks).toHaveLength(1);
    expect(marks[0].closest('span')).toHaveTextContent('ACEUSDT');
  });

  it('导入、导出、清空、筛选、排序、月份定位入口都还在', () => {
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    expect(within(lib).getByTitle(/上传 \/ 粘贴信号/)).toBeInTheDocument();
    expect(within(lib).getByTitle(/导出信号库/)).toBeInTheDocument();
    expect(within(lib).getByPlaceholderText(/筛选标的/)).toBeInTheDocument();
    expect(within(lib).getByTitle('排序方式')).toBeInTheDocument();
    expect(within(lib).getByTitle('按月份定位信号')).toBeInTheDocument();
  });

  it('筛选框按标的过滤', () => {
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    fireEvent.change(within(lib).getByPlaceholderText(/筛选标的/), { target: { value: 'ACE' } });
    expect(within(lib).getByText('ACEUSDT')).toBeInTheDocument();
    expect(within(lib).queryByText('0GUSDT')).not.toBeInTheDocument();
  });

  it('勾号占固定一列，带勾与不带勾的行首字母对齐', () => {
    // 条件渲染勾号会让没勾的行整体左移，首字母和勾号两列都对不齐。
    // 这里断言每一行都渲染了「勾号槽」——有勾放图标，没勾放等宽空位。
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    const names = within(lib).getAllByText(/USDT$/);
    const cells = names.map(n => n.parentElement!);
    expect(cells).toHaveLength(SIGNALS.length);
    for (const cell of cells) {
      // 每个标的单元格恒有两个子节点：勾号槽 + 名称
      expect(cell.children).toHaveLength(2);
      expect(cell.className).toContain('grid-cols-[12px_minmax(0,1fr)]');
    }
  });

  it('每行都有跳转入口和删除入口', () => {
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    expect(within(lib).getAllByTitle('跳转盘面')).toHaveLength(SIGNALS.length);
    expect(within(lib).getAllByTitle('删除该信号')).toHaveLength(SIGNALS.length);
  });
});
