import {memo} from 'react';
import {CDA_DEF,STATE_DEF,DBL5_DEF,dbl5VariantDefinition} from '@/lib/deepDig/features';
import {FishingManualMarkdown} from './FishingManualMarkdown';
import {DEEP_DIG_GUIDE,deepDigChapter,type DeepDigGuideNode} from './deepDigGuideOutline';

const formulas={CDA_FORMULA:CDA_DEF,STATE_FORMULA:STATE_DEF,DBL5_FORMULA:DBL5_DEF};
const hourlyDbl5=dbl5VariantDefinition('1h');
const noTopicAnchor=()=>undefined;
function Chapter({node}:{node:DeepDigGuideNode}){
  return <section id={node.id} className="scroll-mt-24">
    {node.text.split(/(\[\[(?:CDA|STATE|DBL5)_FORMULA\]\])/g).map((part,index)=>{
      const key=part.match(/^\[\[(.+)\]\]$/)?.[1] as keyof typeof formulas|undefined;
      if(key&&formulas[key])return <details key={key} className="my-5 rounded-lg border border-border/60 p-3" data-guide-formula={key}>
        <summary className="cursor-pointer font-medium">默认完整公式 · {key==='STATE_FORMULA'?'状态 S':key==='DBL5_FORMULA'?DBL5_DEF.short:'CDA'}</summary>
        <p className="guide-copy">当前内置原版的只读参考；账号自定义公式和历史模板仍按各自保存的原文执行。</p>
        <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs leading-6">{formulas[key].formula}</pre>
        {key==='DBL5_FORMULA'&&<details className="mt-3"><summary className="cursor-pointer">{hourlyDbl5.short} · 1 小时已收盘 K 线</summary>
          <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs leading-6">{hourlyDbl5.formula}</pre>
        </details>}
      </details>;
      return part.trim()?<FishingManualMarkdown key={index} text={part} guide chapterOf={deepDigChapter} topicAnchorOf={noTopicAnchor} headingIds={false}/>:null;
    })}
    {node.children.map(child=><Chapter key={child.id} node={child}/>)}
  </section>;
}
export const DeepDigGuideContent=memo(function DeepDigGuideContent(){
  return <div className="deep-dig-manual min-w-0" data-testid="deep-dig-guide-content"><Chapter node={DEEP_DIG_GUIDE}/></div>;
});
