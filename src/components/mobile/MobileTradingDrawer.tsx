import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { OrderPanel } from '@/components/OrderPanel';
import { PositionPanel } from '@/components/PositionPanel';
import type { PlaceOrderParams } from '@/contexts/TradingContext';
import type { PositionsMap, OrdersMap, PriceMap } from '@/contexts/TradingContext';
import type { TradeRecord } from '@/types/trading';
import { useState } from 'react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
}

export function MobileTradingDrawer({
  open, onOpenChange, currentPrice, disabled, symbol, onPlaceOrder,
  positionsMap, ordersMap, tradeHistory, priceMap, activeSymbol,
  onClosePosition, onCancelOrder,
}: Props) {
  const [bottomTab, setBottomTab] = useState('positions');

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] bg-card">
        <DrawerHeader className="pb-0">
          <DrawerTitle className="text-sm font-bold text-foreground">交易面板</DrawerTitle>
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto px-0">
          <OrderPanel
            currentPrice={currentPrice}
            onPlaceOrder={(order) => {
              onPlaceOrder(order);
            }}
            disabled={disabled}
            symbol={symbol}
          />
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
      </DrawerContent>
    </Drawer>
  );
}
