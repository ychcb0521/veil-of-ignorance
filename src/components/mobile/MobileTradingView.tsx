import { ArrowLeft, X } from 'lucide-react';
import { OrderPanel } from '@/components/OrderPanel';
import { PositionPanel } from '@/components/PositionPanel';
import type { PlaceOrderParams, PositionsMap, OrdersMap, PriceMap } from '@/contexts/TradingContext';
import type { TradeRecord } from '@/types/trading';
import { useState } from 'react';

interface Props {
  onBack: () => void;
  currentPrice: number;
  disabled: boolean;
  symbol: string;
  onPlaceOrder: (order: PlaceOrderParams) => void;
  positionsMap: PositionsMap;
  ordersMap: OrdersMap;
  tradeHistory: TradeRecord[];
  priceMap: PriceMap;
  activeSymbol: string;
  onClosePosition: (symbol: string, index: number) => void;
  onCancelOrder: (symbol: string, orderId: string) => void;
  balance: number;
}

export function MobileTradingView({
  onBack, currentPrice, disabled, symbol, onPlaceOrder,
  positionsMap, ordersMap, tradeHistory, priceMap, activeSymbol,
  onClosePosition, onCancelOrder, balance,
}: Props) {
  const [bottomTab, setBottomTab] = useState('positions');
  const baseCoin = symbol.replace('USDT', '');

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <button onClick={onBack} className="p-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-bold font-mono text-foreground">{baseCoin}USDT</span>
        <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary">永续</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">可用</span>
          <span className="text-xs font-mono font-bold text-foreground">
            {balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
          </span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Order panel */}
        <OrderPanel
          currentPrice={currentPrice}
          onPlaceOrder={onPlaceOrder}
          disabled={disabled}
          symbol={symbol}
        />

        {/* Position panel */}
        <div className="border-t border-border">
          <PositionPanel
            positionsMap={positionsMap}
            ordersMap={ordersMap}
            tradeHistory={tradeHistory}
            priceMap={priceMap}
            activeSymbol={activeSymbol}
            onClosePosition={onClosePosition}
            onCancelOrder={onCancelOrder}
            activeTab={bottomTab}
            onTabChange={setBottomTab}
          />
        </div>
      </div>
    </div>
  );
}
