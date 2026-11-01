import { readQualityCampaignProjection, type QualityCampaignReadRequest } from '../fish/qualityCampaignReader';

self.onmessage = async (event: MessageEvent<QualityCampaignReadRequest>) => {
  try { self.postMessage({ ok: true, result: await readQualityCampaignProjection(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : '持仓监测读取失败，请重试' }); }
};
