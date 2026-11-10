import {expect,it} from 'vitest';
import {ArrayLruCache} from '../arrayLruCache';
import {serializeArchiveWork} from '../serializeArchiveWork';
it('keeps a fixed total candle budget across thousands of windows without altering returned arrays',()=>{
 const cache=new ArrayLruCache<number>(1000,10),held=Array.from({length:100},(_,i)=>i);cache.set('held',held);
 for(let i=0;i<2000;i++){cache.set('window'+i,Array.from({length:150},(_,j)=>i+j));expect(cache.itemCount).toBeLessThanOrEqual(1000);expect(cache.size).toBeLessThanOrEqual(10);}
 expect(cache.get('held')).toBeUndefined();expect(held).toEqual(Array.from({length:100},(_,i)=>i));
 const large=Array.from({length:1200},(_,i)=>i);cache.set('large',large);expect(cache.get('large')).toBeUndefined();expect(large).toHaveLength(1200);
});
it('evicts the least recently used window and maintains accurate replacement weights',()=>{
 const cache=new ArrayLruCache<number>(4,2);cache.set('a',[1,2]);cache.set('b',[3,4]);expect(cache.get('a')).toEqual([1,2]);cache.set('c',[5,6]);expect(cache.get('b')).toBeUndefined();cache.set('a',[7]);expect(cache.itemCount).toBe(3);cache.clear();expect(cache.itemCount).toBe(0);
});
it('does not overlap screening persistence, holding persistence and cloud encoding, and recovers after failure',async()=>{
 let active=0,max=0;const events:string[]=[];
 const run=(name:string,fail=false)=>serializeArchiveWork(async()=>{active++;max=Math.max(max,active);events.push(name);await Promise.resolve();active--;if(fail)throw Error('disk');return name;});
 const values=await Promise.allSettled([run('screening'),run('holding',true),run('backup')]);expect(max).toBe(1);expect(events).toEqual(['screening','holding','backup']);expect(values.map(r=>r.status)).toEqual(['fulfilled','rejected','fulfilled']);
});
