import { X } from 'lucide-react';
import { SIMULATION_SPEED_OPTIONS } from '@/lib/simulationSpeeds';

interface Props {
  open: boolean;
  onClose: () => void;
  speed: number;
  onSetSpeed: (s: number) => void;
}

/**
 * 移动端全部倍速的弹层。
 *
 * 存在的理由：手机布局（<768px）只渲染 MobileChartView，它的紧凑栏放得下 4 个按钮，
 * 于是 900x 以上的档位在手机上根本够不着——而恰恰是「穿越长等待区」最需要它们。
 * 快捷 4 档留在栏内，其余走这里，样式沿用 MobileTimeframeSheet。
 */
export function MobileSpeedSheet({ open, onClose, speed, onSetSpeed }: Props) {
  if (!open) return null;

  const handleSelect = (s: number) => {
    onSetSpeed(s);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full rounded-t-2xl border-t border-border pb-8 animate-in slide-in-from-bottom duration-200"
        style={{ background: 'hsl(var(--card))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-sm font-bold text-foreground">播放倍速</span>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-2 grid grid-cols-4 gap-2">
          {SIMULATION_SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => handleSelect(s)}
              className={`py-2.5 rounded-lg text-xs font-mono border ${
                speed === s
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-secondary text-foreground'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        <p className="px-4 pt-1 text-[10px] leading-relaxed text-muted-foreground">
          1800x / 3600x 用于穿越无交易价值的等待区：1m 周期 3600 倍速每真实秒吃掉 60 根 K 线，
          数据补给按「余量秒数」自动跟上，但非当前图表的币种撮合会明显变粗。
        </p>
      </div>
    </div>
  );
}
