import { DRAWING_TOOLS, type DrawingToolType } from '@/hooks/useDrawing';
import { INDICATOR_PRESETS, IMPLEMENTED_TYPES, type IndicatorConfig } from '@/hooks/useIndicators';
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowIndicatorPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  const updatePeriod = (type: IndicatorType, period: number) => {
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
      <div className="absolute right-12 top-0 z-20 flex items-center gap-1 py-1.5 px-2" ref={panelRef}>
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

        {/* Indicator panel dropdown */}
        {showIndicatorPanel && (
          <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-border shadow-xl overflow-hidden z-50"
            style={{ background: 'hsl(var(--card))' }}>
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">技术指标</span>
              <button onClick={() => setShowIndicatorPanel(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {INDICATOR_PRESETS.map(preset => {
                const active = indicators.find(i => i.type === preset.type);
                return (
                  <div key={preset.type}
                    className="flex items-center justify-between px-3 py-2 hover:bg-accent/30 transition-colors">
                    <button
                      onClick={() => toggleIndicator(preset.type)}
                      className="flex items-center gap-2 flex-1 text-left"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: preset.color }} />
                      <div>
                        <div className="text-xs font-medium text-foreground">{preset.label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {preset.isOverlay ? '叠加指标' : '子图指标'}
                        </div>
                      </div>
                    </button>
                    {active && (
                      <input
                        type="number"
                        value={active.period}
                        onChange={e => updatePeriod(preset.type, parseInt(e.target.value) || preset.defaultPeriod)}
                        className="w-12 px-1 py-0.5 rounded text-[10px] font-mono text-right bg-secondary border border-border text-foreground"
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                    {!active && (
                      <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
