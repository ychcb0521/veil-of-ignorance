import { ArrowLeft, Clock, Play, Pause, Calendar } from 'lucide-react';
import { CandlestickChart } from '@/components/CandlestickChart';
import type { KlineData } from '@/hooks/useBinanceData';
import type { PositionsMap, PriceMap } from '@/contexts/TradingContext';
import { useState } from 'react';
import { WheelDateTimePicker } from './WheelPicker';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60];

interface Props {
  symbol: string;
  interval: string;
  onIntervalChange: (i: string) => void;
  onBack: () => void;
  onTrade: () => void;
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
  // Account
  balance: number;
  positionsMap: PositionsMap;
  priceMap: PriceMap;
  currentPrice: number;
}

export function MobileChartView(props: Props) {
  const [selectedDate, setSelectedDate] = useState(() => new Date('2024-01-15T08:00:00Z'));
  const [showPicker, setShowPicker] = useState(false);
  const baseCoin = props.symbol.replace('USDT', '');

  const formatSimTime = (ts: number) => {
    if (!ts) return '--';
    const d = new Date(ts);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  };

  const formatSelectedDate = () => {
    const d = selectedDate;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  };

  const handlePickerConfirm = (date: Date) => {
    setSelectedDate(date);
    setShowPicker(false);
  };

  const handleStart = () => {
    props.onStart(selectedDate.getTime());
  };

  const last = props.visibleData.length > 0 ? props.visibleData[props.visibleData.length - 1] : null;
  const prev = props.visibleData.length > 1 ? props.visibleData[props.visibleData.length - 2] : null;
  const priceChange = last && prev ? last.close - prev.close : 0;
  const priceChangePct = last && prev ? (priceChange / prev.close) * 100 : 0;
  const isUp = priceChange >= 0;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top header: back + symbol + star */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        <button onClick={props.onBack} className="p-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-sm font-bold font-mono text-foreground">{baseCoin}USDT</span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary">永续</span>
        </div>
        {/* Price info */}
        {last && (
          <div className="text-right">
            <div className={`text-sm font-bold font-mono ${isUp ? 'trading-green' : 'trading-red'}`}>
              {last.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`text-[10px] font-mono ${isUp ? 'trading-green' : 'trading-red'}`}>
              {isUp ? '+' : ''}{priceChangePct.toFixed(2)}%
            </div>
          </div>
        )}
      </div>

      {/* Interval tabs */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-card overflow-x-auto">
        {INTERVALS.map(iv => (
          <button
            key={iv}
            onClick={() => props.onIntervalChange(iv)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
              props.interval === iv
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {iv}
          </button>
        ))}
      </div>

      {/* Time machine compact */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-card">
        <Clock className="w-3 h-3 text-primary shrink-0" />
        {!props.isRunning ? (
          <>
            <input
              type="text" value={dateInput} onChange={e => setDateInput(e.target.value)}
              placeholder="YYYY-MM-DD HH:mm:ss"
              className="flex-1 input-dark text-[10px] py-1 px-2"
            />
            <button onClick={handleStart} className="btn-long flex items-center gap-1 text-[10px] px-2 py-1 shrink-0">
              <Play className="w-3 h-3" /> 启动
            </button>
          </>
        ) : (
          <>
            <span className="font-mono text-[10px] text-primary flex-1 truncate">{formatSimTime(props.currentSimulatedTime)}</span>
            <div className="flex items-center gap-0.5 shrink-0">
              {SPEED_OPTIONS.slice(0, 4).map(s => (
                <button key={s} onClick={() => props.onSetSpeed(s)}
                  className={`px-1 py-0.5 rounded text-[9px] font-mono ${
                    props.speed === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
            <button onClick={props.onStop} className="p-1 text-destructive">
              <Pause className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Price summary bar */}
      {last && (
        <div className="flex items-center gap-3 px-3 py-1 border-b border-border bg-card text-[10px] font-mono overflow-x-auto">
          <span className="text-muted-foreground">高 <span className="text-foreground">{last.high.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></span>
          <span className="text-muted-foreground">低 <span className="text-foreground">{last.low.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></span>
          <span className="text-muted-foreground">量 <span className="text-foreground">{last.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
        </div>
      )}

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {!props.isRunning && props.visibleData.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-2 px-6">
              <div className="text-3xl">⏰</div>
              <p className="text-xs text-muted-foreground">设置时间并点击「启动」开始模拟</p>
            </div>
          </div>
        ) : (
          <CandlestickChart
            data={props.visibleData}
            symbol={`${baseCoin}/USDT`}
            onLoadOlder={props.onLoadOlder}
            loadingOlder={props.loadingOlder}
          />
        )}
      </div>

      {/* Bottom action bar */}
      <div className="flex gap-3 px-4 py-3 border-t border-border bg-card shrink-0">
        <button onClick={props.onTrade} className="flex-1 btn-long py-3 text-sm font-bold rounded-lg">
          交易
        </button>
        <button onClick={props.onTrade} className="flex-1 btn-short py-3 text-sm font-bold rounded-lg">
          平仓
        </button>
      </div>
    </div>
  );
}
