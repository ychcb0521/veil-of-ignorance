import {memo} from 'react';
import {FishingManualMarkdown} from './FishingManualMarkdown';
import {quality} from './fishingGuideOutline';
import research from '../../docs/fish-quality-research-reference.md?raw';

/** One maintained source for /guide and the in-panel help dialog. Research
 * proposals remain available, explicitly separated from current operations. */
export const FishQualityGuideContent=memo(function FishQualityGuideContent({guide=false}:{guide?:boolean}){
  return <div className={guide?'guide-stack fishing-manual min-w-0':'min-w-0 text-[15px] leading-8 sm:text-base'} data-testid="fish-quality-guide-content">
    <FishingManualMarkdown text={quality} guide={guide}/>
    <details className="mt-8 rounded-lg border border-border/60 px-4 py-3" data-testid="fish-quality-research-reference">
      <summary className="cursor-pointer font-medium">附录 A：历史研究设计参考（不是当前软件的自动功能清单）</summary>
      <div className={guide?'guide-stack mt-4':'mt-4'}><FishingManualMarkdown text={research} guide={guide} reference/></div>
    </details>
  </div>;
});
