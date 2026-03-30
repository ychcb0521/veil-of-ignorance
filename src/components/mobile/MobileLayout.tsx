import { useState, useCallback } from 'react';
import { MobileHeader } from './MobileHeader';
import { MobileBottomBar } from './MobileBottomBar';
import { MobileTradingDrawer } from './MobileTradingDrawer';
import { CandlestickChart } from '@/components/CandlestickChart';
import { AccountInfo } from '@/components/AccountInfo';
import type { KlineData } from '@/hooks/useBinanceData';
import type { PlaceOrderParams, PositionsMap, OrdersMap, PriceMap } from '@/contexts/TradingContext';
import type { TradeRecord } from '@/types/trading';

interface Props {
  // Symbol & interval
  symbol: string;
  interval: string;
  onSymbolChange: (s: string) => void;
  onIntervalChange: (i: string) => void;
  // Sim
  isRunning: boolean;
  currentSimulatedTime: number;
  speed: number;
  onStart: (ts: number) => void;
  onStop: () => void;
  onSetSpeed: (s: number) => void;
  // Chart
  visibleData: KlineData[];
  onLoadOlder: () => void;
  loadingOlder: boolean;
  // Trading
  currentPrice: number;
  disabled: boolean;
  onPlaceOrder: (order: PlaceOrderParams) => void;
  // Account
  balance: number;
  positionsMap: PositionsMap;
  ordersMap: OrdersMap;
  priceMap: PriceMap;
  tradeHistory: TradeRecord[];
  activeSymbol: string;
  onClosePosition: (symbol: string, index: number) => void;
  onCancelOrder: (symbol: string, orderId: string) => void;
}

export function MobileLayout(props: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <MobileHeader
        symbol={props.symbol}
        interval={props.interval}
        onSymbolChange={props.onSymbolChange}
        onIntervalChange={props.onIntervalChange}
        isRunning={props.isRunning}
        currentSimulatedTime={props.currentSimulatedTime}
        speed={props.speed}
        onStart={props.onStart}
        onStop={props.onStop}
        onSetSpeed={props.onSetSpeed}
      />

      {/* Account info - compact */}
      <div className="shrink-0">
        <AccountInfo balance={props.balance} positionsMap={props.positionsMap} priceMap={props.priceMap} />
      </div>

      {/* Chart - full width */}
      <div className="flex-1 min-h-0">
        {!props.isRunning && props.visibleData.length === 0 ? (
          <div className="h-full flex items-center justify-center bg-background">
            <div className="text-center space-y-3 px-6">
              <div className="text-4xl">⏰</div>
              <p className="text-sm text-muted-foreground">输入历史时间并点击「启动」开始复盘模拟</p>
            </div>
          </div>
        ) : (
          <CandlestickChart
            data={props.visibleData}
            symbol={props.activeSymbol.replace('USDT', '/USDT')}
            onLoadOlder={props.onLoadOlder}
            loadingOlder={props.loadingOlder}
          />
        )}
      </div>

      {/* Bottom bar */}
      <MobileBottomBar
        onOpenLong={() => setDrawerOpen(true)}
        onOpenShort={() => setDrawerOpen(true)}
      />

      {/* Trading drawer */}
      <MobileTradingDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        currentPrice={props.currentPrice}
        disabled={props.disabled}
        symbol={props.symbol}
        onPlaceOrder={props.onPlaceOrder}
        positionsMap={props.positionsMap}
        ordersMap={props.ordersMap}
        tradeHistory={props.tradeHistory}
        priceMap={props.priceMap}
        activeSymbol={props.activeSymbol}
        onClosePosition={props.onClosePosition}
        onCancelOrder={props.onCancelOrder}
      />
    </div>
  );
}
