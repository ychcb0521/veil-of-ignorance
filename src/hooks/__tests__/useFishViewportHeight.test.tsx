import {act,renderHook} from '@testing-library/react';import {afterEach,expect,it,vi} from 'vitest';import {useFishViewportHeight} from '../useFishViewportHeight';
afterEach(()=>vi.restoreAllMocks());
it('fills only the viewport below the existing controls and releases it when collapsed',()=>{
 const parent=document.createElement('div'),node=document.createElement('div');parent.style.paddingBottom='12px';parent.append(node);document.body.append(parent);vi.spyOn(node,'getBoundingClientRect').mockReturnValue({top:180} as DOMRect);vi.stubGlobal('innerHeight',900);
 const ref={current:node},h=renderHook(({open})=>useFishViewportHeight(open,ref),{initialProps:{open:true}});expect(h.result.current).toBe(708);
 act(()=>{vi.stubGlobal('innerHeight',1000);window.dispatchEvent(new Event('resize'));});expect(h.result.current).toBe(808);h.rerender({open:false});expect(h.result.current).toBeUndefined();h.unmount();parent.remove();vi.unstubAllGlobals();
});
