import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface WheelColumnProps {
  items: { value: number; label: string }[];
  selected: number;
  onChange: (val: number) => void;
  itemHeight?: number;
  visibleCount?: number;
}

function WheelColumn({ items, selected, onChange, itemHeight = 40, visibleCount = 5 }: WheelColumnProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startScroll = useRef(0);
  const velocity = useRef(0);
  const lastY = useRef(0);
  const lastTime = useRef(0);
  const animFrame = useRef(0);

  const selectedIdx = items.findIndex(i => i.value === selected);
  const halfVisible = Math.floor(visibleCount / 2);
  const containerHeight = itemHeight * visibleCount;

  const scrollToIndex = useCallback((idx: number, smooth = true) => {
    if (!containerRef.current) return;
    const target = idx * itemHeight;
    if (smooth) {
      containerRef.current.scrollTo({ top: target, behavior: 'smooth' });
    } else {
      containerRef.current.scrollTop = target;
    }
  }, [itemHeight]);

  useEffect(() => {
    const idx = items.findIndex(i => i.value === selected);
    if (idx >= 0) scrollToIndex(idx, false);
  }, [selected, items, scrollToIndex]);

  const snapToNearest = useCallback(() => {
    if (!containerRef.current) return;
    const scrollTop = containerRef.current.scrollTop;
    const idx = Math.round(scrollTop / itemHeight);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    scrollToIndex(clamped);
    if (items[clamped] && items[clamped].value !== selected) {
      onChange(items[clamped].value);
    }
  }, [itemHeight, items, onChange, selected, scrollToIndex]);

  const handleTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    startY.current = e.touches[0].clientY;
    startScroll.current = containerRef.current?.scrollTop || 0;
    lastY.current = e.touches[0].clientY;
    lastTime.current = Date.now();
    velocity.current = 0;
    cancelAnimationFrame(animFrame.current);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const y = e.touches[0].clientY;
    const diff = startY.current - y;
    containerRef.current.scrollTop = startScroll.current + diff;

    const now = Date.now();
    const dt = now - lastTime.current;
    if (dt > 0) {
      velocity.current = (lastY.current - y) / dt;
    }
    lastY.current = y;
    lastTime.current = now;
  };

  const handleTouchEnd = () => {
    isDragging.current = false;
    // Inertia scroll then snap
    if (Math.abs(velocity.current) > 0.3 && containerRef.current) {
      let v = velocity.current * 8;
      const decay = () => {
        if (!containerRef.current || Math.abs(v) < 0.5) {
          snapToNearest();
          return;
        }
        containerRef.current.scrollTop += v;
        v *= 0.92;
        animFrame.current = requestAnimationFrame(decay);
      };
      decay();
    } else {
      snapToNearest();
    }
  };

  // Mouse support for desktop testing
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    containerRef.current.scrollTop += e.deltaY;
    clearTimeout((handleWheel as any)._t);
    (handleWheel as any)._t = setTimeout(snapToNearest, 100);
  };

  return (
    <div className="relative flex-1" style={{ height: containerHeight }}>
      {/* Highlight band */}
      <div
        className="absolute left-0 right-0 pointer-events-none z-10 border-y border-primary/40 bg-primary/10 rounded"
        style={{ top: halfVisible * itemHeight, height: itemHeight }}
      />
      {/* Top fade */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-20"
        style={{ height: halfVisible * itemHeight, background: 'linear-gradient(to bottom, hsl(var(--card)), transparent)' }}
      />
      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none z-20"
        style={{ height: halfVisible * itemHeight, background: 'linear-gradient(to top, hsl(var(--card)), transparent)' }}
      />
      <div
        ref={containerRef}
        className="h-full overflow-hidden"
        style={{ scrollbarWidth: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
        {/* Top padding */}
        <div style={{ height: halfVisible * itemHeight }} />
        {items.map((item, idx) => (
          <div
            key={item.value + '-' + idx}
            className={`flex items-center justify-center font-mono text-sm transition-colors cursor-pointer select-none ${
              item.value === selected ? 'text-foreground font-bold' : 'text-muted-foreground/60'
            }`}
            style={{ height: itemHeight }}
            onClick={() => { onChange(item.value); scrollToIndex(idx); }}
          >
            {item.label}
          </div>
        ))}
        {/* Bottom padding */}
        <div style={{ height: halfVisible * itemHeight }} />
      </div>
    </div>
  );
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

interface WheelPickerProps {
  initialDate: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}

export function WheelDateTimePicker({ initialDate, onConfirm, onCancel }: WheelPickerProps) {
  const [year, setYear] = useState(initialDate.getUTCFullYear());
  const [month, setMonth] = useState(initialDate.getUTCMonth() + 1);
  const [day, setDay] = useState(initialDate.getUTCDate());
  const [hour, setHour] = useState(initialDate.getUTCHours());
  const [minute, setMinute] = useState(initialDate.getUTCMinutes());

  const years = useMemo(() => {
    const items = [];
    for (let y = 2017; y <= 2026; y++) items.push({ value: y, label: `${y}` });
    return items;
  }, []);

  const months = useMemo(() => {
    const items = [];
    for (let m = 1; m <= 12; m++) items.push({ value: m, label: `${m}月` });
    return items;
  }, []);

  const days = useMemo(() => {
    const max = getDaysInMonth(year, month);
    const items = [];
    for (let d = 1; d <= max; d++) items.push({ value: d, label: `${d}日` });
    return items;
  }, [year, month]);

  // Clamp day when month/year changes
  useEffect(() => {
    const max = getDaysInMonth(year, month);
    if (day > max) setDay(max);
  }, [year, month, day]);

  const hours = useMemo(() => {
    const items = [];
    for (let h = 0; h < 24; h++) items.push({ value: h, label: `${h.toString().padStart(2, '0')}` });
    return items;
  }, []);

  const minutes = useMemo(() => {
    const items = [];
    for (let m = 0; m < 60; m++) items.push({ value: m, label: `${m.toString().padStart(2, '0')}` });
    return items;
  }, []);

  const handleConfirm = () => {
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    onConfirm(date);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onCancel}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Drawer */}
      <div
        className="relative bg-card rounded-t-2xl border-t border-border animate-in slide-in-from-bottom duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium text-foreground">选择时间</span>
          <span className="text-[10px] text-muted-foreground">UTC 时区</span>
        </div>

        {/* Wheel area */}
        <div className="flex gap-0 px-2 py-2" style={{ height: 200 }}>
          <WheelColumn items={years} selected={year} onChange={setYear} />
          <WheelColumn items={months} selected={month} onChange={setMonth} />
          <WheelColumn items={days} selected={day} onChange={setDay} />
          <WheelColumn items={hours} selected={hour} onChange={setHour} />
          <WheelColumn items={minutes} selected={minute} onChange={setMinute} />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-secondary text-secondary-foreground active:opacity-70 transition-opacity"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-yellow-500 text-black active:opacity-70 transition-opacity"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
