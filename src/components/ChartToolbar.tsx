/**
 * ChartToolbar - simplified wrapper, kept for backward compatibility.
 * Most functionality now lives directly in CandlestickChart.
 */

import { IndicatorMenu } from './IndicatorMenu';
import { useState } from 'react';
import { BarChart3, X } from 'lucide-react';
import type { IndicatorConfig } from './CandlestickChart';

interface Props {
  activeTool: string | null;
  onToolChange: (tool: string | null) => void;
  indicators: IndicatorConfig[];
  onIndicatorsChange: (indicators: IndicatorConfig[]) => void;
  onClearDrawings: () => void;
}

export function ChartToolbar({ activeTool, onToolChange, indicators, onIndicatorsChange, onClearDrawings }: Props) {
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);

  return (
    <div className="absolute right-12 top-0 z-10 flex items-center gap-2 py-1.5 px-2">
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowIndicatorPanel(!showIndicatorPanel); }}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.95] ${
          showIndicatorPanel ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
        }`}
      >
        <BarChart3 className="w-3.5 h-3.5" />
        <span>指标</span>
      </button>

      {indicators.map(ind => (
        <span key={ind.type} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium"
          style={{ background: `${ind.color}20`, color: ind.color }}>
          {ind.type} {ind.period}
          <button onClick={() => onIndicatorsChange(indicators.filter(i => i.type !== ind.type))} className="hover:opacity-70">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}

      <IndicatorMenu
        open={showIndicatorPanel}
        onClose={() => setShowIndicatorPanel(false)}
        indicators={indicators}
        onIndicatorsChange={onIndicatorsChange}
      />
    </div>
  );
}
