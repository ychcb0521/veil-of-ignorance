import { DRAWING_TOOLS, type DrawingToolType } from '@/hooks/useDrawing';
import { INDICATOR_PRESETS, IMPLEMENTED_TYPES, type IndicatorConfig } from '@/hooks/useIndicators';
import { IndicatorMenu } from './IndicatorMenu';
import { useState, useRef, useEffect } from 'react';
import {
  Ruler, TrendingUp, GitBranch, Square, Pen, Type, MapPin,
  BarChart3, Settings, LayoutGrid, CandlestickChart as CandleIcon,
  Plus, X, Trash2
} from 'lucide-react';

const TOOL_ICONS: Record<string, React.ReactNode> = {
  Measure: <Ruler className="w-4 h-4" />,
  TrendLine: <TrendingUp className="w-4 h-4" />,
  FibRetracement: <GitBranch className="w-4 h-4" />,
  Rectangle: <Square className="w-4 h-4" />,
  Brush: <Pen className="w-4 h-4" />,
  Text: <Type className="w-4 h-4" />,
  Marker: <MapPin className="w-4 h-4" />,
};

interface Props {
  activeTool: DrawingToolType;
  onToolChange: (tool: DrawingToolType) => void;
  indicators: IndicatorConfig[];
  onIndicatorsChange: (indicators: IndicatorConfig[]) => void;
  onClearDrawings: () => void;
}

export function ChartToolbar({ activeTool, onToolChange, indicators, onIndicatorsChange, onClearDrawings }: Props) {
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);

  const toggleIndicator = (type: string) => {
    const existing = indicators.find(i => i.type === type);
    if (existing) {
      onIndicatorsChange(indicators.filter(i => i.type !== type));
    } else {
      const preset = INDICATOR_PRESETS.find(p => p.type === type)!;
      onIndicatorsChange([...indicators, {
        type, period: preset.defaultPeriod, color: preset.color, enabled: true,
      }]);
    }
  };

  const updatePeriod = (type: string, period: number) => {
    onIndicatorsChange(indicators.map(i => i.type === type ? { ...i, period } : i));
  };

  return (
    <>
      {/* Left vertical drawing toolbar */}
      <div className="absolute left-0 top-0 bottom-0 z-20 flex flex-col items-center py-2 px-1 gap-0.5"
        style={{ background: 'hsl(var(--card) / 0.9)', borderRight: '1px solid hsl(var(--border))' }}>
        {DRAWING_TOOLS.map(tool => (
          <button
            key={tool.type}
            onClick={() => onToolChange(activeTool === tool.type ? null : tool.type)}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors group relative ${
              activeTool === tool.type
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
            title={`${tool.label} - ${tool.desc}`}
          >
            {TOOL_ICONS[tool.type!] || <span className="text-xs">{tool.icon}</span>}
            {/* Tooltip */}
            <div className="absolute left-full ml-2 hidden group-hover:flex items-center z-50 pointer-events-none">
              <div className="px-2 py-1 rounded text-[10px] whitespace-nowrap border border-border"
                style={{ background: 'hsl(var(--popover))', color: 'hsl(var(--foreground))' }}>
                <div className="font-medium">{tool.label}</div>
                <div className="text-muted-foreground">{tool.desc}</div>
              </div>
            </div>
          </button>
        ))}

        <div className="border-t border-border w-5 my-1" />

        {/* Clear drawings */}
        <button
          onClick={onClearDrawings}
          className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="清除所有绘图"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right side: indicator buttons */}
      <div className="absolute right-12 top-0 z-20 flex items-center gap-1 py-1.5 px-2">
        <button
          onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
            showIndicatorPanel ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>指标</span>
        </button>

        {/* Active indicator pills */}
        {indicators.map(ind => (
          <span key={ind.type} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium"
            style={{ background: `${ind.color}20`, color: ind.color }}>
            {ind.type} {ind.period}
            <button onClick={() => toggleIndicator(ind.type)} className="hover:opacity-70">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}

        {/* Full indicator menu (80+ items with search) */}
        <IndicatorMenu
          open={showIndicatorPanel}
          onClose={() => setShowIndicatorPanel(false)}
          indicators={indicators}
          onIndicatorsChange={onIndicatorsChange}
        />
      </div>
    </>
  );
}
