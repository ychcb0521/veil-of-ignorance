import { expect, it, vi } from 'vitest';
import { cacheChartDateFormatter } from '../chartDateCache';
it('reuses date text while keeping timestamp, format and timezone distinct',()=>{
 const delegate=vi.fn((f:{zone:string},t:number,p:string)=>`${f.zone}:${t}:${p}`),format=cacheChartDateFormatter(delegate),a={zone:'UTC'},b={zone:'Asia/Shanghai'};
 expect(format(a,1000,'HH:mm')).toBe('UTC:1000:HH:mm');format(a,1000,'HH:mm');expect(delegate).toHaveBeenCalledTimes(1);
 expect(format(a,2000,'HH:mm')).toBe('UTC:2000:HH:mm');expect(format(a,1000,'YYYY')).toBe('UTC:1000:YYYY');expect(format(b,1000,'HH:mm')).toBe('Asia/Shanghai:1000:HH:mm');expect(delegate).toHaveBeenCalledTimes(4);
});
