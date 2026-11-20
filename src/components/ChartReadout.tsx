import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { utils, type Chart, type IndicatorCreateTooltipDataSourceParams, type KLineData, type TooltipLegend } from 'klinecharts';
import { IMPULSE_1115_CLASS_COLORS } from '@/lib/impulse1115ClassificationDisplay';
import './ChartReadout.css';

type Quote = Pick<KLineData, 'timestamp' | 'open' | 'high' | 'low' | 'close' | 'volume'> & { previousClose?: number };
type IndicatorRow = { name: string; params: string; values: string[]; classified: boolean };

export interface ChartReadoutHandle {
  quote: (bar: KLineData, previousClose?: number) => void;
  indicator: (id: string, row: IndicatorRow) => void;
  remove: (id: string) => void;
}

// KLineCharts supplies the actual crosshair, committed series and axes here.
// Keep each indicator's own formatter (including its closed-bar rules).
export function routeOverlayReadout(chart: Chart, name: string, id: string, classified: boolean,
  getReadout: () => ChartReadoutHandle | null) {
  const instance = chart.getIndicatorByPaneId?.('candle_pane', name);
  if (!instance || instance instanceof Map) return;
  const format = instance.createTooltipDataSource;
  const empty = { name: '', calcParamsText: '', values: [], icons: [] };
  chart.overrideIndicator({ name, createTooltipDataSource(params: IndicatorCreateTooltipDataSourceParams) {
    const readout = getReadout();
    if (readout) {
      const { indicator, crosshair } = params;
      const custom = format?.(params);
      const data = indicator.result[crosshair.dataIndex ?? indicator.result.length - 1];
      const values = custom?.values ?? indicator.figures.filter(figure => figure.title).map(figure => {
        const value = data?.[figure.key];
        return { title: figure.title!, value: value == null ? '—' : typeof value === 'number'
          ? formatNumber(value, indicator.precision, indicator.shouldFormatBigNumber) : String(value) };
      });
      const text = (entry: TooltipLegend['value']) => typeof entry === 'object' ? entry.text : entry;
      readout.indicator(id, {
        name: custom?.name ?? indicator.shortName,
        params: custom?.calcParamsText ?? (indicator.calcParams.length ? '(' + indicator.calcParams.join(', ') + ')' : ''),
        values: values.map(item => text(item.title) + text(item.value)), classified,
      });
    }
    return empty;
  } }, 'candle_pane');
}

function formatNumber(value: number, precision: number, compact: boolean) {
  const formatted = utils.formatPrecision(value, precision);
  return compact ? utils.formatBigNumber(formatted) : formatted;
}

interface Props {
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  hasData: boolean;
  precision: number;
  timezone: string;
  transform?: ((ts: number) => number) | null;
}

export const ChartReadout = forwardRef<ChartReadoutHandle, Props>(function ChartReadout(
  { children, expanded, onToggle, hasData, precision, timezone, transform }, ref,
) {
  const panelId = useId();
  const [quote, setQuote] = useState<Quote>();
  const [rows, setRows] = useState<Record<string, IndicatorRow>>({});
  const last = useRef<Quote>();
  const signatures = useRef(new Map<string, string>());
  useImperativeHandle(ref, () => ({
    quote(bar, previousClose) {
      const old = last.current;
      if (old && old.timestamp === bar.timestamp && old.open === bar.open && old.high === bar.high &&
        old.low === bar.low && old.close === bar.close && old.volume === bar.volume && old.previousClose === previousClose) return;
      const { timestamp, open, high, low, close, volume } = bar;
      last.current = { timestamp, open, high, low, close, volume, previousClose };
      setQuote(last.current);
    },
    indicator(id, row) {
      const signature = JSON.stringify(row);
      if (signatures.current.get(id) === signature) return;
      signatures.current.set(id, signature);
      setRows(previous => ({ ...previous, [id]: row }));
    },
    remove(id) {
      if (!signatures.current.delete(id)) return;
      setRows(previous => { const next = { ...previous }; delete next[id]; return next; });
    },
  }), []);

  const clock = useMemo(() => new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }), [timezone]);
  const bar = hasData ? quote : undefined;
  const time = bar ? clock.format(transform ? transform(bar.timestamp) : bar.timestamp) : '—';
  const price = (value?: number) => value?.toFixed(precision) ?? '—';
  const change = bar?.previousClose != null && bar.previousClose > 0 ? 100 * (bar.close - bar.previousClose) / bar.previousClose : null;
  const delta = change == null ? '—' : (change > 0 ? '+' : '') + change.toFixed(2) + '%';
  const quoteFields = [['开', price(bar?.open)], ['高', price(bar?.high)], ['低', price(bar?.low)], ['收', price(bar?.close)]];
  const field = ([key, value]: string[]) => <span className="chart-quote-field" key={key} data-field={key}><span>{key}</span><b>{value}</b></span>;

  return <div className="chart-readout flex min-h-[30px] max-h-[50%] shrink-0 flex-col border-b border-border/70 bg-card">
    <div className="flex min-w-0 shrink-0 items-center justify-between gap-1 px-2">
      <button type="button" className="chart-quote-button" aria-label="行情与指标读数" aria-expanded={expanded}
        aria-controls={panelId} onClick={onToggle} title={expanded ? '收起读数' : '展开行情与指标读数'}>
        <span className="chart-quote-line">
          <ChevronDown aria-hidden className={expanded ? 'rotate-180' : ''} />
          <time className="chart-quote-time">{bar ? time.slice(5) : '—'}</time>
          {quoteFields.map(field)}
          <b className={change == null || change === 0 ? 'text-muted-foreground' : change > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{delta}</b>
        </span>
      </button>
      {children}
    </div>
    {expanded && <div id={panelId} role="region" aria-label="行情与指标读数" className="chart-readout-detail">
      <div className="chart-readout-row"><time>{time}</time>{quoteFields.map(field)}{field(['涨跌幅', delta])}
        {field(['量', bar?.volume?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'])}</div>
      {hasData && Object.entries(rows).map(([id, row]) => <div className="chart-readout-row" key={id}>
        <strong>{row.name}</strong><span>{row.params}</span>
        {row.classified && ([1, 2] as const).map(n => <span className="inline-flex items-center gap-1" key={n}>
          <i className="h-0.5 w-3" style={{ backgroundColor: IMPULSE_1115_CLASS_COLORS[n] }} />{n === 1 ? '一类' : '二类'}</span>)}
        {row.values.map((value, index) => <span key={index}>{value}</span>)}
      </div>)}
    </div>}
  </div>;
});
