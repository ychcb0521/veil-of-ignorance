import { DBL5_GUARD_VERSION, DBL5_RETEST_GUARD_VERSION, type Dbl5GuardVersion } from '@/lib/dbl5m';
import { boxAlgorithmVersion } from '@/lib/fish/boxAlgorithmVersions';

export function Dbl5GuardVersionSelect({value,onChange,label='防守线版本',disabled}:{
  value:string; onChange:(version:Dbl5GuardVersion)=>void; label?:string; disabled?:boolean;
}) {
  return <label className="inline-flex min-w-0 flex-wrap items-center gap-1 text-[11px]">
    <span>防守线版本</span>
    <select aria-label={label} className="h-7 max-w-full rounded bg-muted/50 px-2 text-[11px]"
      value={value} disabled={disabled} onChange={e=>onChange(e.target.value as Dbl5GuardVersion)}>
      {[DBL5_GUARD_VERSION,DBL5_RETEST_GUARD_VERSION].map(id=><option key={id} value={id}>{boxAlgorithmVersion(id)!.label}</option>)}
    </select>
  </label>;
}
