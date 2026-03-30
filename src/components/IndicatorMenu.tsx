/**
 * IndicatorMenu — Searchable indicator panel.
 * Works with klinecharts native indicator system.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, Plus, Check } from 'lucide-react';
import type { IndicatorConfig } from './CandlestickChart';

export interface IndicatorCatalogItem {
  id: string;
  nameZh: string;
  nameEn: string;
  isOverlay: boolean;
  defaultPeriod: number;
  color: string;
}

export const INDICATOR_CATALOG: IndicatorCatalogItem[] = [
  { id: 'MA',   nameZh: '移动平均线 (MA)',      nameEn: 'MA',   isOverlay: true,  defaultPeriod: 7,  color: '#F0B90B' },
  { id: 'EMA',  nameZh: '指数移动平均线 (EMA)',  nameEn: 'EMA',  isOverlay: true,  defaultPeriod: 21, color: '#3B82F6' },
  { id: 'WMA',  nameZh: '加权移动平均线 (WMA)',  nameEn: 'WMA',  isOverlay: true,  defaultPeriod: 20, color: '#FDBA74' },
  { id: 'BOLL', nameZh: '布林带 (Bollinger)',     nameEn: 'BOLL', isOverlay: true,  defaultPeriod: 20, color: '#8B5CF6' },
  { id: 'SAR',  nameZh: '抛物线转向 (SAR)',       nameEn: 'SAR',  isOverlay: true,  defaultPeriod: 2,  color: '#FACC15' },
  { id: 'RSI',  nameZh: '相对强弱指标 (RSI)',     nameEn: 'RSI',  isOverlay: false, defaultPeriod: 14, color: '#F59E0B' },
  { id: 'MACD', nameZh: 'MACD',                   nameEn: 'MACD', isOverlay: false, defaultPeriod: 12, color: '#10B981' },
  { id: 'KDJ',  nameZh: '随机指数 (KDJ)',         nameEn: 'KDJ',  isOverlay: false, defaultPeriod: 14, color: '#A855F7' },
  { id: 'ATR',  nameZh: '真实波动幅度 (ATR)',     nameEn: 'ATR',  isOverlay: false, defaultPeriod: 14, color: '#EF4444' },
  { id: 'CCI',  nameZh: '顺势指标 (CCI)',         nameEn: 'CCI',  isOverlay: false, defaultPeriod: 20, color: '#94A3B8' },
  { id: 'OBV',  nameZh: '能量潮 (OBV)',           nameEn: 'OBV',  isOverlay: false, defaultPeriod: 1,  color: '#A855F7' },
  { id: 'ROC',  nameZh: '变化速率 (ROC)',         nameEn: 'ROC',  isOverlay: false, defaultPeriod: 12, color: '#FCD34D' },
  { id: 'DMI',  nameZh: '趋向指标 (DMI)',         nameEn: 'DMI',  isOverlay: false, defaultPeriod: 14, color: '#FB923C' },
  { id: 'WR',   nameZh: '威廉指标 (%R)',          nameEn: 'WR',   isOverlay: false, defaultPeriod: 14, color: '#FDA4AF' },
  { id: 'TRIX', nameZh: 'TRIX',                   nameEn: 'TRIX', isOverlay: false, defaultPeriod: 15, color: '#2DD4BF' },
  { id: 'VOL',  nameZh: '成交量 (VOL)',           nameEn: 'VOL',  isOverlay: false, defaultPeriod: 1,  color: '#6366F1' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  indicators: IndicatorConfig[];
  onIndicatorsChange: (indicators: IndicatorConfig[]) => void;
}

export function IndicatorMenu({ open, onClose, indicators, onIndicatorsChange }: Props) {
  const [search, setSearch] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return INDICATOR_CATALOG;
    const q = search.toLowerCase();
    return INDICATOR_CATALOG.filter(
      item => item.nameZh.toLowerCase().includes(q) || item.nameEn.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
    );
  }, [search]);

  const toggleIndicator = (item: IndicatorCatalogItem) => {
    const existing = indicators.find(i => i.type === item.id);
    if (existing) {
      onIndicatorsChange(indicators.filter(i => i.type !== item.id));
      return;
    }
    onIndicatorsChange([...indicators, { type: item.id, period: item.defaultPeriod, color: item.color, enabled: true }]);
  };

  const updatePeriod = (id: string, period: number) => {
    onIndicatorsChange(indicators.map(i => i.type === id ? { ...i, period } : i));
  };

  if (!open) return null;

  const overlays = filtered.filter(i => i.isOverlay);
  const oscillators = filtered.filter(i => !i.isOverlay);

  return (
    <div ref={panelRef} className="absolute right-2 top-10 z-50 w-80 rounded-lg border border-border shadow-2xl overflow-hidden bg-card">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-semibold text-foreground">技术指标</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

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

      <div className="max-h-96 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">未找到匹配的指标</div>
        )}

        {overlays.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border">
              主图叠加 · Overlays
            </div>
            {overlays.map(item => (
              <IndicatorRow key={item.id} item={item} indicators={indicators} onToggle={toggleIndicator} onUpdatePeriod={updatePeriod} />
            ))}
          </>
        )}

        {oscillators.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border">
              副图指标 · Oscillators
            </div>
            {oscillators.map(item => (
              <IndicatorRow key={item.id} item={item} indicators={indicators} onToggle={toggleIndicator} onUpdatePeriod={updatePeriod} />
            ))}
          </>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
        已启用 {indicators.length} 个指标 · 共 {INDICATOR_CATALOG.length} 个可用
      </div>
    </div>
  );
}

function IndicatorRow({ item, indicators, onToggle, onUpdatePeriod }: {
  item: IndicatorCatalogItem;
  indicators: IndicatorConfig[];
  onToggle: (item: IndicatorCatalogItem) => void;
  onUpdatePeriod: (id: string, period: number) => void;
}) {
  const active = indicators.find(i => i.type === item.id);

  return (
    <div
      className="flex items-center justify-between px-3 py-2 hover:bg-accent/30 transition-colors cursor-pointer group"
      onClick={() => onToggle(item)}
    >
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
        <div className="min-w-0">
          <span className="text-xs font-medium text-foreground truncate block">{item.nameZh}</span>
          <span className="text-[10px] text-muted-foreground">{item.nameEn}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {active ? (
          <>
            <input
              type="number"
              value={active.period}
              onChange={e => { e.stopPropagation(); onUpdatePeriod(item.id, parseInt(e.target.value) || item.defaultPeriod); }}
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
}
