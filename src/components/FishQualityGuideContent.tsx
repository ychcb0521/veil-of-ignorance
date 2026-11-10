import {memo} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import manual from '../../docs/fish-quality-manual.md?raw';
import research from '../../docs/fish-quality-research-reference.md?raw';

const anchors:Record<string,string>={
  '一、目的与模块分工':'fq-purpose',
  '二、第一次使用的完整流程':'fq-workflow',
  '三、时间和来源：先看实际入场时点':'fq-time',
  '四、批量挖掘：建立样本':'fq-mining',
  '五、静态过滤：核对原时点':'fq-static',
  '六、动态筛选：寻找首次准入':'fq-screening',
  '七、持仓监测：模拟持有与退出':'fq-monitor',
  '八、组合表、评分与导出':'fq-table',
  '九、方案、模板与结果保存':'fq-save',
  '十、使用边界与常见问题':'fq-notes',
};

/** One maintained source for /guide and the in-panel help dialog. Research
 * proposals remain available, explicitly separated from current operations. */
export const FishQualityGuideContent=memo(function FishQualityGuideContent({guide=false}:{guide?:boolean}){
  const render=(text:string,isReference=false)=><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    h1:({children})=>guide&&!isReference?null:<h3 className="mb-5 mt-2 text-xl font-semibold leading-9">{children}</h3>,
    h2:({children})=><h3 id={guide&&!isReference?anchors[String(children)]:undefined} className={guide?'guide-subtitle scroll-mt-24':'mb-3 mt-9 scroll-mt-24 border-b border-border/50 pb-2 text-lg font-semibold leading-8'}>{children}</h3>,
    h3:({children})=><h4 className="mb-2 mt-6 text-base font-semibold leading-8">{children}</h4>,
    p:({children})=><p className={guide?'guide-copy':'my-3 leading-8'}>{children}</p>,
    ul:({children})=><ul className="my-4 list-disc space-y-2 pl-6">{children}</ul>,
    ol:({children,...props})=><ol {...props} className="my-4 list-decimal space-y-3 pl-6">{children}</ol>,
    li:({children})=><li className="pl-1 leading-8 marker:text-muted-foreground">{children}</li>,
    table:({children})=><div className="my-5 max-w-full overflow-x-auto rounded-lg border border-border/60"><table className="w-full min-w-[500px] border-collapse text-left text-sm leading-7">{children}</table></div>,
    th:({children})=><th className="border-b border-border/60 bg-muted/40 px-3 py-2 align-top font-medium">{children}</th>,
    td:({children})=><td className="border-b border-border/40 px-3 py-2 align-top">{children}</td>,
  }}>{text}</ReactMarkdown>;
  return <div className={`${guide?'guide-stack ':''}min-w-0 text-[15px] leading-8 sm:text-base`} data-testid="fish-quality-guide-content">
    {render(manual)}
    <details className="mt-8 rounded-lg border border-border/60 px-4 py-3" data-testid="fish-quality-research-reference">
      <summary className="cursor-pointer font-medium">历史研究设计参考（不是当前软件的自动功能清单）</summary>
      <div className={guide?'guide-stack mt-4':'mt-4'}>{render(research,true)}</div>
    </details>
  </div>;
});
