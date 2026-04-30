import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronDown, Check, Star } from 'lucide-react';
import { TimeframeSelector } from './TimeframeSelector';

// Fallback top-20 symbols if API fails
const FALLBACK_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT',
  'AVAXUSDT','DOTUSDT','LINKUSDT','MATICUSDT','LTCUSDT','UNIUSDT','ATOMUSDT',
  'APTUSDT','ARBUSDT','OPUSDT','SUIUSDT','SEIUSDT','TIAUSDT',
].map(s => ({ symbol: s, baseAsset: s.replace('USDT',''), displayName: `${s.replace('USDT','')}/USDT`, pricePrecision: 2, quantityPrecision: 3 }));

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  displayName: string;
  pricePrecision: number;
  quantityPrecision: number;
}



interface Props {
  symbol: string;
  interval: string;
  onSymbolChange: (s: string) => void;
  onIntervalChange: (i: string) => void;
  onPrecisionChange?: (pricePrecision: number, quantityPrecision: number) => void;
}

export function SymbolSelector({ symbol, interval, onSymbolChange, onIntervalChange, onPrecisionChange }: Props) {
  const [availableSymbols, setAvailableSymbols] = useState<SymbolInfo[]>(FALLBACK_SYMBOLS);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch all USDT perpetual contracts from Binance
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const data = await res.json();
        const filtered: SymbolInfo[] = data.symbols
          .filter((s: any) =>
            s.contractType === 'PERPETUAL' &&
            s.quoteAsset === 'USDT' &&
            s.status === 'TRADING'
          )
          .map((s: any) => ({
            symbol: s.symbol,
            baseAsset: s.baseAsset,
            displayName: `${s.baseAsset}/USDT`,
            pricePrecision: s.pricePrecision ?? 2,
            quantityPrecision: s.quantityPrecision ?? 3,
          }))
          .sort((a: SymbolInfo, b: SymbolInfo) => a.baseAsset.localeCompare(b.baseAsset));

        if (filtered.length > 0) {
          setAvailableSymbols(filtered);
          // Emit precision for current symbol
          const current = filtered.find(s => s.symbol === symbol);
          if (current && onPrecisionChange) {
            onPrecisionChange(current.pricePrecision, current.quantityPrecision);
          }
        }
      } catch (err) {
        console.error('Failed to fetch Binance exchangeInfo, using fallback list:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  const filteredSymbols = useMemo(() => {
    if (!searchQuery.trim()) return availableSymbols;
    const q = searchQuery.toUpperCase();
    return availableSymbols.filter(s =>
      s.baseAsset.includes(q) || s.symbol.includes(q)
    );
  }, [availableSymbols, searchQuery]);

  const currentDisplay = symbol.replace('USDT', '/USDT');

  return (
    <div className="flex items-center gap-3">
      {/* Symbol dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-gray-100 dark:bg-[#2b3139] text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-[#3a3f47] transition-all duration-100 ease-out active:scale-[0.97]"
        >
          <span className="font-mono font-bold">{currentDisplay}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          {isLoading && <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
        </button>

        {isOpen && (
          <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg border border-border shadow-xl overflow-hidden"
            style={{ background: 'hsl(var(--card))' }}>
            {/* Search input */}
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索币种 (如 BTC, DOGE)"
                  className="input-dark w-full text-xs pl-8 py-1.5"
                />
              </div>
            </div>

            {/* Symbol count */}
            <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-border">
              {filteredSymbols.length} / {availableSymbols.length} 个交易对
            </div>

            {/* Scrollable symbol list */}
            <div className="max-h-96 overflow-y-auto">
              {filteredSymbols.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">未找到匹配的交易对</div>
              ) : (
                filteredSymbols.map(s => (
                  <button
                    key={s.symbol}
                    onClick={() => {
                      onSymbolChange(s.symbol);
                      if (onPrecisionChange) onPrecisionChange(s.pricePrecision, s.quantityPrecision);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors duration-100 ease-out ${
                      symbol === s.symbol ? 'bg-accent/30' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-foreground">{s.baseAsset}</span>
                      <span className="text-muted-foreground">/USDT</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary">永续</span>
                    </div>
                    {symbol === s.symbol && <Check className="w-3.5 h-3.5 text-primary" />}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Timeframe selector */}
      <TimeframeSelector interval={interval} onIntervalChange={onIntervalChange} />
    </div>
  );
}
