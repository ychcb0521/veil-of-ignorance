import { useState, useCallback, useEffect, type MutableRefObject } from 'react';
import type { ChartImperativeApi } from './CandlestickChart';
import { CandlestickChart } from './CandlestickChart';
import { LayoutGrid, Columns, Square } from 'lucide-react';
import type { KlineData } from '@/hooks/useBinanceData';
import type { TradeRecord, PendingOrder } from '@/types/trading';

type LayoutMode = '1x1' | '1x2' | '2x2';

const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'];

interface Props {
  mainData: KlineData[];
  mainSymbol: string;
  rawSymbol: string;
  onLoadOlder: () => void;
  loadingOlder: boolean;
  tradeHistory: TradeRecord[];
  isRunning: boolean;
  currentSimulatedTime: number;
  mainInterval: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  pendingOrders?: PendingOrder[];
  onCancelOrder?: (orderId: string) => void;
  chartApiRef?: MutableRefObject<ChartImperativeApi | null>;
}

interface SubChart {
  interval: string;
  data: KlineData[];
  loading: boolean;
}

export function MultiChartLayout({
  mainData, mainSymbol, rawSymbol, onLoadOlder, loadingOlder,
  tradeHistory, isRunning, currentSimulatedTime, mainInterval,
  pricePrecision, quantityPrecision, pendingOrders, onCancelOrder,
  chartApiRef,
}: Props) {
  const [layout, setLayout] = useState<LayoutMode>('1x1');
  const [subCharts, setSubCharts] = useState<SubChart[]>([
    { interval: '15m', data: [], loading: false },
    { interval: '1h', data: [], loading: false },
    { interval: '4h', data: [], loading: false },
  ]);

  const loadSubChart = useCallback(async (index: number, interval: string) => {
    if (!isRunning) return;
    setSubCharts(prev => {
      const next = [...prev];
      next[index] = { ...next[index], interval, loading: true };
      return next;
    });

    try {
      const endTime = currentSimulatedTime;
      const intervalMs: Record<string, number> = {
        '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
        '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '1d': 86400000,
      };
      const ms = intervalMs[interval] || 60000;
      const startTime = endTime - ms * 300;

      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${rawSymbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=300`
      );
      const raw = await res.json();
      const data: KlineData[] = raw.map((k: any[]) => ({
        time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
      }));
      setSubCharts(prev => {
        const next = [...prev];
        next[index] = { interval, data, loading: false };
        return next;
      });
    } catch {
      setSubCharts(prev => {
        const next = [...prev];
        next[index] = { ...next[index], loading: false };
        return next;
      });
    }
  }, [isRunning, currentSimulatedTime, rawSymbol]);

  useEffect(() => {
    if (layout === '1x1' || !isRunning) return;
    const count = layout === '1x2' ? 1 : 3;
    for (let i = 0; i < count; i++) {
      if (subCharts[i].data.length === 0) {
        loadSubChart(i, subCharts[i].interval);
      }
    }
  }, [layout, isRunning]);

  const getVisibleSubData = (data: KlineData[]) => {
    return data.filter(d => d.time <= currentSimulatedTime);
  };

  const handleSubIntervalChange = (index: number, newInterval: string) => {
    loadSubChart(index, newInterval);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="absolute right-2 top-1 z-30 flex items-center gap-0.5 bg-card/90 rounded px-1 py-0.5 border border-border/50">
        {([
          { mode: '1x1' as LayoutMode, icon: <Square className="w-3 h-3" />, label: '单图' },
          { mode: '1x2' as LayoutMode, icon: <Columns className="w-3 h-3" />, label: '双图' },
          { mode: '2x2' as LayoutMode, icon: <LayoutGrid className="w-3 h-3" />, label: '四图' },
        ]).map(opt => (
          <button key={opt.mode} onClick={() => setLayout(opt.mode)} title={opt.label}
            className={`p-1 rounded transition-colors ${layout === opt.mode ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {opt.icon}
          </button>
        ))}
      </div>

      {layout === '1x1' ? (
        <div className="flex-1 min-h-0">
          <CandlestickChart data={mainData} symbol={mainSymbol} onLoadOlder={onLoadOlder}
            loadingOlder={loadingOlder} tradeHistory={tradeHistory} rawSymbol={rawSymbol}
            pricePrecision={pricePrecision} quantityPrecision={quantityPrecision}
            pendingOrders={pendingOrders} onCancelOrder={onCancelOrder} />
        </div>
      ) : layout === '1x2' ? (
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-px" style={{ background: 'hsl(var(--border))' }}>
          <div className="bg-background min-h-0 overflow-hidden">
            <CandlestickChart data={mainData} symbol={`${mainSymbol} ${mainInterval}`} onLoadOlder={onLoadOlder}
              loadingOlder={loadingOlder} tradeHistory={tradeHistory} rawSymbol={rawSymbol}
              pricePrecision={pricePrecision} quantityPrecision={quantityPrecision}
              pendingOrders={pendingOrders} onCancelOrder={onCancelOrder} />
          </div>
          <div className="bg-background min-h-0 overflow-hidden relative">
            <SubChartIntervalSelector interval={subCharts[0].interval} onChange={v => handleSubIntervalChange(0, v)} />
            {subCharts[0].loading ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">加载中...</div>
            ) : (
              <CandlestickChart data={getVisibleSubData(subCharts[0].data)}
                symbol={`${mainSymbol} ${subCharts[0].interval}`}
                tradeHistory={tradeHistory} rawSymbol={rawSymbol}
                pricePrecision={pricePrecision} quantityPrecision={quantityPrecision} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-px" style={{ background: 'hsl(var(--border))' }}>
          <div className="bg-background min-h-0 overflow-hidden">
            <CandlestickChart data={mainData} symbol={`${mainSymbol} ${mainInterval}`} onLoadOlder={onLoadOlder}
              loadingOlder={loadingOlder} tradeHistory={tradeHistory} rawSymbol={rawSymbol}
              pricePrecision={pricePrecision} quantityPrecision={quantityPrecision}
              pendingOrders={pendingOrders} onCancelOrder={onCancelOrder} />
          </div>
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-background min-h-0 overflow-hidden relative">
              <SubChartIntervalSelector interval={subCharts[i].interval} onChange={v => handleSubIntervalChange(i, v)} />
              {subCharts[i].loading ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">加载中...</div>
              ) : (
                <CandlestickChart data={getVisibleSubData(subCharts[i].data)}
                  symbol={`${mainSymbol} ${subCharts[i].interval}`}
                  tradeHistory={tradeHistory} rawSymbol={rawSymbol}
                  pricePrecision={pricePrecision} quantityPrecision={quantityPrecision} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SubChartIntervalSelector({ interval, onChange }: { interval: string; onChange: (v: string) => void }) {
  return (
    <div className="absolute top-1 left-10 z-20 flex gap-0.5">
      {INTERVALS.map(iv => (
        <button key={iv} onClick={() => onChange(iv)}
          className={`px-1 py-0.5 rounded text-[9px] font-mono transition-colors ${
            interval === iv ? 'bg-primary/20 text-primary font-bold' : 'text-muted-foreground hover:text-foreground'
          }`}>
          {iv}
        </button>
      ))}
    </div>
  );
}
