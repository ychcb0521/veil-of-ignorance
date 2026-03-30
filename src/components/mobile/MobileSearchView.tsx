import { useState, useEffect, useMemo } from 'react';
import { Search, Star, TrendingUp, Flame } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Skeleton } from '@/components/ui/skeleton';

interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  displayName: string;
  lastPrice?: string;
  priceChangePercent?: string;
}

const FALLBACK_SYMBOLS: SymbolInfo[] = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT',
  'AVAXUSDT','DOTUSDT','LINKUSDT','MATICUSDT','LTCUSDT','UNIUSDT','ATOMUSDT',
  'APTUSDT','ARBUSDT','OPUSDT','SUIUSDT','SEIUSDT','TIAUSDT',
].map(s => ({ symbol: s, baseAsset: s.replace('USDT',''), displayName: `${s.replace('USDT','')}/USDT` }));

const HOT_LIST = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT','LTCUSDT','UNIUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT'];

type TabKey = 'favorites' | 'hot' | 'gainers' | 'new';

const TABS: { key: TabKey; label: string; icon?: React.ReactNode }[] = [
  { key: 'favorites', label: '自选', icon: <Star className="w-3 h-3" /> },
  { key: 'hot', label: '热门', icon: <TrendingUp className="w-3 h-3" /> },
  { key: 'gainers', label: '涨幅榜', icon: <TrendingUp className="w-3 h-3" /> },
  { key: 'new', label: '新币上线', icon: <Flame className="w-3 h-3" /> },
];

interface Props {
  onSelectSymbol: (symbol: string) => void;
  currentSymbol: string;
}

function PriceDisplay({ price, change }: { price?: string; change?: string }) {
  if (!price) return <span className="text-xs font-mono text-muted-foreground">--</span>;
  const pct = parseFloat(change || '0');
  const isUp = pct >= 0;
  return (
    <>
      <span className="text-xs font-mono text-foreground">{parseFloat(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
      <span className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded ${isUp ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-500'}`}>
        {isUp ? '+' : ''}{pct.toFixed(2)}%
      </span>
    </>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center px-4 py-3 border-b border-border/30 gap-2">
      <div className="flex-1"><Skeleton className="h-4 w-20" /><Skeleton className="h-3 w-12 mt-1" /></div>
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-5 w-16 rounded" />
    </div>
  );
}

export function MobileSearchView({ onSelectSymbol, currentSymbol }: Props) {
  const [allSymbols, setAllSymbols] = useState<SymbolInfo[]>([]);
  const [newListingSymbols, setNewListingSymbols] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('hot');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [infoRes, tickerRes] = await Promise.all([
          fetch('https://fapi.binance.com/fapi/v1/exchangeInfo'),
          fetch('https://fapi.binance.com/fapi/v1/ticker/24hr'),
        ]);
        const [infoData, tickerData] = await Promise.all([infoRes.json(), tickerRes.json()]);
        if (cancelled) return;

        const perpetuals = infoData.symbols.filter(
          (s: any) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING'
        );

        // Last 10 from raw array = "new listings" mock
        const newSyms = perpetuals.slice(-10).map((s: any) => s.symbol);

        const tickerMap = new Map<string, { lastPrice: string; priceChangePercent: string }>();
        for (const t of tickerData) {
          tickerMap.set(t.symbol, { lastPrice: t.lastPrice, priceChangePercent: t.priceChangePercent });
        }

        const merged: SymbolInfo[] = perpetuals
          .map((s: any) => {
            const tick = tickerMap.get(s.symbol);
            return {
              symbol: s.symbol,
              baseAsset: s.baseAsset,
              displayName: `${s.baseAsset}/USDT`,
              lastPrice: tick?.lastPrice,
              priceChangePercent: tick?.priceChangePercent,
            };
          })
          .sort((a: SymbolInfo, b: SymbolInfo) => a.baseAsset.localeCompare(b.baseAsset));

        if (!cancelled && merged.length > 0) {
          setAllSymbols(merged);
          setNewListingSymbols(newSyms);
        }
      } catch { /* fallback */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const symbols = allSymbols.length > 0 ? allSymbols : FALLBACK_SYMBOLS;

  const filtered = useMemo(() => {
    let list = symbols;

    // Tab filtering
    switch (activeTab) {
      case 'hot':
        list = symbols.filter(s => HOT_LIST.includes(s.symbol));
        break;
      case 'gainers':
        list = [...symbols]
          .filter(s => s.priceChangePercent !== undefined)
          .sort((a, b) => parseFloat(b.priceChangePercent || '0') - parseFloat(a.priceChangePercent || '0'))
          .slice(0, 10);
        break;
      case 'new':
        list = symbols.filter(s => newListingSymbols.includes(s.symbol));
        break;
      case 'favorites':
        list = []; // placeholder - no favorites yet
        break;
    }

    // Search filter
    if (search.trim()) {
      const q = search.toUpperCase();
      list = list.filter(s => s.baseAsset.includes(q) || s.symbol.includes(q));
    }

    return list;
  }, [symbols, search, activeTab, newListingSymbols]);

  const isNewListing = (sym: string) => newListingSymbols.includes(sym);

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
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            {tab.label}
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
        {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="text-sm text-muted-foreground">
              {activeTab === 'favorites' ? '暂无自选币种，去热门页添加吧' : '未找到匹配的交易对'}
            </span>
          </div>
        )}

        {!loading && filtered.map((sym, idx) => (
          <button
            key={sym.symbol}
            onClick={() => onSelectSymbol(sym.symbol)}
            className={`w-full flex items-center px-4 py-3 border-b border-border/30 hover:bg-accent/30 active:bg-accent/50 transition-colors ${
              currentSymbol === sym.symbol ? 'bg-accent/20' : ''
            }`}
          >
            <div className="flex-1 text-left">
              <div className="flex items-center gap-1.5">
                {activeTab === 'gainers' && (
                  <span className="text-[10px] font-bold text-muted-foreground w-4">{idx + 1}</span>
                )}
                <span className="text-sm font-bold text-foreground font-mono">{sym.baseAsset}</span>
                <span className="text-[10px] text-muted-foreground">/USDT</span>
                <span className="text-[8px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">永续</span>
                {isNewListing(sym.symbol) && activeTab === 'new' && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-500 font-bold">🔥 新</span>
                )}
              </div>
            </div>

            <div className="w-24 text-right">
              <PriceDisplay price={sym.lastPrice} change={sym.priceChangePercent} />
            </div>

            <div className="w-20 text-right">
              {sym.priceChangePercent !== undefined ? (
                <span className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                  parseFloat(sym.priceChangePercent) >= 0
                    ? 'bg-green-500/15 text-green-500'
                    : 'bg-red-500/15 text-red-500'
                }`}>
                  {parseFloat(sym.priceChangePercent) >= 0 ? '+' : ''}{parseFloat(sym.priceChangePercent).toFixed(2)}%
                </span>
              ) : (
                <span className="text-[11px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-secondary">--</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
