/**
 * TradingView-style left vertical drawing toolbar with flyout sub-menus.
 * Hover/long-press triggers submenu. Single click activates default tool.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Crosshair, MousePointer, Circle, Pencil,
  TrendingUp, Minus, ArrowRight, MoveHorizontal, MoveVertical, Columns,
  GitBranch,
  PenTool, Square, CircleIcon,
  Type, Tag, DollarSign,
  Shapes,
  ArrowUpRight, ArrowDownRight, Ruler as RulerIcon,
  Ruler, ZoomIn, Magnet, Lock, Eye, EyeOff, Trash2, PenLine
} from 'lucide-react';

interface ToolItem {
  id: string | null;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

interface ToolGroup {
  id: string;
  items: ToolItem[];
}

const ICON_SIZE = 15;
const ICON_STROKE = 1.5;

const toolGroups: ToolGroup[] = [
  {
    id: 'cursors',
    items: [
      { id: null, label: '十字光标', icon: <Crosshair size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: null, label: '圆点', icon: <Circle size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: null, label: '箭头', icon: <MousePointer size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: null, label: '橡皮擦', icon: <Pencil size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
    ],
  },
  {
    id: 'trendlines',
    items: [
      { id: 'TrendLine', label: '趋势线', icon: <TrendingUp size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'Ray', label: '射线', icon: <ArrowRight size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'ExtendedLine', label: '延长线', icon: <Minus size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'HorizontalLine', label: '水平线', icon: <MoveHorizontal size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'VerticalLine', label: '垂直线', icon: <MoveVertical size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'ParallelChannel', label: '平行通道', icon: <Columns size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
    ],
  },
  {
    id: 'fibonacci',
    items: [
      { id: 'FibRetracement', label: '斐波那契回调', icon: <GitBranch size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
    ],
  },
  {
    id: 'shapes',
    items: [
      { id: 'Brush', label: '画笔', icon: <PenTool size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'Rectangle', label: '矩形', icon: <Square size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'Circle', label: '椭圆', icon: <CircleIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
    ],
  },
  {
    id: 'annotations',
    items: [
      { id: 'Text', label: '文本', icon: <Type size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'Marker', label: '标记', icon: <Tag size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'PriceLine', label: '价格标签', icon: <DollarSign size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
    ],
  },
  {
    id: 'patterns',
    items: [
      { id: null, label: 'XABCD 形态', icon: <Shapes size={ICON_SIZE} strokeWidth={ICON_STROKE} />, disabled: true },
    ],
  },
  {
    id: 'positions',
    items: [
      { id: 'LongPosition', label: '多头头寸', icon: <ArrowUpRight size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'ShortPosition', label: '空头头寸', icon: <ArrowDownRight size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { id: 'Measure', label: '日期和价格范围', icon: <RulerIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
    ],
  },
];

const HOVER_DELAY = 300; // ms before submenu opens on hover
const LONG_PRESS_DELAY = 400; // ms

interface Props {
  activeTool: string | null;
  onToolChange: (tool: string | null) => void;
  onClearDrawings: () => void;
  drawingsVisible: boolean;
  onToggleDrawingsVisible: () => void;
}

export function DrawingToolbar({ activeTool, onToolChange, onClearDrawings, drawingsVisible, onToggleDrawingsVisible }: Props) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [selectedPerGroup, setSelectedPerGroup] = useState<Record<string, number>>({});
  const [magnetMode, setMagnetMode] = useState(false);
  const [stayInDrawing, setStayInDrawing] = useState(false);
  const [lockDrawings, setLockDrawings] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenGroupId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const getActiveItem = (group: ToolGroup): ToolItem => {
    const idx = selectedPerGroup[group.id] ?? 0;
    return group.items[idx] || group.items[0];
  };

  const openSubmenu = useCallback((groupId: string) => {
    setOpenGroupId(groupId);
  }, []);

  const closeSubmenu = useCallback(() => {
    setOpenGroupId(null);
  }, []);

  const handleSubItemClick = (groupId: string, itemIndex: number, item: ToolItem) => {
    setSelectedPerGroup(prev => ({ ...prev, [groupId]: itemIndex }));
    setOpenGroupId(null);
    if (!item.disabled) {
      onToolChange(item.id);
    }
  };

  const handleMainIconClick = (group: ToolGroup) => {
    const activeItem = getActiveItem(group);
    if (group.items.length <= 1) {
      if (!activeItem.disabled) {
        onToolChange(activeTool === activeItem.id ? null : activeItem.id);
      }
      return;
    }
    if (activeTool === activeItem.id) {
      onToolChange(null);
    } else if (!activeItem.disabled) {
      onToolChange(activeItem.id);
    }
  };

  // Hover handlers for groups with submenus
  const handleGroupMouseEnter = (group: ToolGroup) => {
    if (group.items.length <= 1) return;
    hoverTimerRef.current = setTimeout(() => {
      openSubmenu(group.id);
    }, HOVER_DELAY);
  };

  const handleGroupMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  // Long-press handlers
  const handlePointerDown = (group: ToolGroup) => {
    if (group.items.length <= 1) return;
    longPressTimerRef.current = setTimeout(() => {
      openSubmenu(group.id);
    }, LONG_PRESS_DELAY);
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <div
      ref={toolbarRef}
      className="absolute left-0 top-0 bottom-0 z-20 flex flex-col items-center py-1.5 w-[34px] overflow-hidden"
      style={{ background: 'hsl(var(--card) / 0.95)', borderRight: '1px solid hsl(var(--border))' }}
    >
      <div className="flex flex-col items-center gap-0.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {toolGroups.map((group) => {
          const activeItem = getActiveItem(group);
          const isActive = activeTool !== null && group.items.some(i => i.id === activeTool);
          const hasSubmenu = group.items.length > 1;
          const isOpen = openGroupId === group.id;

          return (
            <div
              key={group.id}
              className="relative"
              onMouseEnter={() => handleGroupMouseEnter(group)}
              onMouseLeave={handleGroupMouseLeave}
            >
              <button
                className={`w-[30px] h-[30px] flex items-center justify-center rounded transition-all duration-100 ease-out active:scale-[0.9] relative group ${
                  isActive
                    ? 'text-primary bg-primary/20 ring-1 ring-primary/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
                } ${activeItem.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => handleMainIconClick(group)}
                onPointerDown={() => handlePointerDown(group)}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onContextMenu={(e) => { e.preventDefault(); openSubmenu(group.id); }}
              >
                {activeItem.icon}
                {hasSubmenu && (
                  <button
                    className="absolute bottom-0 right-0 w-[10px] h-[10px] flex items-center justify-center"
                    onClick={(e) => { e.stopPropagation(); openSubmenu(group.id); }}
                  >
                    <svg width="5" height="5" viewBox="0 0 5 5" fill="currentColor" className="opacity-50">
                      <polygon points="0,0 5,2.5 0,5" />
                    </svg>
                  </button>
                )}
              </button>

              {isOpen && hasSubmenu && (
                <div
                  className="absolute left-full top-0 ml-1 py-1 rounded-md shadow-xl border border-border min-w-[160px] z-50 animate-in fade-in-0 zoom-in-95 slide-in-from-left-2 duration-150"
                  style={{ background: 'hsl(var(--popover))' }}
                  onMouseEnter={() => {
                    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                  }}
                  onMouseLeave={() => closeSubmenu()}
                >
                  {group.items.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSubItemClick(group.id, idx, item)}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors duration-100 ease-out ${
                        item.disabled
                          ? 'opacity-50 cursor-not-allowed text-muted-foreground'
                          : activeTool === item.id
                            ? 'text-primary bg-primary/15 font-medium'
                            : 'text-foreground hover:bg-accent/50'
                      }`}
                      disabled={item.disabled}
                    >
                      <span className="w-4 h-4 flex items-center justify-center">{item.icon}</span>
                      <span>{item.label}</span>
                      {activeTool === item.id && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )}

              {!isOpen && (
                <Tooltip delayDuration={400}>
                  <TooltipTrigger asChild>
                    <div className="absolute inset-0" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-[10px]">
                    {activeItem.label}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-0.5 border-t border-border pt-1.5 mt-1 shrink-0">
        <ToolbarButton icon={<Ruler size={ICON_SIZE} strokeWidth={ICON_STROKE} />} label="测量"
          active={activeTool === 'Measure'} onClick={() => onToolChange(activeTool === 'Measure' ? null : 'Measure')} />
        <ToolbarButton icon={<ZoomIn size={ICON_SIZE} strokeWidth={ICON_STROKE} />} label="放大" onClick={() => {}} />
        <ToolbarButton icon={<Magnet size={ICON_SIZE} strokeWidth={ICON_STROKE} />} label="磁铁模式"
          active={magnetMode} onClick={() => setMagnetMode(!magnetMode)} />
        <ToolbarButton icon={<PenLine size={ICON_SIZE} strokeWidth={ICON_STROKE} />} label="保持绘图模式"
          active={stayInDrawing} onClick={() => setStayInDrawing(!stayInDrawing)} />
        <ToolbarButton icon={<Lock size={ICON_SIZE} strokeWidth={ICON_STROKE} />} label="锁定所有绘图"
          active={lockDrawings} onClick={() => setLockDrawings(!lockDrawings)} />
        <ToolbarButton
          icon={drawingsVisible ? <Eye size={ICON_SIZE} strokeWidth={ICON_STROKE} /> : <EyeOff size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
          label={drawingsVisible ? '隐藏所有绘图' : '显示所有绘图'}
          active={!drawingsVisible} onClick={onToggleDrawingsVisible} />
        <ToolbarButton icon={<Trash2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />} label="清除所有绘图"
          onClick={onClearDrawings} variant="destructive" />
      </div>
    </div>
  );
}

function ToolbarButton({ icon, label, active, onClick, variant }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; variant?: 'destructive';
}) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`w-[30px] h-[30px] flex items-center justify-center rounded transition-all duration-100 ease-out active:scale-[0.9] ${
            variant === 'destructive'
              ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
              : active
                ? 'text-primary bg-primary/20 ring-1 ring-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
          }`}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-[10px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
