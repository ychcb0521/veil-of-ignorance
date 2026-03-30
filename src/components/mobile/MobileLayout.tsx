import { useState, useCallback } from 'react';
import { MobileSearchView } from './MobileSearchView';
import { MobileChartView } from './MobileChartView';
import { MobileTradingView } from './MobileTradingView';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { KlineData } from '@/hooks/useBinanceData';
import type { PlaceOrderParams, PositionsMap, OrdersMap, PriceMap } from '@/contexts/TradingContext';
import type { TradeRecord } from '@/types/trading';
import type { TimeMachineStatus } from '@/hooks/useTimeSimulator';

export type MobileView = 'Search' | 'Chart' | 'Trading';

interface Props {
  symbol: string;
  interval: string;
  onSymbolChange: (s: string) => void;
  onIntervalChange: (i: string) => void;
  // Sim
  status: TimeMachineStatus;
  currentSimulatedTime: number;
  speed: number;
  onStart: (ts: number) => void;
  onPause: () => void;
  onResume: () => void;
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
  const [activeView, setActiveView] = usePersistedState<MobileView>('mobile_view', 'Search');

  const handleSelectSymbol = useCallback((sym: string) => {
    props.onSymbolChange(sym);
    setActiveView('Chart');
  }, [props.onSymbolChange]);

  switch (activeView) {
    case 'Search':
      return (
        <MobileSearchView
          onSelectSymbol={handleSelectSymbol}
          currentSymbol={props.symbol}
        />
      );

    case 'Chart':
      return (
        <MobileChartView
          symbol={props.symbol}
          interval={props.interval}
          onIntervalChange={props.onIntervalChange}
          onBack={() => setActiveView('Search')}
          onTrade={() => setActiveView('Trading')}
          status={props.status}
          currentSimulatedTime={props.currentSimulatedTime}
          speed={props.speed}
          onStart={props.onStart}
          onPause={props.onPause}
          onResume={props.onResume}
          onStop={props.onStop}
          onSetSpeed={props.onSetSpeed}
          visibleData={props.visibleData}
          onLoadOlder={props.onLoadOlder}
          loadingOlder={props.loadingOlder}
          balance={props.balance}
          positionsMap={props.positionsMap}
          priceMap={props.priceMap}
          currentPrice={props.currentPrice}
        />
      );

    case 'Trading':
      return (
        <MobileTradingView
          onBack={() => setActiveView('Chart')}
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
          balance={props.balance}
        />
      );
  }
}
