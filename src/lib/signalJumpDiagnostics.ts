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

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type KlineQueryResult =
  | { status: "ok"; openTimes: number[] }
  | { status: "invalid-symbol" }
  | { status: "retryable"; reason: string };

const KLINE_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";
const RETRYABLE_HTTP_STATUS = new Set([0, 408, 418, 425, 429, 500, 502, 503, 504]);

function issue(code: SignalJumpIssueCode, reason: string, now: number): SignalJumpDiagnostic {
  return {
    status: "fatal",
    issue: { code, reason, checkedAt: now },
  };
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
): Promise<KlineQueryResult> {
  const query = new URLSearchParams({
    symbol,
    interval,
    limit: String(params.limit ?? 1),
  });
  if (params.startTime != null) query.set("startTime", String(params.startTime));
  if (params.endTime != null) query.set("endTime", String(params.endTime));

  try {
    const response = await fetchImpl(`${KLINE_ENDPOINT}?${query}`);
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
