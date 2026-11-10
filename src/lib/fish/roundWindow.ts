import type {TradeSignal} from '../signalLibrary';
import {fishDedupKey} from './records';

export interface FishRoundWindow {anchorMs?:number|null;lookbackHours?:number}
/** A historical catch remains an asset. Its old fresh flag is not proof that it
 * belongs to the currently displayed capture round. Never alter its snapshot. */
export function fishSignalInRoundWindow(signal:TradeSignal,window?:FishRoundWindow):boolean{
  if(window?.lookbackHours===undefined)return true;
  const {anchorMs,lookbackHours}=window;
  if(!Number.isFinite(anchorMs)||!(anchorMs!>0)||!Number.isFinite(lookbackHours)||lookbackHours<=0||lookbackHours>8784||!Number.isFinite(signal.timeMs)||signal.timeMs<=0)return false;
  if(signal.timeMs<anchorMs!-lookbackHours*3600000||signal.timeMs>anchorMs!)return false;
  const frozen=signal.fish?.lookbackAnchorMs,span=signal.fish?.lookbackHours,cut=signal.fish?.cutoffMs;
  return (frozen===undefined||frozen===anchorMs)&&(span===undefined||span===lookbackHours)&&(cut===undefined||Number.isFinite(cut)&&cut<=anchorMs!);
}
/** Membership comes from the active round's acknowledged writes, never from a
 * late cache/cloud flag. Keep foreign records in the cabin rather than delete. */
export function reconcileFreshFish(list:TradeSignal[],keys:ReadonlySet<string>|null,window?:FishRoundWindow):TradeSignal[]{
  let changed=false;
  const next=list.map(signal=>{
    if(!signal.freshCatch||(!keys||keys.has(fishDedupKey(signal)))&&fishSignalInRoundWindow(signal,window))return signal;
    changed=true;const {freshCatch:_fresh,...saved}=signal;return saved;
  });
  return changed?next:list;
}
