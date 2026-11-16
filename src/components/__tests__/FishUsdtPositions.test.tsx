import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InstantPositionsContext } from '@/contexts/FishQualityContext';
import { useUsdtLiveTrading } from '@/hooks/useUsdtLiveTrading';
import { FishUsdtPositions } from '../FishUsdtPositions';
import { PositionPanel } from '../PositionPanel';
import { TradingDeskActionPanel } from '../TradingDeskActionPanel';
import type { PositionChartPreview } from '../PositionMarketPreview';
import { usdtPositionValue, type UsdtMirrorPosition } from '@/lib/fish/usdtPositionMirror';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'mirror-owner' } }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({ tradingMode: 'direct' }) }));

const at=Date.parse('2026-11-15T19:28:42.697+08:00');
const position:UsdtMirrorPosition={symbol:'BEATUSDT',positionSide:'LONG',direction:'long',
  quantity:'100.000',entryPrice:'0.0822712',markPrice:'0.08236000',unrealizedPnl:'0.00888000',updatedAt:at};

it('shows and clears real exchange positions in both views with one shared read of each opening', async () => {
  let positions: UsdtMirrorPosition[] = [];
  const openChart = vi.fn();
  const readPositionHistory=vi.fn(async ()=>({openedAt:at,fills:[]}));
  const follow = {
    connected: true, positionMirror: 1 as const, readPositionHistory,
    readPositions: vi.fn(async () => ({ observedAt: at, positions })),
    readCampaigns: async () => ({ observedAt: at, campaigns: [] }),
  };
  function Fixture() {
    const live = useUsdtLiveTrading('mirror-owner', follow);
    return <InstantPositionsContext.Provider value={{ positions: [], usdtFollow: follow, usdtLive: live } as never}>
      <div data-testid="fish"><FishUsdtPositions follow={follow as never} live={live}/></div>
      <div data-testid="main-positions"><PositionPanel positionsMap={{}} ordersMap={{}} tradeHistory={[]} priceMap={{}}
        activeSymbol="EVAAUSDT" activeTab="positions" onOpenPositionChart={openChart} onClosePosition={vi.fn()} onCancelOrder={vi.fn()} onTabChange={vi.fn()}/></div>
    </InstantPositionsContext.Provider>;
  }
  render(<Fixture/>);
  const fish = within(screen.getByTestId('fish'));
  const table = within(screen.getByTestId('main-positions'));
  await waitFor(() => expect(follow.readPositions).toHaveBeenCalledTimes(1));
  expect(fish.getByRole('button',{name:/币安实盘持仓/})).toHaveAttribute('aria-expanded','false');
  expect(table.getByRole('button',{name:'仓位(0)'})).toBeVisible();
  const short:UsdtMirrorPosition={...position,positionSide:'SHORT',direction:'short',quantity:'21.005',unrealizedPnl:'-0.001'};
  positions = [position, short];
  fireEvent(document, new Event('visibilitychange'));
  expect(await table.findByRole('button',{name:'仓位(2)'})).toBeVisible();
  await waitFor(() => expect(fish.getByRole('button',{name:/币安实盘持仓/})).toHaveAttribute('aria-expanded','true'));
  expect(fish.getByText('数量 100 BEAT')).toBeVisible();
  expect(fish.getAllByText('均价 0.0822712')).toHaveLength(2);
  expect(table.getByText('100 BEAT')).toBeVisible();
  expect(table.getByText('21.005 BEAT')).toBeVisible();
  expect(table.getByTitle('名义仓位 8.236 USDT')).toBeVisible();
  expect(table.getAllByRole('cell', {name:'开仓价格'}).map(cell=>cell.textContent)).toEqual(['0.0822712','0.0822712']);
  expect(table.getByText('-0.001 USDT')).toBeVisible();
  fireEvent.click(table.getAllByRole('button', {name:'BEATUSDT'})[0]);
  expect(openChart).toHaveBeenCalledWith('BEATUSDT', undefined, 'BEATUSDT:LONG');
  expect(table.queryByRole('region',{name:'币安实盘持仓'})).not.toBeInTheDocument();
  await waitFor(() => expect(table.getAllByText('开仓时间 2026-11-15 19:28:42.697')).toHaveLength(2));
  expect(fish.getAllByText('开仓 2026-11-15 19:28:42.697')).toHaveLength(2);
  expect(readPositionHistory).toHaveBeenCalledTimes(2);
  expect(table.queryByRole('button',{name:'一键平仓'})).not.toBeInTheDocument();
  fireEvent.click(table.getByRole('checkbox',{name:'隐藏其他合约'}));
  expect(table.queryByText('100 BEAT')).not.toBeInTheDocument();
  expect(fish.getByText('数量 100 BEAT')).toBeVisible();
  fireEvent.click(table.getByRole('checkbox',{name:'隐藏其他合约'}));
  positions = [];
  fireEvent(document,new Event('visibilitychange'));
  await waitFor(()=>expect(table.queryByTestId('usdt-live-position')).not.toBeInTheDocument());
  expect(table.getByRole('button',{name:'仓位(0)'})).toBeVisible();
});

it('keeps decimal precision when calculating quote values', () => {
  expect(usdtPositionValue('100.000','0.08236000')).toBe('8.236');
  expect(usdtPositionValue('0.000000000000000123','0.0081')).toBe('0.0000000000000000009963');
});

it('shows the single real position on the right before replay and keeps simulation selectable', () => {
  const manage = vi.fn();
  const open = vi.fn();
  const closePreview = vi.fn();
  const follow = { connected: true, positionMirror: 1 };
  const live = { snapshot: { observedAt: at, positions: [position] }, histories: new Map(), retryPositions: vi.fn() };
  const right = (replayActive: boolean, preview: PositionChartPreview | null = null) => (
    <InstantPositionsContext.Provider value={{ positions: [], usdtFollow: follow, usdtLive: live } as never}>
      <TradingDeskActionPanel preview={preview} replayActive={replayActive} onManagePosition={manage}
        onOpenChart={open} onClosePreview={closePreview}>
        <p>模拟面板</p>
      </TradingDeskActionPanel>
    </InstantPositionsContext.Provider>
  );

  const { rerender } = render(right(false));
  const panel = screen.getByRole('region', { name: '币安实盘仓位管理' });
  expect(panel).toHaveTextContent('100 BEAT');
  expect(manage).toHaveBeenLastCalledWith('BEATUSDT:LONG');
  fireEvent.click(screen.getByRole('button', { name: '查看盘面' }));
  expect(open).toHaveBeenCalledWith('BEATUSDT', 'BEATUSDT:LONG');

  rerender(right(true));
  expect(screen.getByText('模拟面板')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '币安实盘' }));
  expect(screen.getByRole('region', { name: '币安实盘仓位管理' })).toBeVisible();

  rerender(right(true, { symbol: 'BEATUSDT', livePositionKey: 'BEATUSDT:LONG', live: true, at }));
  fireEvent.click(screen.getByRole('button', { name: '模拟交易' }));
  expect(closePreview).toHaveBeenCalledOnce();
  rerender(right(true));
  expect(screen.getByText('模拟面板')).toBeVisible();
  expect(manage).toHaveBeenLastCalledWith(undefined);
});
