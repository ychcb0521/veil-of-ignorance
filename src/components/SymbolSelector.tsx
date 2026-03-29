const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
];

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface Props {
  symbol: string;
  interval: string;
  onSymbolChange: (s: string) => void;
  onIntervalChange: (i: string) => void;
}

export function SymbolSelector({ symbol, interval, onSymbolChange, onIntervalChange }: Props) {
  return (
    <div className="flex items-center gap-3">
      <select
        value={symbol}
        onChange={e => onSymbolChange(e.target.value)}
        className="input-dark text-xs pr-8 cursor-pointer"
      >
        {SYMBOLS.map(s => (
          <option key={s} value={s}>{s.replace('USDT', '/USDT')}</option>
        ))}
      </select>

      <div className="flex gap-0.5">
        {INTERVALS.map(iv => (
          <button
            key={iv}
            onClick={() => onIntervalChange(iv)}
            className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
              interval === iv
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent'
            }`}
          >
            {iv}
          </button>
        ))}
      </div>
    </div>
  );
}
