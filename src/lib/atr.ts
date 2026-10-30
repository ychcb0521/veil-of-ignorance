export interface AtrBar { high:number;low:number;close:number }
export interface ChartAtrState {value:number;close:number}
/** The existing chart's true-range EMA, including its first-range seed. */
export function advanceChartAtr(previous:ChartAtrState|undefined,bar:AtrBar,period=14):ChartAtrState{
 const range=previous?Math.max(bar.high-bar.low,Math.abs(bar.high-previous.close),Math.abs(bar.low-previous.close)):bar.high-bar.low;
 const alpha=2/(period+1);return {value:previous?range*alpha+previous.value*(1-alpha):range,close:bar.close};
}
export function chartAtr(bars:readonly AtrBar[],period=14):number[]{
 const out:number[]=[];let previous:ChartAtrState|undefined;
 for(const bar of bars){previous=advanceChartAtr(previous,bar,period);out.push(previous.value);}return out;
}
