import { formatUTC8 } from "@/lib/timeFormat";

export type SignalJumpIssueCode =
  | "invalid_symbol"
  | "before_listing"
  | "after_delisting"
  | "missing_kline";

export interface SignalJumpIssue {
  code: SignalJumpIssueCode;
  reason: string;
  checkedAt: number;
}

export type SignalJumpResult =
  | { ok: true }
  | { ok: false; fatalIssue?: SignalJumpIssue; reason: string };

export type SignalJumpDiagnostic =
  | { status: "available" }
  | { status: "fatal"; issue: SignalJumpIssue }
  | { status: "retryable"; reason: string };

export interface SignalJumpAuditCandidate {
  id: string;
  symbol: string;
  timeMs: number;
}

export interface SignalJumpAuditProgress {
  checkedSymbols: number;
  totalSymbols: number;
  fatalIssues: Array<{ id: string; issue: SignalJumpIssue }>;
}

export interface SignalJumpAuditSummary {
  checkedSymbols: number;
  totalSymbols: number;
  fatalIssueCount: number;
  retryableSymbols: number;
  retryableReason?: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type KlineQueryResult =
  | { status: "ok"; openTimes: number[] }
  | { status: "invalid-symbol" }
  | { status: "retryable"; reason: string };

const KLINE_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";
const EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const RETRYABLE_HTTP_STATUS = new Set([0, 408, 418, 425, 429, 500, 502, 503, 504]);

function makeIssue(code: SignalJumpIssueCode, reason: string, now: number): SignalJumpIssue {
  return { code, reason, checkedAt: now };
}

function issue(code: SignalJumpIssueCode, reason: string, now: number): SignalJumpDiagnostic {
  return { status: "fatal", issue: makeIssue(code, reason, now) };
}

function readApiError(body: unknown): { code?: number; message?: string } {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const code = typeof record.code === "number" ? record.code : undefined;
  const messageValue = record.msg ?? record.message;
  return {
    code,
    message: typeof messageValue === "string" ? messageValue : undefined,
  };
}

async function queryKlines(
  symbol: string,
  interval: string,
  params: { startTime?: number; endTime?: number; limit?: number },
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<KlineQueryResult> {
  const query = new URLSearchParams({
    symbol,
    interval,
    limit: String(params.limit ?? 1),
  });
  if (params.startTime != null) query.set("startTime", String(params.startTime));
  if (params.endTime != null) query.set("endTime", String(params.endTime));

  try {
    const response = await fetchImpl(`${KLINE_ENDPOINT}?${query}`, signal ? { signal } : undefined);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "retryable", reason: "行情服务返回了无法识别的数据，请稍后重试" };
    }

    const apiError = readApiError(body);
    const invalidSymbol = apiError.code === -1121
      || /invalid symbol/i.test(apiError.message ?? "");
    if (invalidSymbol) return { status: "invalid-symbol" };

    if (!response.ok || !Array.isArray(body)) {
      const serviceUnavailable = /restricted location|service unavailable|temporar/i.test(apiError.message ?? "");
      if (RETRYABLE_HTTP_STATUS.has(response.status) || serviceUnavailable) {
        return {
          status: "retryable",
          reason: apiError.message || `行情服务暂时不可用（HTTP ${response.status}）`,
        };
      }
      return {
        status: "retryable",
        reason: apiError.message || `行情服务请求失败（HTTP ${response.status}）`,
      };
    }

    const openTimes = body
      .map((row) => Array.isArray(row) ? Number(row[0]) : Number.NaN)
      .filter((value) => Number.isFinite(value));
    return { status: "ok", openTimes };
  } catch {
    return { status: "retryable", reason: "网络或行情服务暂时不可用，请稍后重试" };
  }
}

interface ExchangeSymbolInfo {
  onboardDate?: number;
  deliveryDate?: number;
}

type ExchangeInfoQueryResult =
  | { status: "ok"; symbols: Map<string, ExchangeSymbolInfo> }
  | { status: "retryable"; reason: string };

async function queryExchangeInfo(
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<ExchangeInfoQueryResult> {
  try {
    const response = await fetchImpl(EXCHANGE_INFO_ENDPOINT, signal ? { signal } : undefined);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "retryable", reason: "行情服务返回了无法识别的标的信息" };
    }

    const apiError = readApiError(body);
    const rows = body && typeof body === "object"
      ? (body as Record<string, unknown>).symbols
      : undefined;
    if (!response.ok || !Array.isArray(rows)) {
      return {
        status: "retryable",
        reason: apiError.message || `标的信息请求失败（HTTP ${response.status}）`,
      };
    }

    const symbols = new Map<string, ExchangeSymbolInfo>();
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      if (typeof record.symbol !== "string") continue;
      const onboardDate = Number(record.onboardDate);
      const deliveryDate = Number(record.deliveryDate);
      symbols.set(record.symbol.toUpperCase(), {
        onboardDate: Number.isFinite(onboardDate) && onboardDate > 0 ? onboardDate : undefined,
        deliveryDate: Number.isFinite(deliveryDate) && deliveryDate > 0 ? deliveryDate : undefined,
      });
    }
    return { status: "ok", symbols };
  } catch {
    return { status: "retryable", reason: "网络或行情服务暂时不可用，无法预检信号" };
  }
}

type SymbolBoundsResult =
  | { status: "ok"; firstOpen?: number; lastOpen?: number }
  | { status: "invalid-symbol" }
  | { status: "retryable"; reason: string };

async function querySymbolBounds(
  symbol: string,
  interval: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<SymbolBoundsResult> {
  const [first, latest] = await Promise.all([
    queryKlines(symbol, interval, { startTime: 0, limit: 1 }, fetchImpl, signal),
    queryKlines(symbol, interval, { limit: 1 }, fetchImpl, signal),
  ]);
  if (first.status === "invalid-symbol" || latest.status === "invalid-symbol") {
    return { status: "invalid-symbol" };
  }
  if (first.status === "retryable") return first;
  if (latest.status === "retryable") return latest;
  return {
    status: "ok",
    firstOpen: first.openTimes[0],
    lastOpen: latest.openTimes[latest.openTimes.length - 1],
  };
}

function beforeListingIssue(symbol: string, firstOpen: number, now: number): SignalJumpIssue {
  return makeIssue(
    "before_listing",
    `信号时间早于 ${symbol} 的首根 K 线（${formatUTC8(firstOpen)}）`,
    now,
  );
}

function afterDelistingIssue(symbol: string, lastOpen: number, now: number): SignalJumpIssue {
  return makeIssue(
    "after_delisting",
    `信号时间晚于 ${symbol} 的最后一根 K 线（${formatUTC8(lastOpen)}）`,
    now,
  );
}

/**
 * 打开信号库时的低请求量预检。
 *
 * 先用一次 exchangeInfo 覆盖仍在交易所目录中的标的；只有不在目录中的历史/错误标的
 * 才按标的分组补查首尾 K 线。这样上千条信号不会变成上千次请求，同时仍能在用户点击前
 * 标出“标的不存在 / 早于上线 / 晚于下线”这三类确定不会靠重试恢复的问题。
 * 盘中极少见的单根历史缺口继续由实际点击跳转时的精确诊断确认，避免批量误判。
 */
export async function preflightSignalJumpIssues(
  candidates: SignalJumpAuditCandidate[],
  interval: string,
  intervalMs: number,
  options: {
    fetchImpl?: FetchLike;
    now?: number;
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (progress: SignalJumpAuditProgress) => void;
  } = {},
): Promise<SignalJumpAuditSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const span = Math.max(1, intervalMs);
  const grouped = new Map<string, SignalJumpAuditCandidate[]>();

  for (const candidate of candidates) {
    const symbol = candidate.symbol.toUpperCase().replace(/[\s/]+/g, "");
    if (!candidate.id || !symbol || !Number.isFinite(candidate.timeMs)) continue;
    const group = grouped.get(symbol) ?? [];
    group.push({ ...candidate, symbol });
    grouped.set(symbol, group);
  }

  const totalSymbols = grouped.size;
  if (totalSymbols === 0) {
    return {
      checkedSymbols: 0,
      totalSymbols: 0,
      fatalIssueCount: 0,
      retryableSymbols: 0,
    };
  }

  const exchangeInfo = await queryExchangeInfo(fetchImpl, options.signal);
  if (exchangeInfo.status === "retryable") {
    return {
      checkedSymbols: 0,
      totalSymbols,
      fatalIssueCount: 0,
      retryableSymbols: totalSymbols,
      retryableReason: exchangeInfo.reason,
    };
  }

  let checkedSymbols = 0;
  let fatalIssueCount = 0;
  let retryableSymbols = 0;
  const unresolved: Array<[string, SignalJumpAuditCandidate[]]> = [];
  const metadataIssues: Array<{ id: string; issue: SignalJumpIssue }> = [];

  for (const [symbol, group] of grouped) {
    const metadata = exchangeInfo.symbols.get(symbol);
    if (!metadata) {
      unresolved.push([symbol, group]);
      continue;
    }

    for (const candidate of group) {
      if (metadata.onboardDate != null && candidate.timeMs < metadata.onboardDate) {
        metadataIssues.push({
          id: candidate.id,
          issue: beforeListingIssue(symbol, metadata.onboardDate, now),
        });
        continue;
      }
      const deliveryDate = metadata.deliveryDate;
      const hasActuallyDelivered = deliveryDate != null && deliveryDate <= now + span;
      if (hasActuallyDelivered && candidate.timeMs >= deliveryDate) {
        metadataIssues.push({
          id: candidate.id,
          issue: afterDelistingIssue(symbol, Math.max(0, deliveryDate - span), now),
        });
      }
    }

    checkedSymbols += 1;
  }

  if (metadataIssues.length > 0 || checkedSymbols > 0) {
    fatalIssueCount += metadataIssues.length;
    options.onProgress?.({ checkedSymbols, totalSymbols, fatalIssues: metadataIssues });
  }

  let cursor = 0;
  const concurrency = Math.max(1, Math.min(8, Math.trunc(options.concurrency ?? 4)));
  const workers = Array.from(
    { length: Math.min(concurrency, unresolved.length) },
    async () => {
      while (cursor < unresolved.length && !options.signal?.aborted) {
        const index = cursor;
        cursor += 1;
        const [symbol, group] = unresolved[index];
        const bounds = await querySymbolBounds(symbol, interval, fetchImpl, options.signal);
        const fatalIssues: Array<{ id: string; issue: SignalJumpIssue }> = [];

        if (bounds.status === "invalid-symbol") {
          for (const candidate of group) {
            fatalIssues.push({
              id: candidate.id,
              issue: makeIssue(
                "invalid_symbol",
                `${symbol} 不存在于 Binance U 本位永续行情，无法加载该信号的 K 线`,
                now,
              ),
            });
          }
        } else if (bounds.status === "retryable") {
          retryableSymbols += 1;
        } else if (bounds.firstOpen == null || bounds.lastOpen == null) {
          for (const candidate of group) {
            fatalIssues.push({
              id: candidate.id,
              issue: makeIssue(
                "missing_kline",
                `${symbol} 没有可用的 Binance U 本位永续历史 K 线`,
                now,
              ),
            });
          }
        } else {
          for (const candidate of group) {
            if (candidate.timeMs < bounds.firstOpen) {
              fatalIssues.push({
                id: candidate.id,
                issue: beforeListingIssue(symbol, bounds.firstOpen, now),
              });
            } else if (candidate.timeMs >= bounds.lastOpen + span) {
              fatalIssues.push({
                id: candidate.id,
                issue: afterDelistingIssue(symbol, bounds.lastOpen, now),
              });
            }
          }
        }

        checkedSymbols += 1;
        fatalIssueCount += fatalIssues.length;
        options.onProgress?.({ checkedSymbols, totalSymbols, fatalIssues });
      }
    },
  );
  await Promise.all(workers);

  return {
    checkedSymbols,
    totalSymbols,
    fatalIssueCount,
    retryableSymbols,
  };
}

export function hasKlineCoveringSignalTime(
  klines: Array<{ time: number }>,
  signalTimeMs: number,
  intervalMs: number,
): boolean {
  const span = Math.max(1, intervalMs);
  return klines.some((kline) =>
    Number.isFinite(kline.time)
    && kline.time <= signalTimeMs
    && kline.time + span > signalTimeMs);
}

export function signalJumpIssueLabel(code: SignalJumpIssueCode): string {
  switch (code) {
    case "invalid_symbol":
      return "标的不存在";
    case "before_listing":
      return "早于上线";
    case "after_delisting":
      return "晚于下线";
    case "missing_kline":
      return "当时无K线";
  }
}

/**
 * 对一次无法定位到信号时刻的跳转做二次诊断。
 *
 * 只有可以确认不会靠重试恢复的问题才返回 fatal：
 * - Binance U 本位永续不存在该标的；
 * - 信号早于首根 K 线；
 * - 信号晚于最后一根 K 线；
 * - 首尾数据覆盖该时刻，但该时刻本身存在永久历史缺口。
 *
 * 网络、限流、服务端抖动与地区服务提示一律归为 retryable，避免误伤信号库。
 */
export async function diagnoseSignalJump(
  symbol: string,
  signalTimeMs: number,
  interval: string,
  intervalMs: number,
  options: { fetchImpl?: FetchLike; now?: number } = {},
): Promise<SignalJumpDiagnostic> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const span = Math.max(1, intervalMs);

  const atSignal = await queryKlines(
    symbol,
    interval,
    { endTime: signalTimeMs, limit: 1 },
    fetchImpl,
  );
  if (atSignal.status === "invalid-symbol") {
    return issue(
      "invalid_symbol",
      `${symbol} 不存在于 Binance U 本位永续行情，无法加载该信号的 K 线`,
      now,
    );
  }
  if (atSignal.status === "retryable") return atSignal;
  if (atSignal.openTimes.some((openTime) => openTime <= signalTimeMs && openTime + span > signalTimeMs)) {
    return { status: "available" };
  }

  const first = await queryKlines(symbol, interval, { startTime: 0, limit: 1 }, fetchImpl);
  if (first.status === "invalid-symbol") {
    return issue(
      "invalid_symbol",
      `${symbol} 不存在于 Binance U 本位永续行情，无法加载该信号的 K 线`,
      now,
    );
  }
  if (first.status === "retryable") return first;

  const latest = await queryKlines(symbol, interval, { limit: 1 }, fetchImpl);
  if (latest.status === "invalid-symbol") {
    return issue(
      "invalid_symbol",
      `${symbol} 不存在于 Binance U 本位永续行情，无法加载该信号的 K 线`,
      now,
    );
  }
  if (latest.status === "retryable") return latest;

  const firstOpen = first.openTimes[0];
  const lastOpen = latest.openTimes[latest.openTimes.length - 1];
  if (firstOpen == null || lastOpen == null) {
    return issue(
      "missing_kline",
      `${symbol} 没有可用的 Binance U 本位永续历史 K 线`,
      now,
    );
  }
  if (firstOpen > signalTimeMs) {
    return issue(
      "before_listing",
      `信号时间早于 ${symbol} 的首根 K 线（${formatUTC8(firstOpen)}）`,
      now,
    );
  }
  if (lastOpen + span <= signalTimeMs) {
    return issue(
      "after_delisting",
      `信号时间晚于 ${symbol} 的最后一根 K 线（${formatUTC8(lastOpen)}）`,
      now,
    );
  }
  if (signalTimeMs > now + span) {
    return { status: "retryable", reason: "信号时间尚未到达，当前还没有对应 K 线" };
  }

  return issue(
    "missing_kline",
    `${symbol} 在信号时刻 ${formatUTC8(signalTimeMs)} 没有可用的历史 K 线`,
    now,
  );
}
