import {describe,it,expect} from 'vitest';
import {readSettingsImage,wrapSettingsImageText,settingsImageLayout} from '../settingsImageExport';

describe('complete settings image snapshot',()=>{
  it('reads live unsaved controls, full multiline text, closed details and explicit hidden projections',()=>{
    const root=document.createElement('div');
    root.innerHTML='<h3>完整设置</h3><details><summary>折叠参数</summary><input aria-label="精确门槛" value="1"><textarea aria-label="公式"></textarea><select aria-label="口径"><option>旧值</option><option>完整的新值</option></select><input aria-label="已开" type="checkbox"><input aria-label="已关" type="checkbox"></details><div hidden>无关隐藏</div><div hidden data-settings-image-include>第二轮全部参数</div><div data-settings-image-skip>不导出分组</div><button>保存</button>';
    root.querySelector('input')!.value='0.12345678901234567';
    root.querySelector('textarea')!.value='first = B\nraw = first / Q';
    root.querySelector('select')!.selectedIndex=1;
    (root.querySelector('[aria-label="已开"]') as HTMLInputElement).checked=true;
    const text=readSettingsImage(root).map(b=>b.text).join('\n');
    expect(text).toContain('0.12345678901234567');expect(text).toContain('first = B\nraw = first / Q');expect(text).toContain('完整的新值');expect(text).toContain('已开：☑ 已勾选');expect(text).toContain('已关：☐ 未勾选');expect(text).toContain('第二轮全部参数');
    expect(text).not.toMatch(/无关隐藏|不导出分组|保存|旧值/);expect(root.querySelector('details')!.open).toBe(false);
  });
  it('wraps long Chinese/Latin formulas without rounding, omission or character loss',()=>{
    const ctx={measureText:(text:string)=>({width:Array.from(text).length*10})} as CanvasRenderingContext2D;
    const text='公式raw = aVeryLongName / 0.12345678901234567 + 中文参数😀';
    const lines=wrapSettingsImageText(ctx,text,70);
    expect(lines.join('')).toBe(text);expect(lines.every(line=>Array.from(line).length<=7)).toBe(true);
  });
  it('includes selected segmented parameters but excludes action buttons',()=>{
    const root=document.createElement('div');root.innerHTML='<button aria-pressed="false">1m</button><button aria-pressed="true">5m</button><button role="tab" aria-selected="true">第 3 次</button><button>删除</button>';
    expect(readSettingsImage(root).map(b=>b.text).join('')).toBe('5m 第 3 次');
  });
  it('shares identical explanatory notes once and retains every repeated control and changed note',()=>{
    const root=document.createElement('div');root.innerHTML='<h3>第一轮</h3><div data-settings-image-shared-help>相同完整说明</div><input aria-label="本轮门槛" value="0.123456789"><h3>第二轮</h3><div data-settings-image-shared-help>相同完整说明</div><input aria-label="本轮门槛" value="0.123456789"><div data-settings-image-shared-help>本轮不同说明</div><div data-settings-image-shared-help><input aria-label="独立启用" type="checkbox"></div><div data-settings-image-shared-help><input aria-label="独立启用" type="checkbox"></div>';
    const text=readSettingsImage(root).map(b=>b.text).join('\n');
    expect(text.match(/相同完整说明/g)).toHaveLength(1);expect(text.match(/本轮门槛：0.123456789/g)).toHaveLength(2);expect(text.match(/独立启用/g)).toHaveLength(2);expect(text).toContain('本轮不同说明');
  });
  it('keeps a long set of conditions in one readable image and bounds extreme exports without losing rows',()=>{
    const single=settingsImageLayout(1200,130);expect(single.pages).toBe(1);expect(single.scale).toBeGreaterThanOrEqual(1);
    const huge=settingsImageLayout(10000,130);expect(huge.pages).toBeGreaterThan(1);expect(huge.perPage*huge.pages).toBeGreaterThanOrEqual(10000);
    for(const layout of [single,huge]){
      const height=160+(layout===single?1200:layout.perPage)*layout.rowHeight;
      const widthPixels=Math.floor(1440*layout.scale),heightPixels=Math.floor(height*layout.scale);
      expect(heightPixels).toBeLessThanOrEqual(30000);expect(widthPixels*heightPixels).toBeLessThanOrEqual(48_000_000);
    }
  });
});
