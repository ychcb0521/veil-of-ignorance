import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { listUnclassifiedItems } from '@/lib/journalApi';

export default function JournalCampaignClassifyPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { tradeHistory } = useTradingContext();
  const [symbol, setSymbol] = useState(
    () => searchParams.get('symbol')?.trim().toUpperCase() ?? '',
  );
  const [remoteSymbols, setRemoteSymbols] = useState<string[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionFilter, setOptionFilter] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadingOptions(true);

    listUnclassifiedItems(user.id, { includeClassified: true })
      .then(({ journals, orphanRecords }) => {
        if (!active) return;
        setRemoteSymbols([
          ...journals.map(journal => journal.symbol),
          ...orphanRecords.map(record => record.symbol),
        ]);
      })
      .catch(() => {
        if (active) setRemoteSymbols([]);
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  const availableSymbols = useMemo(() => (
    [...new Set([
      ...tradeHistory
        .filter(record => record.action === 'CLOSE' || record.action === 'LIQUIDATION')
        .map(record => record.symbol),
      ...remoteSymbols,
    ]
      .map(value => value?.trim().toUpperCase())
      .filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b))
  ), [remoteSymbols, tradeHistory]);

  const visibleSymbols = useMemo(() => {
    const normalized = optionFilter.trim().toUpperCase();
    return normalized
      ? availableSymbols.filter(item => item.includes(normalized))
      : availableSymbols;
  }, [availableSymbols, optionFilter]);

  const openOptions = () => {
    setOptionFilter('');
    setOptionsOpen(true);
  };

  const chooseSymbol = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    setOptionFilter('');
    setOptionsOpen(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BackButton />
            <div className="min-w-0">
              <h1 className="text-[14px] font-medium">归类历史交易</h1>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                把已有的历史 journal 整理为战役。每次归类操作都是可逆的。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => nav('/journal/campaigns')}
            className="h-8 shrink-0 rounded border border-border bg-background px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            查看所有战役
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-4">
        <div
          className="relative"
          onMouseEnter={openOptions}
          onMouseLeave={() => setOptionsOpen(false)}
        >
          <Input
            autoFocus
            value={symbol}
            onFocus={openOptions}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const nextValue = event.target.value.toUpperCase();
              setSymbol(nextValue);
              setOptionFilter(nextValue);
              setOptionsOpen(true);
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') setOptionsOpen(false);
              if (event.key === 'ArrowDown') setOptionsOpen(true);
            }}
            placeholder="输入标的名称，例如 RAVEUSDT"
            aria-label="标的名称"
            aria-controls="campaign-symbol-options"
            aria-expanded={optionsOpen}
            aria-autocomplete="list"
            role="combobox"
            className="h-10 pr-10 text-[13px]"
          />
          <ChevronDown
            aria-hidden="true"
            className={`pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground transition-transform duration-150 ${optionsOpen ? 'rotate-180' : ''}`}
          />

          {optionsOpen ? (
            <div
              id="campaign-symbol-options"
              role="listbox"
              aria-label="可选标的"
              className="absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded border border-border bg-popover shadow-lg"
            >
              <div className="flex h-8 items-center justify-between border-b border-border/70 px-3 text-[10px] text-muted-foreground">
                <span>全部可选标的</span>
                <span>{availableSymbols.length}</span>
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {loadingOptions && availableSymbols.length === 0 ? (
                  <div className="flex h-16 items-center justify-center gap-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在读取历史标的
                  </div>
                ) : visibleSymbols.length > 0 ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1">
                    {visibleSymbols.map(item => (
                      <button
                        key={item}
                        type="button"
                        role="option"
                        aria-selected={item === symbol.trim()}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => chooseSymbol(item)}
                        className="flex h-8 min-w-0 items-center justify-between gap-2 rounded px-2.5 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        <span className="truncate">{item}</span>
                        {item === symbol.trim() ? <Check className="h-3.5 w-3.5 shrink-0 text-[#D99B00]" /> : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-16 items-center justify-center text-[11px] text-muted-foreground">
                    {availableSymbols.length === 0 ? '暂无可归类的历史标的' : `没有匹配“${optionFilter}”的标的`}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
