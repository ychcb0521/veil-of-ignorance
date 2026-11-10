import fishing from '../../docs/fishing-manual.md?raw';
import quality from '../../docs/fish-quality-manual.md?raw';
import notes from '../../docs/fishing-manual-notes.md?raw';

export { fishing, quality, notes };
export interface FishingGuideItem { id: string; label: string; children?: FishingGuideItem[] }
const anchors: Record<string, string> = {
  '3.3':'s3-fish', '3.3.1':'fish-overview', '3.3.2':'fish-catching',
  '3.3.2.1':'fish-catching-time', '3.3.2.2':'fish-algorithms',
  '3.3.2.5':'fish-auto', '3.3.2.6':'fish-email', '3.3.3':'fish-cabin',
  '3.3.4':'s3-fish-quality', '3.3.4.1':'fq-mining', '3.3.4.2':'fq-pre-entry',
  '3.3.4.2.1':'fq-static', '3.3.4.2.2':'fq-screening', '3.3.4.3':'fq-monitor',
  '3.3.4.3.2':'fq-monitor-conditions', '3.3.4.3.3':'fq-additions',
  '3.3.4.4':'fq-table', '3.3.4.4.3':'fq-rating', '3.3.4.4.4':'fq-export', '3.3.5':'fish-notes',
};
export function fishingChapter(label: string) {
  const number = label.match(/^(\d+(?:\.\d+)*)\s/)?.[1];
  return number ? { number, level:number.split('.').length+1,
    id:anchors[number]??'fish-'+number.replace(/\./g, '-') } : undefined;
}
/** Navigation and body read the same numbered headings. */
function outline(text:string):FishingGuideItem {
  const roots:FishingGuideItem[]=[], stack:{number:string;item:FishingGuideItem}[]=[];
  for(const match of text.matchAll(/^#{1,3} (.+)$/gm)){
    const label=match[1].trim(), chapter=fishingChapter(label);
    if(!chapter)continue;
    while(stack.length&&!chapter.number.startsWith(stack.at(-1)!.number+'.'))stack.pop();
    const item:FishingGuideItem={id:chapter.id,label},parent=stack.at(-1)?.item;
    if(parent)(parent.children??=[]).push(item);else roots.push(item);
    stack.push({number:chapter.number,item});
  }
  if(roots.length!==1)throw new Error('渔使用说明章节结构无效');
  return roots[0];
}
export const FISHING_GUIDE_TOC=outline([fishing,quality,notes].join('\n\n'));
