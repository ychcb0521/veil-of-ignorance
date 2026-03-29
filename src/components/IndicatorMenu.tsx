/**
 * IndicatorMenu — Full-catalogue searchable indicator panel (80+ items)
 * MVP: Only MA, EMA, BOLL, RSI, MACD, ATR are wired. Others show a toast.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, Plus, Check } from 'lucide-react';
import { INDICATOR_CATALOG, IMPLEMENTED_TYPES, type IndicatorConfig, type IndicatorCatalogItem } from '@/hooks/useIndicators';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  indicators: IndicatorConfig[];
  onIndicatorsChange: (indicators: IndicatorConfig[]) => void;
}

export function IndicatorMenu({ open, onClose, indicators, onIndicatorsChange }: Props) {
  const [search, setSearch] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // Filter catalogue by search (fuzzy match on zh + en names)
  const filtered = useMemo(() => {
    if (!search.trim()) return INDICATOR_CATALOG;
    const q = search.toLowerCase();
    return INDICATOR_CATALOG.filter(
      item => item.nameZh.toLowerCase().includes(q)
        || item.nameEn.toLowerCase().includes(q)
        || item.id.toLowerCase().includes(q)
    );
  }, [search]);

  const toggleIndicator = (item: IndicatorCatalogItem) => {
    // Check if already active
    const existing = indicators.find(i => i.type === item.id);
    if (existing) {
      onIndicatorsChange(indicators.filter(i => i.type !== item.id));
      return;
    }

    // Check if implemented
    if (!IMPLEMENTED_TYPES.has(item.id)) {
      toast.info('该指标计算引擎正在接入中...', { duration: 2000 });
      return;
    }

    onIndicatorsChange([...indicators, {
      type: item.id,
      period: item.defaultPeriod,
      color: item.color,
      enabled: true,
    }]);
  };

  const updatePeriod = (id: string, period: number) => {
    onIndicatorsChange(indicators.map(i => i.type === id ? { ...i, period } : i));
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute right-2 top-10 z-50 w-80 rounded-lg border border-border shadow-2xl overflow-hidden"
      style={{ background: 'hsl(var(--card))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-semibold text-foreground">技术指标</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/50 border border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索指标 (如 MACD, 布林带, RSI)"
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Indicator list */}
      <div className="max-h-96 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            未找到匹配的指标
          </div>
        )}
        {filtered.map(item => {
          const active = indicators.find(i => i.type === item.id);
          const implemented = IMPLEMENTED_TYPES.has(item.id);

          return (
            <div
              key={item.id}
              className="flex items-center justify-between px-3 py-2 hover:bg-accent/30 transition-colors cursor-pointer group"
              onClick={() => toggleIndicator(item)}
            >
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {/* Color dot */}
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: item.color, opacity: implemented ? 1 : 0.4 }}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium truncate ${implemented ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {item.nameZh}
                    </span>
                    {!implemented && (
                      <span className="text-[8px] px-1 py-0 rounded bg-muted text-muted-foreground">
                        即将上线
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{item.nameEn}</span>
                </div>
              </div>

              {/* Right side: period input or add icon */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {active ? (
                  <>
                    <input
                      type="number"
                      value={active.period}
                      onChange={e => {
                        e.stopPropagation();
                        updatePeriod(item.id, parseInt(e.target.value) || item.defaultPeriod);
                      }}
                      onClick={e => e.stopPropagation()}
                      className="w-12 px-1 py-0.5 rounded text-[10px] font-mono text-right bg-secondary border border-border text-foreground"
                    />
                    <Check className="w-3.5 h-3.5 text-primary" />
                  </>
                ) : (
                  <Plus className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: active count */}
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
        已启用 {indicators.length} 个指标 · 共 {INDICATOR_CATALOG.length} 个可用
      </div>
    </div>
  );
}
