import {createElement,type ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {fishingChapter} from './fishingGuideOutline';

export function FishingManualMarkdown({text,guide=false,skipTitle=false,reference=false}:{text:string;guide?:boolean;skipTitle?:boolean;reference?:boolean}){
  const heading=(children:ReactNode,sourceLevel:number)=>{
    if(reference)return <p className="mb-2 mt-6 leading-8"><strong>{children}</strong></p>;
    const chapter=reference?undefined:fishingChapter(String(children));
    if(skipTitle&&chapter?.number==='3.3')return null;
    const level=chapter?(guide?chapter.level:chapter.level-2):Math.min(6,sourceLevel+2);
    return createElement('h'+Math.max(2,Math.min(6,level)),{
      id:guide?chapter?.id:undefined,'data-manual-anchor':chapter?.id,
      className:guide?'fishing-manual-heading':'mb-3 mt-8 scroll-mt-24 font-semibold leading-8 '+(sourceLevel===1?'text-xl':sourceLevel===2?'text-lg':'text-base'),
    },children);
  };
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    h1:({children})=>heading(children,1),h2:({children})=>heading(children,2),h3:({children})=>heading(children,3),
    p:({children})=><p className={guide?'guide-copy':'my-3 leading-8'}>{children}</p>,
    ul:({children})=><ul className="my-4 list-disc space-y-2 pl-6">{children}</ul>,
    ol:({children,...props})=><ol {...props} className="my-4 list-decimal space-y-3 pl-6">{children}</ol>,
    li:({children})=><li className="pl-1 leading-8 marker:text-muted-foreground">{children}</li>,
    table:({children})=><div className="my-5 max-w-full overflow-x-auto rounded-lg border border-border/60"><table className="w-full min-w-[500px] border-collapse text-left text-sm leading-7">{children}</table></div>,
    th:({children})=><th className="border-b border-border/60 bg-muted/40 px-3 py-2 align-top font-medium">{children}</th>,
    td:({children})=><td className="border-b border-border/40 px-3 py-2 align-top">{children}</td>,
  }}>{text}</ReactMarkdown>;
}
