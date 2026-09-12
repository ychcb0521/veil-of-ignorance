import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/notificationCenter';
import {
  describeExportSelection,
  exportEmotionDiaryHistory,
  selectDiariesForExport,
  shiftDiaryDate,
  type EmotionDiaryExportFormat,
  type EmotionDiaryExportScope,
} from '@/lib/emotionDiaryHistoryExport';
import type { DecisionEmotionDiary } from '@/types/emotionDiary';

interface Props {
  diaries: DecisionEmotionDiary[];
  /** 当前选中的那一天（「当日」导出的就是它）。 */
  selectedDate: string;
  /** 今天（UTC+8 自然日）；日期选择器的上限。 */
  today: string;
}

const SCOPES: ReadonlyArray<[EmotionDiaryExportScope, string]> = [
  ['day', '当日'],
  ['range', '时间段'],
  ['all', '全部'],
];

const FORMATS: ReadonlyArray<[EmotionDiaryExportFormat, string, string]> = [
  ['txt', 'TXT', '逐日逐题的完整记录，给人读'],
  ['csv', 'CSV', '每个自然日一行，总分 + 逐题作答，可直接做统计'],
];

function chipClass(active: boolean): string {
  return `h-6 rounded border px-2 text-[10px] transition-colors ${
    active
      ? 'border-[#F0B90B]/40 bg-[#F0B90B]/10 text-[#D89B00]'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;
}

/**
 * 情绪日记的导出入口：当日一份、选定时间段、或全部。
 *
 * 单独成组件有两个理由：历史记录侧栏本身已经很挤；而且页面要登录才能进，
 * 拆出来才能在测试与本地预览里单独渲染这块。
 */
export function EmotionDiaryExportPanel({ diaries, selectedDate, today }: Props) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<EmotionDiaryExportScope>('day');
  const [format, setFormat] = useState<EmotionDiaryExportFormat>('txt');
  // 默认区间取最近 30 天：一眼能导出、又不至于把全部历史当成默认动作。
  const [from, setFrom] = useState(() => shiftDiaryDate(today, -29));
  const [to, setTo] = useState(today);

  const selection = useMemo(
    () => ({ scope, date: selectedDate, from, to }),
    [scope, selectedDate, from, to],
  );
  const picked = useMemo(
    () => selectDiariesForExport(diaries, selection),
    [diaries, selection],
  );

  const handleExport = () => {
    if (picked.length === 0) {
      toast.error('所选范围内没有情绪日记');
      return;
    }
    try {
      const { fileName, days } = exportEmotionDiaryHistory({
        diaries,
        selection,
        format,
        exportedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
      });
      toast.success(`已导出 ${days} 天情绪日记`, { description: fileName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        title="导出情绪日记：当日、选定时间段或全部"
        className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <Download className="h-3.5 w-3.5" />
        导出
      </Button>

      {open && (
        <div
          data-testid="emotion-diary-export-panel"
          className="mt-2 space-y-2 rounded border border-border bg-background/60 p-2"
        >
          <div className="flex flex-wrap items-center gap-1">
            {SCOPES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={chipClass(scope === value)}
              >
                {label}
              </button>
            ))}
          </div>

          {scope === 'range' && (
            <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
              <input
                type="date"
                aria-label="起始日期"
                max={today}
                value={from}
                onChange={event => setFrom(event.target.value)}
                className="h-6 rounded border border-border bg-background px-1 font-mono text-[10px] outline-none"
              />
              <span>至</span>
              <input
                type="date"
                aria-label="结束日期"
                max={today}
                value={to}
                onChange={event => setTo(event.target.value)}
                className="h-6 rounded border border-border bg-background px-1 font-mono text-[10px] outline-none"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            {FORMATS.map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                title={hint}
                aria-pressed={format === value}
                onClick={() => setFormat(value)}
                className={chipClass(format === value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div data-testid="emotion-diary-export-summary" className="text-[10px] text-muted-foreground">
            {describeExportSelection(selection, picked.length)}
            {' · '}
            {format === 'txt' ? '逐题完整记录' : '每日一行，含逐题作答'}
          </div>

          <Button
            type="button"
            disabled={picked.length === 0}
            onClick={handleExport}
            className="h-7 w-full bg-[#F0B90B] text-[11px] text-black hover:bg-[#F0B90B]/90"
          >
            {picked.length === 0 ? '所选范围内没有记录' : `导出 ${picked.length} 天`}
          </Button>
        </div>
      )}
    </div>
  );
}
