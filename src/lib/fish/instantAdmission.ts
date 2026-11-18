import { instantPositionInput } from './instantCampaign';
import { readOpenInstantPositions, readPendingInstantCampaignJobs, saveInstantPosition } from './instantCampaignStore';
import type { PreEntryRecord, PreEntryRound } from './preEntryMonitor';

const liveChecks = new Map<string, (symbol: string) => boolean>();
export function registerInstantHoldingCheck(owner: string, check: (symbol: string) => boolean) {
  liveChecks.set(owner, check);
  return () => { if (liveChecks.get(owner) === check) liveChecks.delete(owner); };
}
export async function reserveInstantAdmission(owner: string, record: PreEntryRecord, round: PreEntryRound) {
  const input = instantPositionInput(record, round);
  if (!input) throw Error('即时交易入场记录无法核验');
  const reserve = async () => {
    const [open, pending] = await Promise.all([readOpenInstantPositions(owner), readPendingInstantCampaignJobs(owner, true)]);
    const sameSymbol = (symbol: string) => symbol.replace(/\//g, '').toUpperCase() === input.source.symbol.replace(/\//g, '').toUpperCase();
    const occupied = liveChecks.get(owner)?.(input.source.symbol) ||
      open.some(row => row.id !== input.id && sameSymbol(row.source.symbol)) ||
      pending.some(row => row.input.id !== input.id && !('sell' in row.input) && sameSymbol(row.input.source.symbol));
    if (occupied) return false;
    await saveInstantPosition(owner, input);
    return true;
  };
  return navigator.locks ? navigator.locks.request('veil-instant-admission:' + owner, reserve) : reserve();
}
