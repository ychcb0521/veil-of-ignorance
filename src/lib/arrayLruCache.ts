/** Public data cache only: eviction never truncates a caller's returned data. */
export class ArrayLruCache<T> {
  private values=new Map<string,T[]>();
  private items=0;
  constructor(readonly maxItems:number,readonly maxEntries=48){}
  get(key:string):T[]|undefined {
    const value=this.values.get(key);
    if(value){this.values.delete(key);this.values.set(key,value);}
    return value;
  }
  set(key:string,value:T[]):void {
    const old=this.values.get(key);if(old){this.items-=old.length;this.values.delete(key);}
    if(value.length>this.maxItems)return;
    this.values.set(key,value);this.items+=value.length;
    while(this.items>this.maxItems||this.values.size>this.maxEntries){const first=this.values.keys().next().value!;this.items-=this.values.get(first)!.length;this.values.delete(first);}
  }
  clear(){this.values.clear();this.items=0;}
  get itemCount(){return this.items;}
  get size(){return this.values.size;}
}
