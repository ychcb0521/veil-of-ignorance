/**
 * SVG Drawing Overlay for lightweight-charts
 * Renders drawings on a transparent SVG positioned over the chart
 * Handles mouse interactions for drawing tools
 */

import { useRef, useState, useCallback, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { Drawing, DrawingToolType, DrawingPoint } from '@/hooks/useDrawing';

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  drawings: Drawing[];
  activeTool: DrawingToolType;
  isDrawing: boolean;
  currentDrawingRef: React.MutableRefObject<Partial<Drawing> | null>;
  onStartDrawing: (point: DrawingPoint) => void;
  onUpdateDrawing: (point: DrawingPoint) => void;
  onFinishDrawing: (point: DrawingPoint) => void;
  onAddBrush: (path: string, color: string) => void;
  onAddText: (point: DrawingPoint, text: string) => void;
  onAddMarker: (point: DrawingPoint) => void;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#EF4444'];

// Convert chart coordinates to pixel coordinates
function priceToY(chart: IChartApi, series: ISeriesApi<'Candlestick'>, price: number): number | null {
  const y = series.priceToCoordinate(price);
  return y !== null ? y : null;
}

function timeToX(chart: IChartApi, time: number): number | null {
  const x = chart.timeScale().timeToCoordinate((time / 1000) as any);
  return x !== null ? x : null;
}

// Convert pixel to chart coordinates
function pixelToPrice(series: ISeriesApi<'Candlestick'>, y: number): number | null {
  return series.coordinateToPrice(y) as number | null;
}

function pixelToTime(chart: IChartApi, x: number): number | null {
  const t = chart.timeScale().coordinateToTime(x);
  return t !== null ? (t as number) * 1000 : null;
}

export function DrawingOverlay({
  chart, series, drawings, activeTool, isDrawing, currentDrawingRef,
  onStartDrawing, onUpdateDrawing, onFinishDrawing,
  onAddBrush, onAddText, onAddMarker,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [brushPath, setBrushPath] = useState('');
  const [isBrushing, setIsBrushing] = useState(false);
  const [previewLine, setPreviewLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [, forceUpdate] = useState(0);

  // Force re-render when chart scrolls/zooms to update drawing positions
  useEffect(() => {
    if (!chart) return;
    const sub = chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      forceUpdate(n => n + 1);
    });
    return () => { sub(); };
  }, [chart]);

  const getChartPoint = useCallback((e: ReactMouseEvent): DrawingPoint | null => {
    if (!chart || !series || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const price = pixelToPrice(series, y);
    const time = pixelToTime(chart, x);
    if (price === null || time === null) return null;
    return { time, price };
  }, [chart, series]);

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    if (!activeTool || !chart || !series) return;
    const point = getChartPoint(e);
    if (!point) return;

    if (activeTool === 'Brush') {
      setIsBrushing(true);
      const rect = svgRef.current!.getBoundingClientRect();
      setBrushPath(`M ${e.clientX - rect.left} ${e.clientY - rect.top}`);
      return;
    }

    if (activeTool === 'Text') {
      const text = prompt('输入文本:');
      if (text) onAddText(point, text);
      return;
    }

    if (activeTool === 'Marker') {
      onAddMarker(point);
      return;
    }

    // Two-point tools: TrendLine, Rectangle, Measure, FibRetracement
    if (!isDrawing) {
      onStartDrawing(point);
      const rect = svgRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setPreviewLine({ x1: px, y1: py, x2: px, y2: py });
    } else {
      onFinishDrawing(point);
      setPreviewLine(null);
    }
  }, [activeTool, chart, series, isDrawing, getChartPoint, onStartDrawing, onFinishDrawing, onAddText, onAddMarker]);

  const handleMouseMove = useCallback((e: ReactMouseEvent) => {
    if (!activeTool || !chart || !series || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isBrushing) {
      setBrushPath(prev => `${prev} L ${x} ${y}`);
      return;
    }

    if (isDrawing) {
      const point = getChartPoint(e);
      if (point) onUpdateDrawing(point);
      setPreviewLine(prev => prev ? { ...prev, x2: x, y2: y } : null);
    }
  }, [activeTool, chart, series, isBrushing, isDrawing, getChartPoint, onUpdateDrawing]);

  const handleMouseUp = useCallback(() => {
    if (isBrushing && brushPath) {
      onAddBrush(brushPath, '#F0B90B');
      setBrushPath('');
      setIsBrushing(false);
    }
  }, [isBrushing, brushPath, onAddBrush]);

  // Render a single drawing to SVG elements
  const renderDrawing = (drawing: Drawing, idx: number) => {
    if (!chart || !series) return null;

    if (drawing.tool === 'Brush' && drawing.brushPath) {
      return (
        <path key={drawing.id} d={drawing.brushPath}
          stroke={drawing.color} strokeWidth={2} fill="none" opacity={0.8} />
      );
    }

    if (drawing.points.length < 1) return null;

    const p1 = drawing.points[0];
    const x1 = timeToX(chart, p1.time);
    const y1 = priceToY(chart, series, p1.price);
    if (x1 === null || y1 === null) return null;

    if (drawing.tool === 'Text') {
      return (
        <text key={drawing.id} x={x1} y={y1} fill={drawing.color}
          fontSize={12} fontFamily="Inter, sans-serif">
          {drawing.text}
        </text>
      );
    }

    if (drawing.tool === 'Marker') {
      return (
        <g key={drawing.id}>
          <circle cx={x1} cy={y1} r={6} fill={drawing.color} opacity={0.8} />
          <circle cx={x1} cy={y1} r={3} fill="hsl(var(--background))" />
        </g>
      );
    }

    if (drawing.points.length < 2) return null;
    const p2 = drawing.points[1];
    const x2 = timeToX(chart, p2.time);
    const y2 = priceToY(chart, series, p2.price);
    if (x2 === null || y2 === null) return null;

    if (drawing.tool === 'TrendLine') {
      return (
        <line key={drawing.id} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={drawing.color} strokeWidth={1.5} />
      );
    }

    if (drawing.tool === 'Rectangle') {
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
      return (
        <rect key={drawing.id} x={rx} y={ry} width={rw} height={rh}
          stroke={drawing.color} strokeWidth={1.5} fill={`${drawing.color}15`} />
      );
    }

    if (drawing.tool === 'Measure') {
      const m = drawing.measureResult;
      return (
        <g key={drawing.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={drawing.color} strokeWidth={1} strokeDasharray="4 2" />
          {m && (
            <foreignObject x={(x1 + x2) / 2 - 60} y={(y1 + y2) / 2 - 20} width={120} height={40}>
              <div style={{
                background: 'hsl(var(--card) / 0.95)', border: '1px solid hsl(var(--border))',
                borderRadius: 4, padding: '2px 6px', fontSize: 10, fontFamily: 'JetBrains Mono',
                color: 'hsl(var(--foreground))',
              }}>
                <div>{m.priceDiff >= 0 ? '+' : ''}{m.priceDiff.toFixed(2)} ({m.pctDiff.toFixed(2)}%)</div>
                <div style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {Math.abs(m.timeDiff / 60000).toFixed(0)}分钟
                </div>
              </div>
            </foreignObject>
          )}
        </g>
      );
    }

    if (drawing.tool === 'FibRetracement') {
      const highP = Math.max(p1.price, p2.price);
      const lowP = Math.min(p1.price, p2.price);
      const range = highP - lowP;
      return (
        <g key={drawing.id}>
          {FIB_LEVELS.map((level, li) => {
            const fibPrice = highP - range * level;
            const fy = priceToY(chart, series, fibPrice);
            if (fy === null) return null;
            return (
              <g key={li}>
                <line x1={Math.min(x1, x2)} y1={fy} x2={Math.max(x1, x2)} y2={fy}
                  stroke={FIB_COLORS[li]} strokeWidth={1} strokeDasharray={level === 0 || level === 1 ? '0' : '3 2'} />
                <text x={Math.max(x1, x2) + 4} y={fy + 3}
                  fill={FIB_COLORS[li]} fontSize={9} fontFamily="JetBrains Mono">
                  {(level * 100).toFixed(1)}% ({fibPrice.toFixed(2)})
                </text>
              </g>
            );
          })}
        </g>
      );
    }

    return null;
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{
        cursor: activeTool ? 'crosshair' : 'default',
        pointerEvents: activeTool ? 'all' : 'none',
        zIndex: activeTool ? 15 : 5,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Render persisted drawings */}
      {drawings.map((d, i) => renderDrawing(d, i))}

      {/* Live preview while drawing */}
      {previewLine && isDrawing && activeTool === 'TrendLine' && (
        <line x1={previewLine.x1} y1={previewLine.y1} x2={previewLine.x2} y2={previewLine.y2}
          stroke="#F0B90B" strokeWidth={1.5} strokeDasharray="4 2" opacity={0.6} />
      )}
      {previewLine && isDrawing && activeTool === 'Rectangle' && (
        <rect
          x={Math.min(previewLine.x1, previewLine.x2)} y={Math.min(previewLine.y1, previewLine.y2)}
          width={Math.abs(previewLine.x2 - previewLine.x1)} height={Math.abs(previewLine.y2 - previewLine.y1)}
          stroke="#F0B90B" strokeWidth={1.5} fill="#F0B90B15" strokeDasharray="4 2" opacity={0.6} />
      )}
      {previewLine && isDrawing && (activeTool === 'Measure' || activeTool === 'FibRetracement') && (
        <line x1={previewLine.x1} y1={previewLine.y1} x2={previewLine.x2} y2={previewLine.y2}
          stroke="#F0B90B" strokeWidth={1} strokeDasharray="4 2" opacity={0.5} />
      )}

      {/* Live brush path */}
      {isBrushing && brushPath && (
        <path d={brushPath} stroke="#F0B90B" strokeWidth={2} fill="none" opacity={0.6} />
      )}
    </svg>
  );
}
