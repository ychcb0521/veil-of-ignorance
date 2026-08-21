// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeControl } from '../TimeControl';
import { SIGNAL_LIBRARY_STORAGE_KEY } from '@/lib/signalLibrary';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradeHistory: [{ symbol: 'ACEUSDT' }],
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

  it('已交易过的标的带勾号，未交易的不带', () => {
    renderControl();
    openLibrary();
    const marks = within(libraryRoot()).getAllByLabelText('已交易');
    expect(marks).toHaveLength(1); // 只有 ACEUSDT 在 tradeHistory 里
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

  it('每行都有跳转入口和删除入口', () => {
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    expect(within(lib).getAllByTitle('跳转盘面')).toHaveLength(SIGNALS.length);
    expect(within(lib).getAllByTitle('删除该信号')).toHaveLength(SIGNALS.length);
  });
});
