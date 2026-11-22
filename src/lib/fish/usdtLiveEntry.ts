export const USDT_ENTRY_MAX_AGE_MS = 120_000;
export const USDT_EXECUTION_SAFETY = 2 as const;
export const USDT_EXECUTION_PATH = '/api/usdt-follow/safe';

export interface UsdtLiveEntry {
  version: 1;
  capturedAt: number;
  templateId: string;
  notional: number;
  leverage: number;
}

type LiveEntryCandidate = {
  admittedAt: number; notional: number; leverage: number; liveEntry?: UsdtLiveEntry;
};

export function validUsdtLiveEntry(campaign: LiveEntryCandidate): campaign is LiveEntryCandidate & { liveEntry: UsdtLiveEntry } {
  const entry = campaign.liveEntry;
  return !!entry && entry.version === 1 && Number.isSafeInteger(entry.capturedAt) && entry.capturedAt > 0
    && entry.capturedAt <= campaign.admittedAt && typeof entry.templateId === 'string'
    && !!entry.templateId.trim() && entry.templateId.length <= 200
    && Number.isFinite(entry.notional) && entry.notional > 0 && entry.notional === campaign.notional
    && Number.isInteger(entry.leverage) && entry.leverage >= 1 && entry.leverage <= 125 && entry.leverage === campaign.leverage;
}
