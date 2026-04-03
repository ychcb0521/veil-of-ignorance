import { ArrowLeft, Clock, Play, Pause, Square, Calendar, ChevronDown } from 'lucide-react';
import { formatUTC8 } from '@/lib/timeFormat';
import { CandlestickChart } from '@/components/CandlestickChart';
import type { KlineData } from '@/hooks/useBinanceData';
import type { PositionsMap, PriceMap } from '@/contexts/TradingContext';
import type { TimeMachineStatus } from '@/hooks/useTimeSimulator';
import { useState } from 'react';
import { WheelDateTimePicker } from './WheelPicker';
import { MobileTimeframeSheet } from './MobileTimeframeSheet';
import { TIMEFRAME_LABELS } from '@/hooks/useTimeframePrefs';

interface Props {
  symbol: string;
  interval: string;
  onIntervalChange: (i: string) => void;
  onBack: () => void;
  onTrade: () => void;
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
  // Account
  balance: number;
  positionsMap: PositionsMap;
  priceMap: PriceMap;
  currentPrice: number;
}

export function MobileChartView(props: Props) {
  const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60, 180, 300, 600];
  const [selectedDate, setSelectedDate] = useState(() => new Date('2024-01-15T00:00:00Z')); // 00:00 UTC = 08:00 UTC+8
  const [showPicker, setShowPicker] = useState(false);
  const [showTimeframeSheet, setShowTimeframeSheet] = useState(false);
  const baseCoin = props.symbol.replace('USDT', '');

  const formatSimTime = formatUTC8;

  const formatSelectedDate = () => {
    return formatUTC8(selectedDate.getTime()).slice(0, 16);
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
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-card">
        <button
          onClick={() => setShowTimeframeSheet(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono bg-primary text-primary-foreground"
        >
          {TIMEFRAME_LABELS[props.interval] || props.interval}
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Time machine compact */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-card">
        <Clock className="w-3 h-3 text-primary shrink-0" />
        {props.status === 'stopped' && (
          <>
            <button
              onClick={() => setShowPicker(true)}
              className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded bg-secondary border border-border text-left"
            >
              <Calendar className="w-3 h-3 text-muted-foreground" />
              <span className="font-mono text-[10px] text-foreground">{formatSelectedDate()}</span>
            </button>
            <button onClick={handleStart} className="btn-long flex items-center gap-1 text-[10px] px-2 py-1 shrink-0">
              <Play className="w-3 h-3" /> 启动
            </button>
          </>
        )}
        {props.status === 'playing' && (
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
            <button onClick={props.onPause} className="p-1 text-yellow-400">
              <Pause className="w-3.5 h-3.5" />
            </button>
            <button onClick={props.onStop} className="p-1 text-destructive">
              <Square className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        {props.status === 'paused' && (
          <>
            <span className="font-mono text-[10px] text-yellow-400 flex-1 truncate animate-pulse">⏸ {formatSimTime(props.currentSimulatedTime)}</span>
            <button onClick={props.onResume} className="btn-long flex items-center gap-1 text-[10px] px-2 py-1 shrink-0">
              <Play className="w-3 h-3" /> 继续
            </button>
            <button onClick={props.onStop} className="p-1 text-destructive">
              <Square className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {showPicker && (
        <WheelDateTimePicker
          initialDate={selectedDate}
          onConfirm={handlePickerConfirm}
          onCancel={() => setShowPicker(false)}
        />
      )}

      <MobileTimeframeSheet
        open={showTimeframeSheet}
        onClose={() => setShowTimeframeSheet(false)}
        interval={props.interval}
        onIntervalChange={props.onIntervalChange}
      />

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
        {props.status === 'stopped' && props.visibleData.length === 0 ? (
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
