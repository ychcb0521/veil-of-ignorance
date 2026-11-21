import { encodeFishRange, fishRangeFields, type CaptureDirection } from '@/lib/fish/thresholdRange';

interface Props {
  direction: CaptureDirection;
  value: string;
  label: (field: string) => string;
  scalarLabel?: string;
  unit?: string;
  onChange: (direction: CaptureDirection, value: string) => void;
}

export function FishThresholdFields({ direction, value, label, scalarLabel = '阈值', unit, onChange }: Props) {
  const range = fishRangeFields(value);
  const [min, max] = range ?? (direction === '>' ? [value, ''] : ['', value]);
  const changeRange = (lo: string, hi: string) => onChange(lo && !hi ? '>' : hi && !lo ? '<' : direction, encodeFishRange(lo, hi));
  const field = 'h-7 min-w-0 rounded bg-muted/60 px-1.5 text-[11px] focus-visible:outline-ring';
  return <span className="inline-flex flex-wrap items-center gap-1">
    <select className={field} aria-label={label('方向')} value={range ? 'range' : direction} onChange={e => {
      const mode = e.target.value;
      if (mode === 'range') changeRange(min, max);
      else onChange(mode as CaptureDirection, range ? (mode === '>' ? min : max) : value);
    }}>
      <option value=">">&gt;</option><option value="<">&lt;</option><option value="range">区间（含边界）</option>
    </select>
    {(['下限', '上限'] as const).map((name, index) => {
      const primary = !range && index === (direction === '>' ? 0 : 1);
      return <label key={name} className="inline-flex items-center gap-1 text-muted-foreground">{name}
        <input className={field + ' max-w-full font-mono text-foreground'} style={{width:Math.max(9,(index ? max : min).length+4)+'ch'}} aria-label={label(primary ? scalarLabel : name)}
          title={unit} type="number" step="any" placeholder="不限" value={index ? max : min}
          onChange={e => {
            if (primary) onChange(direction, e.target.value);
            else if (index) changeRange(min, e.target.value);
            else changeRange(e.target.value, max);
          }}/>
      </label>;
    })}
  </span>;
}
