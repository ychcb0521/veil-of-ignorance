/** Chart viewports may prepend candles; that must not silently move a stateful feature's replay origin. */
export class Dbl5ChartTimeline {
  private key='';private anchor=0;private latest=-Infinity;private revision=0;
  private closed=new Map<number,string>();
  update(data:readonly {time:number;open:number;high:number;low:number;close:number;cba2Closed?:boolean;DBL5_prices?:unknown}[],key:string,now=Date.now()){
    const first=data[0]?.time,last=data.at(-1)?.time;
    if(first===undefined||last===undefined)return null;
    if(key!==this.key||last<this.anchor){this.key=key;this.anchor=first-24*3600000;this.revision=0;this.closed.clear();this.latest=-Infinity;}
    let revised=false;
    for(const b of data){if(b.cba2Closed===false||b.time+300000>now)continue;const text=JSON.stringify(b.DBL5_prices??[b.open,b.high,b.low,b.close]);const prior=this.closed.get(b.time);if(prior!==undefined&&prior!==text)revised=true;this.closed.set(b.time,text);}
    if(revised)this.revision++;this.latest=last;
    return {initializationStart:this.anchor,dataVersion:'ohlc-v1:revision-'+this.revision,revision:this.revision};
  }
}
