import { DBL5_PROFILES } from '@/lib/dbl5m';
import { structureDbl5Timeframe } from '@/lib/fish/boxAlgorithmVersions';
import { QUALITY_ADVANTAGE_EXPLANATION, type QualityAdvantageOptions, type QualityAdvantageRule } from '@/lib/fish/qualityAdvantage';

export function FishQualityAdvantageSettings({ rule, selection, onChange }: { rule: QualityAdvantageRule; selection?:'5m'|'1h'; onChange?: (options: QualityAdvantageOptions) => void }) {
  const patch = (value: Partial<QualityAdvantageOptions>) => onChange?.({ screenWeak: rule.screenWeak, beforeFirst: rule.beforeFirst,
    afterAddition: rule.afterAddition, confirmations: rule.confirmations, structureTimeframe:selection, ...value });
  return <section className="space-y-2 rounded border border-primary/25 bg-primary/5 p-2 text-[11px]" data-testid="quality-advantage-settings">
    <p className="font-medium">优势筛选与退出灵敏度 · 研究候选</p>
    <p>放大公式 Q×(K−S)+P＝新增币数×(T−K) 与原方案全部定量参数保持不变。</p>
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <label>辅助箱体 <select aria-label="优势分级箱体算法" value={selection??structureDbl5Timeframe(rule.structure)} disabled={!onChange||!!rule.structure.guardPlusVersion}
        onChange={e=>patch({structureTimeframe:e.target.value==='1h'?'1h':'5m'})} className="rounded border bg-background px-1">
        <option value="5m">{DBL5_PROFILES['5m'].label}</option><option value="1h">{DBL5_PROFILES['1h'].label}</option>
      </select></label>
      {([['screenWeak', '筛掉同步走弱的加仓机会'], ['beforeFirst', '首次加仓前软退出确认'], ['afterAddition', '加仓后优势延续时软退出确认']] as const).map(([key, label]) =>
        <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={rule[key]} disabled={!onChange} onChange={e => patch({ [key]: e.target.checked })}/>{label}</label>)}
      <label>优势状态下的确认次数 <select aria-label="优势状态软退出确认次数" value={rule.confirmations} disabled={!onChange} onChange={e => patch({ confirmations: Number(e.target.value) as 1 | 2 })} className="rounded border bg-background px-1">
        <option value={1}>1 根 1 分钟</option><option value={2}>2 根 1 分钟</option>
      </select></label>
    </div>
    <details><summary className="cursor-pointer text-primary">何时调整、规则与依据</summary><div className="mt-2 space-y-2 text-muted-foreground">{QUALITY_ADVANTAGE_EXPLANATION.map(p => <p key={p}>{p}</p>)}</div></details>
  </section>;
}
