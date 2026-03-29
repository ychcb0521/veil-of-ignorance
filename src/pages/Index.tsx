import { useState, useCallback, useMemo } from 'react';
import { useTimeSimulator } from '@/hooks/useTimeSimulator';
import { useBinanceData } from '@/hooks/useBinanceData';
import { TimeControl } from '@/components/TimeControl';
import { CandlestickChart } from '@/components/CandlestickChart';
import { OrderPanel, type Position } from '@/components/OrderPanel';
import { PositionPanel } from '@/components/PositionPanel';
import { SymbolSelector } from '@/components/SymbolSelector';
import { AccountInfo } from '@/components/AccountInfo';
import { toast } from 'sonner';

const Index = () => {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('1m');
  const [positions, setPositions] = useState<Position[]>([]);
  const [balance, setBalance] = useState(10000);

  const sim = useTimeSimulator();
  const { allData, loading, error, fetchKlines, getVisibleData } = useBinanceData();

  const visibleData = useMemo(
    () => getVisibleData(sim.currentSimulatedTime),
    [getVisibleData, sim.currentSimulatedTime]
  );

  const currentPrice = visibleData.length > 0
    ? visibleData[visibleData.length - 1].close
    : 0;

  const handleStart = useCallback(async (timestamp: number) => {
    const data = await fetchKlines(symbol, interval, timestamp, 1000);
    if (data.length > 0) {
      sim.startSimulation(timestamp);
      toast.success('时间机器已启动', {
        description: `已穿越到 ${new Date(timestamp).toISOString().slice(0, 19)} UTC`,
      });
    } else {
      toast.error('数据获取失败', { description: error || '请检查时间范围和交易对' });
    }
  }, [symbol, interval, fetchKlines, sim, error]);

  const handlePlaceOrder = useCallback((order: any) => {
    const entryPrice = order.type === 'MARKET' ? currentPrice : order.price;
    const margin = order.quantity * entryPrice / order.leverage;

    if (margin > balance) {
      toast.error('保证金不足');
      return;
    }

    setBalance(prev => prev - margin);
    setPositions(prev => [...prev, {
      side: order.side,
      entryPrice,
      quantity: order.quantity,
      leverage: order.leverage,
      margin,
    }]);

    toast.success(`${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity} @ ${entryPrice.toFixed(2)}`);
  }, [currentPrice, balance]);

  const handleClosePosition = useCallback((index: number) => {
    const pos = positions[index];
    const diff = pos.side === 'LONG'
      ? currentPrice - pos.entryPrice
      : pos.entryPrice - currentPrice;
    const pnl = diff * pos.quantity;

    setBalance(prev => prev + pos.margin + pnl);
    setPositions(prev => prev.filter((_, i) => i !== index));

    toast(pnl >= 0 ? '盈利平仓' : '亏损平仓', {
      description: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`,
    });
  }, [positions, currentPrice]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-border px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-primary tracking-wide">
            ⚡ FUTURES SIM
          </h1>
          <SymbolSelector
            symbol={symbol}
            interval={interval}
            onSymbolChange={setSymbol}
            onIntervalChange={setInterval}
          />
        </div>
        {loading && (
          <span className="text-xs text-muted-foreground animate-pulse">
            加载数据中...
          </span>
        )}
      </header>

      {/* Time Control */}
      <TimeControl
        isRunning={sim.isRunning}
        currentSimulatedTime={sim.currentSimulatedTime}
        speed={sim.speed}
        onStart={handleStart}
        onStop={sim.stopSimulation}
        onSetSpeed={sim.setSpeed}
      />

      {/* Account Info */}
      <AccountInfo balance={balance} positions={positions} currentPrice={currentPrice} />

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Chart Area */}
        <div className="flex-1 flex flex-col p-2 gap-2 min-h-0">
          <div className="flex-1 min-h-0">
            {!sim.isRunning && visibleData.length === 0 ? (
              <div className="panel h-full flex items-center justify-center">
                <div className="text-center space-y-3">
                  <div className="text-4xl">⏰</div>
                  <p className="text-sm text-muted-foreground">
                    输入历史时间并点击"启动"开始复盘模拟
                  </p>
                  <p className="text-xs text-muted-foreground">
                    K线将按真实时间 1:1 流速推进，不会暴露未来数据
                  </p>
                </div>
              </div>
            ) : (
              <CandlestickChart data={visibleData} symbol={symbol.replace('USDT', '/USDT')} />
            )}
          </div>

          {/* Positions */}
          <PositionPanel
            positions={positions}
            currentPrice={currentPrice}
            onClose={handleClosePosition}
          />
        </div>

        {/* Right Sidebar - Order Panel */}
        <div className="w-72 border-l border-border p-2">
          <OrderPanel
            currentPrice={currentPrice}
            onPlaceOrder={handlePlaceOrder}
            disabled={!sim.isRunning || currentPrice === 0}
          />
        </div>
      </div>
    </div>
  );
};

export default Index;
