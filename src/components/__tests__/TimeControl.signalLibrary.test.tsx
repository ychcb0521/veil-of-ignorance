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
  // 与 s2 同月，且字母序在它之前而时间在它之后——字母序与时间序相反，
  // 才能验出「选中月份后排序真的换成了时间」而不是碰巧顺序一样。
  { id: 's4', symbol: 'AAVEUSDT', timeMs: Date.parse('2025-07-20T02:00:00.000Z'), timeLabel: '2025-07-20 10:00', fallbackZone: '3' },
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
    // 排序下拉已删除，改成点表头；这条守卫跟着换成表头控件。
    expect(within(lib).getByTestId('signal-sort-标的')).toBeInTheDocument();
    expect(within(lib).getByTestId('signal-sort-信号时间')).toBeInTheDocument();
    expect(within(lib).getByTestId('signal-sort-评分')).toBeInTheDocument();
    // 用正则而非精确串：title 里补了「选中某个月会自动按时间旧→新排列」这句提示，
    // 这条守卫要保的是「控件还在」，不是文案一字不变。
    expect(within(lib).getByTitle(/按月份定位信号/)).toBeInTheDocument();
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

  it('选中具体月份后自动按时间旧→新排列——字母序会把那个月的时间线打散', () => {
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    // 全部月份下仍是字母序：标的列带升序箭头
    expect(within(lib).getByTestId('signal-sort-标的')).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.change(within(lib).getByTitle(/按月份定位信号/), { target: { value: '2025-07' } });
    expect(within(lib).getByTestId('signal-sort-信号时间')).toHaveAttribute('aria-sort', 'ascending');
    // 2025-07 里 AAVEUSDT 字母序在前、时间在后，改成时间序后应排在 ACEUSDT 之后
    const symbols = within(lib).getAllByText(/USDT$/).map(n => n.textContent);
    expect(symbols).toEqual(['ACEUSDT', 'AAVEUSDT']);
  });

  it('选月之后手动改排序不会被抢回去', () => {
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    fireEvent.change(within(lib).getByTitle(/按月份定位信号/), { target: { value: '2025-07' } });
    fireEvent.click(within(lib).getByTestId('signal-sort-标的'));
    expect(within(lib).getByTestId('signal-sort-标的')).toHaveAttribute('aria-sort', 'ascending');
    expect(within(lib).getAllByText(/USDT$/).map(n => n.textContent)).toEqual(['AAVEUSDT', 'ACEUSDT']);
  });

  it('切回「全部月份」不改排序——用户没要求那个方向', () => {
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    const monthSelect = within(lib).getByTitle(/按月份定位信号/);
    fireEvent.change(monthSelect, { target: { value: '2025-07' } });
    fireEvent.change(monthSelect, { target: { value: '' } });
    // 选月时切到了「时间 旧→新」；切回全部月份后不该被抢回字母序
    expect(within(lib).getByTestId('signal-sort-信号时间')).toHaveAttribute('aria-sort', 'ascending');
    expect(within(lib).getByTestId('signal-sort-标的')).toHaveAttribute('aria-sort', 'none');
  });

  it('每行都有跳转入口和删除入口', () => {
    renderControl();
    openLibrary();
    const lib = libraryRoot();
    expect(within(lib).getAllByTitle('跳转盘面')).toHaveLength(SIGNALS.length);
    expect(within(lib).getAllByTitle('删除该信号')).toHaveLength(SIGNALS.length);
  });

  describe('信号质量五星评分', () => {
    it('点第 N 颗星就打 N 分，并落进 localStorage', () => {
      renderControl();
      openLibrary();
      fireEvent.click(screen.getByTestId('signal-quality-s1-4'));

      const saved = JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY) ?? '[]');
      expect(saved.find((x: { id: string }) => x.id === 's1').quality).toBe(4);
      // 其余信号不受影响
      expect(saved.find((x: { id: string }) => x.id === 's2').quality).toBeUndefined();
    });

    it('【要求】改分按最新的存', () => {
      renderControl();
      openLibrary();
      fireEvent.click(screen.getByTestId('signal-quality-s1-2'));
      fireEvent.click(screen.getByTestId('signal-quality-s1-5'));
      const saved = JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY) ?? '[]');
      expect(saved.find((x: { id: string }) => x.id === 's1').quality).toBe(5);
    });

    it('再点同一颗星取消评分', () => {
      renderControl();
      openLibrary();
      fireEvent.click(screen.getByTestId('signal-quality-s1-3'));
      fireEvent.click(screen.getByTestId('signal-quality-s1-3'));
      const saved = JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY) ?? '[]');
      expect(saved.find((x: { id: string }) => x.id === 's1').quality).toBeUndefined();
    });

    it('【回归】点星星不得把盘面跳走——整行本身是个跳转按钮', () => {
      renderControl();
      openLibrary();
      // 跳转一旦触发，jumpingSignalId 会把**所有**行按钮禁用；点星星之后不该发生
      fireEvent.click(screen.getByTestId('signal-quality-s2-3'));
      for (const row of screen.getAllByTitle(/跳转到/)) expect(row).not.toBeDisabled();
      const saved = JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY) ?? '[]');
      expect(saved.find((x: { id: string }) => x.id === 's2').quality).toBe(3);
    });

    it('评分列出现在兜底区右侧，且每条信号都有五颗星', () => {
      renderControl();
      openLibrary();
      const lib = libraryRoot();
      expect(within(lib).getByText('评分')).toBeInTheDocument();
      for (const sig of SIGNALS) {
        const group = within(lib).getByTestId(`signal-quality-${sig.id}`);
        expect(within(group).getAllByRole('radio')).toHaveLength(5);
      }
    });
  });

  describe('点表头排序', () => {
    it('点同一个表头反向', () => {
      renderControl();
      openLibrary();
      const lib = libraryRoot();
      const head = () => within(lib).getByTestId('signal-sort-标的');
      expect(head()).toHaveAttribute('aria-sort', 'ascending');
      fireEvent.click(head());
      expect(head()).toHaveAttribute('aria-sort', 'descending');
      expect(within(lib).getAllByText(/USDT$/)[0].textContent).toBe('ACEUSDT');
    });

    it('评分列可排序，未评分沉底', () => {
      renderControl();
      openLibrary();
      const lib = libraryRoot();
      fireEvent.click(within(lib).getByTestId('signal-quality-s3-5'));   // A50USDT 打 5 星
      fireEvent.click(within(lib).getByTestId('signal-quality-s1-2'));   // 0GUSDT 打 2 星
      fireEvent.click(within(lib).getByTestId('signal-sort-评分'));
      const symbols = within(lib).getAllByText(/USDT$/).map(n => n.textContent);
      expect(symbols[0]).toBe('A50USDT');   // 5 星在前
      expect(symbols[1]).toBe('0GUSDT');    // 2 星次之
      expect(symbols.slice(2)).not.toContain('A50USDT');   // 其余都是未评分
    });

    it('一次只有一个排序列在生效', () => {
      renderControl();
      openLibrary();
      const lib = libraryRoot();
      fireEvent.click(within(lib).getByTestId('signal-sort-信号时间'));
      expect(within(lib).getByTestId('signal-sort-信号时间')).toHaveAttribute('aria-sort', 'descending');
      expect(within(lib).getByTestId('signal-sort-标的')).toHaveAttribute('aria-sort', 'none');
      expect(within(lib).getByTestId('signal-sort-评分')).toHaveAttribute('aria-sort', 'none');
    });
  });
});
