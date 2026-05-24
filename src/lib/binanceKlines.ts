export interface BinanceKlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FetchKlinesParams {
  symbol: string;
  interval: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

const FUTURES_KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";
const VISION_SPOT_KLINES_ENDPOINT = "https://data-api.binance.vision/api/v3/klines";

function getKlineEndpoints() {
  return import.meta.env.DEV
    ? [VISION_SPOT_KLINES_ENDPOINT, FUTURES_KLINES_ENDPOINT]
    : [FUTURES_KLINES_ENDPOINT, VISION_SPOT_KLINES_ENDPOINT];
}

function buildQuery(params: FetchKlinesParams) {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    limit: String(params.limit ?? 1000),
  });
  if (params.startTime != null) qs.set("startTime", String(params.startTime));
  if (params.endTime != null) qs.set("endTime", String(params.endTime));
  return qs;
}

function parseKlines(raw: unknown[][]): BinanceKlineData[] {
  return raw.map((k) => ({
    time: k[0] as number,
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
}

export async function fetchBinanceKlines(params: FetchKlinesParams): Promise<BinanceKlineData[]> {
  const errors: string[] = [];

  for (const endpoint of getKlineEndpoints()) {
    try {
      const res = await fetch(`${endpoint}?${buildQuery(params)}`);
      if (!res.ok) {
        errors.push(`${endpoint}: API ${res.status}`);
        continue;
      }

      const raw: unknown[][] = await res.json();
      return parseKlines(raw);
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" / "));
}
