// 【用户要求】2026-10-21「黑框提示一律都不要」
import {afterEach,expect,it} from 'vitest';
import {installNoNativeTooltips,stripNativeTooltip} from '@/lib/noNativeTooltips';
let stop=()=>{};
afterEach(()=>{stop();document.body.innerHTML='';});
it('拿掉 title：有文字的记成 aria-description，只有图标的记成 aria-label，已有 aria-label 的不覆盖',()=>{
 document.body.innerHTML='<button id="a" title="跳转到 X">X</button><button id="b" title="删除该信号"><svg></svg></button><button id="c" aria-label="更多" title="提示"><svg></svg></button><span id="d" title=" "></span>';
 document.querySelectorAll('[title]').forEach(stripNativeTooltip);
 const $=(id:string)=>document.getElementById(id)!;
 expect(document.querySelector('[title]')).toBeNull();
 expect($('a').getAttribute('aria-description')).toBe('跳转到 X');expect($('a').hasAttribute('aria-label')).toBe(false);
 expect($('b').getAttribute('aria-label')).toBe('删除该信号');
 expect($('c').getAttribute('aria-label')).toBe('更多');expect($('c').getAttribute('aria-description')).toBe('提示');
 expect($('d').attributes.length).toBe(1);
});
it('页面上已有的、之后新加的、后来改的 title 都拿掉',async()=>{
 document.body.innerHTML='<div title="原有"></div>';
 stop=installNoNativeTooltips(document);
 expect(document.querySelector('[title]')).toBeNull();
 const box=document.createElement('div');box.innerHTML='<p title="新加的">x</p>';document.body.appendChild(box);
 const p=document.createElement('span');document.body.appendChild(p);p.setAttribute('title','后改的');
 await new Promise(r=>setTimeout(r,0));
 expect(document.querySelector('[title]')).toBeNull();expect(p.getAttribute('aria-label')).toBe('后改的');
});
