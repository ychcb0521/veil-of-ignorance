import manual from '../../docs/deep-dig-manual.md?raw';

const anchors:Record<string,string>={
  '4.8':'s4-deep-dig','4.8.1':'deep-dig-start','4.8.2':'deep-dig-cda','4.8.3':'deep-dig-state',
  '4.8.4':'deep-dig-dbl5','4.8.4.1':'deep-dig-guard','4.8.5':'deep-dig-others','4.8.6':'deep-dig-save',
};
export function deepDigChapter(label:string){
  const number=label.match(/^(\d+(?:\.\d+)*)\s/)?.[1];
  return number&&anchors[number]?{number,id:anchors[number],level:number.split('.').length+1}:undefined;
}
export interface DeepDigGuideNode {id:string;label:string;number:string;text:string;children:DeepDigGuideNode[]}
const roots:DeepDigGuideNode[]=[],stack:DeepDigGuideNode[]=[];
for(const part of manual.split(/(?=^#{1,3} \d)/m)){
  const label=part.match(/^#{1,3} (.+)/)?.[1]?.trim(),chapter=label?deepDigChapter(label):undefined;
  if(!chapter)continue;
  while(stack.length&&!chapter.number.startsWith(stack.at(-1)!.number+'.'))stack.pop();
  const node={...chapter,label,text:part.trim(),children:[]} as DeepDigGuideNode;
  if(stack.length)stack.at(-1)!.children.push(node);else roots.push(node);
  stack.push(node);
}
if(roots.length!==1)throw Error('Deep Dig 使用说明章节结构无效');
export const DEEP_DIG_GUIDE=roots[0];
interface GuideTocItem {id:string;label:string;children?:GuideTocItem[]}
function toc(node:DeepDigGuideNode):GuideTocItem {
  return {id:node.id,label:node.label,...(node.children.length?{children:node.children.map(toc)}:{})};
}
export const DEEP_DIG_GUIDE_TOC=toc(DEEP_DIG_GUIDE);
