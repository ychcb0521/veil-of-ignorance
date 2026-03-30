import { useState, useEffect, useMemo } from 'react';
import { Search, ArrowLeft, Star, TrendingUp, TrendingDown } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  displayName: string;
}

const FALLBACK_SYMBOLS: SymbolInfo[] = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT',
  'AVAXUSDT','DOTUSDT','LINKUSDT','MATICUSDT','LTCUSDT','UNIUSDT','ATOMUSDT',
  'APTUSDT','ARBUSDT','OPUSDT','SUIUSDT','SEIUSDT','TIAUSDT',
].map(s => ({ symbol: s, baseAsset: s.replace('USDT',''), displayName: `${s.replace('USDT','')}/USDT` }));

const TABS = ['热门', '全部', 'USDT', '新币上线', '涨幅榜'];

interface Props {
  onSelectSymbol: (symbol: string) => void;
  currentSymbol: string;
}

export function MobileSearchView({ onSelectSymbol, currentSymbol }: Props) {
  const [symbols, setSymbols] = useState<SymbolInfo[]>(FALLBACK_SYMBOLS);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('热门');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const data = await res.json();
        const filtered: SymbolInfo[] = data.symbols
          .filter((s: any) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
          .map((s: any) => ({ symbol: s.symbol, baseAsset: s.baseAsset, displayName: `${s.baseAsset}/USDT` }))
          .sort((a: SymbolInfo, b: SymbolInfo) => a.baseAsset.localeCompare(b.baseAsset));
        if (filtered.length > 0) setSymbols(filtered);
      } catch { /* use fallback */ }
      finally { setLoading(false); }
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = symbols;
    if (activeTab === '热门') {
      const hotList = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT','LTCUSDT','UNIUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT'];
      list = symbols.filter(s => hotList.includes(s.symbol));
    }
    if (search.trim()) {
      const q = search.toUpperCase();
      list = list.filter(s => s.baseAsset.includes(q) || s.symbol.includes(q));
    }
    return list;
  }, [symbols, search, activeTab]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card">
        <ThemeToggle />
        <span className="text-xs font-bold text-primary tracking-widest">⚡ 无知之幕</span>
        <span className="ml-auto text-[10px] text-muted-foreground">交易平台</span>
      </div>

      {/* Search bar */}
      <div className="px-3 py-2 bg-card border-b border-border">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索币种 (如 BTC, DOGE)"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 px-1 py-1.5 border-b border-border bg-card overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeTab === tab
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="flex items-center px-4 py-1.5 text-[10px] text-muted-foreground border-b border-border bg-card">
        <span className="flex-1">币种 / 合约</span>
        <span className="w-24 text-right">最新价</span>
        <span className="w-20 text-right">24h涨跌</span>
      </div>

      {/* Symbol list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-muted-foreground animate-pulse">加载交易对...</span>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-muted-foreground">未找到匹配的交易对</span>
          </div>
        )}
        {filtered.map(sym => (
          <button
            key={sym.symbol}
            onClick={() => onSelectSymbol(sym.symbol)}
            className={`w-full flex items-center px-4 py-3 border-b border-border/30 hover:bg-accent/30 active:bg-accent/50 transition-colors ${
              currentSymbol === sym.symbol ? 'bg-accent/20' : ''
            }`}
          >
            {/* Symbol info */}
            <div className="flex-1 text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-foreground font-mono">{sym.baseAsset}</span>
                <span className="text-[10px] text-muted-foreground">/USDT</span>
                <span className="text-[8px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">永续</span>
              </div>
            </div>

            {/* Placeholder price (will show real data when available) */}
            <div className="w-24 text-right">
              <span className="text-xs font-mono text-foreground">--</span>
            </div>

            {/* Placeholder change */}
            <div className="w-20 text-right">
              <span className="text-[11px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-secondary">
                --
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
