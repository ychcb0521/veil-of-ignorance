import {formatUTC8} from './timeFormat';

export interface SettingsImageBlock {text:string; heading:boolean}
/** Read live form properties, not serialized attributes or clipped innerText. Closed details are included. */
export function readSettingsImage(root:HTMLElement):SettingsImageBlock[] {
  const blocks:SettingsImageBlock[] = [];
  const sharedHelp=new Set<string>();
  let text = '', heading = false;
  const flush = () => {
    const value = text.replace(/[ \t]+/g, ' ').trim();
    if (value) blocks.push({text:value, heading});
    text = ''; heading = false;
  };
  const walk = (node:Node) => {
    if (node.nodeType === Node.TEXT_NODE) { text += node.textContent ?? ''; return; }
    if (!(node instanceof HTMLElement)) return;
    if (node.hasAttribute('data-settings-image-skip') || ['SCRIPT','STYLE','OPTION'].includes(node.tagName)) return;
    if (node.hidden && !node.hasAttribute('data-settings-image-include')) return;
    if(node.hasAttribute('data-settings-image-shared-help')&&!node.querySelector('input,select,textarea')){
      const key=node.textContent??'';
      if(sharedHelp.has(key))return;
      sharedHelp.add(key);
    }
    if (node.tagName === 'PRE') { flush(); blocks.push({text:node.textContent??'',heading:false}); return; }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      if (node instanceof HTMLInputElement && node.type === 'hidden') return;
      const label = node.getAttribute('aria-label');
      const value = node instanceof HTMLSelectElement ? Array.from(node.selectedOptions).map(o=>o.textContent).join('、')
        : node instanceof HTMLInputElement && ['checkbox','radio'].includes(node.type) ? (node.checked ? '☑ 已勾选' : '☐ 未勾选') : node.value || '（空）';
      if (node instanceof HTMLTextAreaElement) {flush();blocks.push({text:(label?label+'：\n':'')+value,heading:false});return;}
      text += ` ${label ? label + '：' : ''}${value} `;
      return;
    }
    if (node.tagName === 'BUTTON') {
      if (node.getAttribute('aria-pressed') === 'true' || node.getAttribute('role') === 'tab' && node.getAttribute('aria-selected') === 'true') text += ` ${node.textContent} `;
      return;
    }
    if (node.tagName === 'BR') { flush(); return; }
    const block = /^(DIV|P|SECTION|HEADER|FOOTER|DETAILS|SUMMARY|H[1-6]|PRE|LI|TR|LABEL)$/.test(node.tagName);
    if (block) flush();
    if (/^(H[1-6]|SUMMARY)$/.test(node.tagName)) heading = true;
    for (const child of node.childNodes) walk(child);
    if (['TD','TH'].includes(node.tagName)) text += ' | ';
    if (block) flush();
  };
  walk(root); flush();
  if (!blocks.length) throw Error('没有可生成的完整信息，请待设置加载后重试');
  return blocks;
}

const WIDTH = 1440, MARGIN = 40, MAX_SIDE = 30000, MAX_AREA = 48_000_000, MIN_SCALE = .75;
/** Prefer one readable long image; split only at the bounded backing-store limit. */
export function settingsImageLayout(rows:number,header:number) {
  // Even the longest single image keeps body text at least 12 physical pixels high.
  const rowHeight=22,maxHeight=Math.min(MAX_SIDE/MIN_SCALE,MAX_AREA/(WIDTH*MIN_SCALE**2));
  const perPage=Math.max(1,Math.floor((maxHeight-header-40)/rowHeight));
  const pages=Math.ceil(rows/perPage),height=header+30+Math.min(rows,perPage)*rowHeight;
  const scale=Math.min(1.5,MAX_SIDE/height,MAX_SIDE/WIDTH,Math.sqrt(MAX_AREA/(WIDTH*height)));
  return {rowHeight,perPage,pages,scale};
}
const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
export function wrapSettingsImageText(ctx:CanvasRenderingContext2D, text:string, width:number):string[] {
  const lines:string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const character of paragraph) {
      if (line && ctx.measureText(line + character).width > width) { lines.push(line); line = ''; }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

/** Native canvas + PNG Blob, as in campaign image export. Content remains complete. */
export async function downloadSettingsImage(title:string, blocks:readonly SettingsImageBlock[]):Promise<number> {
  await document.fonts?.ready;
  const measure = document.createElement('canvas'), ctx = measure.getContext('2d');
  if (!ctx) throw Error('无法创建图片画布');
  const rows:{text:string; heading:boolean}[] = [];
  for (const block of blocks) {
    ctx.font = `${block.heading ? '600' : '400'} ${block.heading ? 18 : 16}px ${FONT}`;
    rows.push(...wrapSettingsImageText(ctx, block.text, WIDTH - MARGIN * 2 - 24).map(text=>({text, heading:block.heading})));
  }
  ctx.font = `600 24px ${FONT}`;
  const titles=wrapSettingsImageText(ctx,title,WIDTH-MARGIN*2), header=130+(titles.length-1)*32;
  const {rowHeight,perPage,pages,scale}=settingsImageLayout(rows.length,header);
  const time = formatUTC8(Date.now()), filename = `${title.replace(/[<>:"/\\|?*]/g,'-').replace(/\p{Cc}/gu,'-').slice(0,100)}-${time.replace(/[<>:"/\\|?*\s]/g,'-')}`;
  const files:{name:string;blob:Blob}[]=[];
  try {
    for (let page = 0; page < pages; page++) {
      const slice = rows.slice(page * perPage, (page + 1) * perPage);
      const height = header + 30 + slice.length * rowHeight, canvas = document.createElement('canvas');
      // Keep each backing store bounded; release it before creating the next image.
      canvas.width = Math.floor(WIDTH * scale); canvas.height = Math.floor(height * scale);
      try {
        const paint = canvas.getContext('2d');
        if (!paint) throw Error('无法创建图片画布');
        paint.scale(scale,scale); paint.fillStyle = '#f8fafc'; paint.fillRect(0,0,WIDTH,height);
        paint.fillStyle = '#111827'; paint.font = `600 24px ${FONT}`;
        titles.forEach((line,index)=>paint.fillText(line,MARGIN,42+index*32));
        paint.font = `14px ${FONT}`; paint.fillStyle = '#64748b';
        paint.fillText(`无知之幕 · ${time}（北京时间） · ${page+1}/${pages}`, MARGIN, header-60);
        paint.fillText('当前界面完整信息 · 含未保存设置 · ☑ 已勾选 / ☐ 未勾选', MARGIN, header-36);
        slice.forEach((row,index)=>{
          const y = header + index * rowHeight;
          if (row.heading) { paint.fillStyle = '#e9edf2'; paint.fillRect(MARGIN,y-20,WIDTH-MARGIN*2,rowHeight); }
          paint.fillStyle = row.heading ? '#111827' : '#334155';
          paint.font = `${row.heading ? '600' : '400'} ${row.heading ? 18 : 16}px ${FONT}`;
          paint.fillText(row.text,MARGIN+12,y);
        });
        const blob = await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG 生成失败，请重试')),'image/png'));
        files.push({name:filename + (pages>1?`-${page+1}共${pages}张`:'') + '.png',blob});
      } finally { canvas.width = 0; canvas.height = 0; }
      await new Promise<void>(resolve=>window.setTimeout(resolve,0));
    }
    const blob=pages===1?files[0].blob:await (await import('./campaignPngZip')).buildCampaignPngZip(files);
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    try {link.href=url;link.download=pages===1?files[0].name:filename+'.zip';document.body.appendChild(link);link.click();}
    finally {link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
  } finally { measure.width = 0; measure.height = 0; files.length=0; }
  return pages;
}
