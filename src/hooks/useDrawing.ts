/**
 * Drawing state manager for SVG overlay on lightweight-charts
 * Manages drawing tools, persists drawings to localStorage
 */

import { useState, useCallback, useRef } from 'react';
import { usePersistedState } from './usePersistedState';

export type DrawingToolType =
  | 'TrendLine' | 'Rectangle' | 'Brush' | 'Text'
  | 'Measure' | 'FibRetracement' | 'Marker' | null;

export interface DrawingPoint {
  time: number;  // timestamp ms
  price: number;
}

export interface Drawing {
  id: string;
  tool: DrawingToolType;
  points: DrawingPoint[];  // start/end for lines, corners for rect
  color: string;
  text?: string;
  // Brush: array of pixel coords serialized
  brushPath?: string;
  // Measure result
  measureResult?: {
    priceDiff: number;
    pctDiff: number;
    timeDiff: number; // ms
  };
  // Fib levels
  fibLevels?: number[];
}

export const DRAWING_TOOLS: { type: DrawingToolType; icon: string; label: string; desc: string }[] = [
  { type: 'Measure', icon: '📏', label: '测量工具', desc: '测量价格变化、百分比和时间' },
  { type: 'TrendLine', icon: '📐', label: '线条工具', desc: '直线、射线、箭头' },
  { type: 'FibRetracement', icon: '🔢', label: '斐波那契', desc: '斐波那契回调、扩展' },
  { type: 'Rectangle', icon: '⬜', label: '几何图形', desc: '矩形、椭圆、三角形' },
  { type: 'Brush', icon: '🖌️', label: '笔刷工具', desc: '自由绘制' },
  { type: 'Text', icon: '📝', label: '文本工具', desc: '文字标签' },
  { type: 'Marker', icon: '📌', label: '标记工具', desc: '图标和符号' },
];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function useDrawing() {
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingToolType>(null);
  const [drawings, setDrawings] = usePersistedState<Drawing[]>('drawings', []);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentDrawingRef = useRef<Partial<Drawing> | null>(null);

  const startDrawing = useCallback((point: DrawingPoint) => {
    if (!activeDrawingTool) return;
    setIsDrawing(true);
    currentDrawingRef.current = {
      id: crypto.randomUUID(),
      tool: activeDrawingTool,
      points: [point],
      color: '#F0B90B',
    };
  }, [activeDrawingTool]);

  const updateDrawing = useCallback((point: DrawingPoint) => {
    if (!isDrawing || !currentDrawingRef.current) return;
    const d = currentDrawingRef.current;
    if (d.points!.length === 1) {
      d.points = [d.points![0], point];
    } else {
      d.points![1] = point;
    }
  }, [isDrawing]);

  const finishDrawing = useCallback((point: DrawingPoint) => {
    if (!currentDrawingRef.current) return;
    setIsDrawing(false);
    const d = currentDrawingRef.current;
    if (d.points!.length === 1) d.points!.push(point);
    else d.points![1] = point;

    // Measure calculations
    if (d.tool === 'Measure') {
      const [p1, p2] = d.points!;
      d.measureResult = {
        priceDiff: p2.price - p1.price,
        pctDiff: ((p2.price - p1.price) / p1.price) * 100,
        timeDiff: p2.time - p1.time,
      };
    }

    if (d.tool === 'FibRetracement') {
      d.fibLevels = FIB_LEVELS;
    }

    setDrawings(prev => [...prev, d as Drawing]);
    currentDrawingRef.current = null;
  }, [setDrawings]);

  const addBrushDrawing = useCallback((pathData: string, color: string = '#F0B90B') => {
    const drawing: Drawing = {
      id: crypto.randomUUID(),
      tool: 'Brush',
      points: [],
      color,
      brushPath: pathData,
    };
    setDrawings(prev => [...prev, drawing]);
  }, [setDrawings]);

  const addTextDrawing = useCallback((point: DrawingPoint, text: string) => {
    const drawing: Drawing = {
      id: crypto.randomUUID(),
      tool: 'Text',
      points: [point],
      color: '#F0B90B',
      text,
    };
    setDrawings(prev => [...prev, drawing]);
  }, [setDrawings]);

  const addMarkerDrawing = useCallback((point: DrawingPoint) => {
    const drawing: Drawing = {
      id: crypto.randomUUID(),
      tool: 'Marker',
      points: [point],
      color: '#F0B90B',
    };
    setDrawings(prev => [...prev, drawing]);
  }, [setDrawings]);

  const removeDrawing = useCallback((id: string) => {
    setDrawings(prev => prev.filter(d => d.id !== id));
  }, [setDrawings]);

  const clearAllDrawings = useCallback(() => {
    setDrawings([]);
  }, [setDrawings]);

  return {
    activeDrawingTool, setActiveDrawingTool,
    drawings, isDrawing,
    currentDrawingRef,
    startDrawing, updateDrawing, finishDrawing,
    addBrushDrawing, addTextDrawing, addMarkerDrawing,
    removeDrawing, clearAllDrawings,
  };
}
