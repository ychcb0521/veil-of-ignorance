import type { UsdtFollowCampaign } from './usdtFollow';
/** Keep checkpoint-heavy syncs below the server limit without truncating active campaigns. */
export function usdtFollowBatches(rows: UsdtFollowCampaign[], limit=6_000_000) {
  const batches: UsdtFollowCampaign[][] = [[]];
  let bytes=1024;
  for(const row of rows){
    const size=new TextEncoder().encode(JSON.stringify(row)).length+1;
    if(size+1024>limit)throw Error('单笔冻结监测状态超过同步大小限制，交接保持阻断，请先核对该战役状态');
    if(bytes+size>limit){batches.push([]);bytes=1024;}
    batches.at(-1)!.push(row);bytes+=size;
  }
  return batches;
}
