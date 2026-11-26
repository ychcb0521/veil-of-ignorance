import type {QualityMonitorTimeBasis} from '@/lib/fish/qualityAdmissionTime';

export function FishRunTimeChoices({onChoose,disabled=false}:{onChoose:(basis:QualityMonitorTimeBasis)=>void;disabled?:boolean}) {
  return <fieldset disabled={disabled} className="min-w-0 disabled:opacity-40">
      <button type="button" aria-label="基于信号时间" className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => onChoose('signal')}>
        <span className="block text-[11px] font-medium">基于信号时间</span>
        <span className="block text-[10px] text-muted-foreground">从组合表的原信号时点开始</span>
      </button>
      <button type="button" aria-label="基于筛选时间" className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => onChoose('screening')}>
        <span className="block text-[11px] font-medium">基于筛选时间</span>
        <span className="block text-[10px] text-muted-foreground">从动态筛选首次满足的时点开始，跳过无入选时点的记录</span>
      </button>
      <button type="button" aria-label="基于反事实时间" className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => onChoose('counterfactual')}>
        <span className="block text-[11px] font-medium">基于反事实时间</span>
        <span className="block text-[10px] text-muted-foreground">从平行宇宙信号首次满足的时点开始，跳过未生成信号的记录</span>
      </button>
  </fieldset>;
}
