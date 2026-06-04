/**
 * 信号库（Signal Library）
 * ------------------------------------------------------------------
 * Time Machine 旁边的「折叠接口」用到的本地数据层。
 *
 * 用户可以上传 / 粘贴一批「标的 + 时间 + 兜底区」信号，系统把它们落到 localStorage
 * 充当一个轻量数据库；之后从按字母排序的下拉里点开某个标的，即可越过手动输入标的与
 * 时间，直接把时间机器跳到对应盘面。
 *
 * 解析刻意做得宽松：支持逗号 / 制表符 / 空白分隔，支持 `2024/01/15`、`HH:mm`、表头行。
 * 时间语义与 TimeControl 里的手动输入完全一致——按 UTC+8 墙钟解释。
 */

export interface TradeSignal {
  /** 稳定 id，用于列表 key 与删除 */
  id: string;
  /** 归一化后的标的，如 BTCUSDT（大写、去空格与斜杠） */
  symbol: string;
  /** 模拟时间（epoch 毫秒，按 UTC+8 解释后的瞬时） */
  timeMs: number;
  /** 原始时间串，用于展示（保留用户输入的样子） */
  timeLabel: string;
  /** 兜底区：价格位 / 区间 / 备注，纯文本 */
  fallbackZone: string;
}

export const SIGNAL_LIBRARY_STORAGE_KEY = 'veil.signalLibrary.v1';

const HEADER_TIME_RE = /^(time|时间|日期|date)$/i;

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 把「2024-01-15 16:00:00 / 2024/01/15 16:00 / 2024-01-15T16:00」这类串解析为 epoch 毫秒。
 * 与 TimeControl.handleStart 保持一致：把输入当作 UTC+8 墙钟。返回 null 表示无法识别。
 */
export function parseSignalTime(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\//g, '-');
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)$/.exec(s);
  if (!m) return null;
  const datePart = m[1];
  let timePart = m[2];
  if (timePart.length <= 5) timePart += ':00'; // HH:mm -> HH:mm:00
  // 补齐 H:mm -> 0H:mm 由 Date 解析容错处理；统一走 UTC 再减 8 小时得到 UTC+8 墙钟瞬时
  const ms = new Date(`${datePart}T${timePart.padStart(8, '0')}Z`).getTime() - 8 * 3600_000;
  return Number.isNaN(ms) ? null : ms;
}

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s/]/g, '');
}

/**
 * 解析整段文本（多行）。每行一个信号：
 *   `标的, 时间, 兜底区`  或  `标的<制表符>时间<制表符>兜底区`  或  `标的 时间 兜底区`
 * 表头行、空行、`#` / `//` 注释行会被静默跳过；同一 标的@时间 自动去重。
 */
export function parseSignalText(text: string): { signals: TradeSignal[]; errors: string[] } {
  const errors: string[] = [];
  const out: TradeSignal[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;

    let parts = line.split(/[\t,]/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      // 空白分隔兜底：SYMBOL <date time> [zone...]
      const m = /^(\S+)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/.exec(line);
      if (m) parts = [m[1], m[2], m[3].trim()].filter((p, i) => i < 2 || p.length > 0);
    }
    if (parts.length < 2) {
      errors.push(`第 ${idx + 1} 行无法解析：${line}`);
      return;
    }

    // 表头行静默跳过（第二列是 time/时间/日期/date）
    if (HEADER_TIME_RE.test(parts[1])) return;

    const symbol = normalizeSymbol(parts[0]);
    const timeMs = parseSignalTime(parts[1]);
    if (!symbol) {
      errors.push(`第 ${idx + 1} 行缺少标的：${line}`);
      return;
    }
    if (timeMs == null) {
      errors.push(`第 ${idx + 1} 行时间无法识别：${parts[1]}`);
      return;
    }

    const key = `${symbol}@${timeMs}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: makeId(),
      symbol,
      timeMs,
      timeLabel: parts[1].trim(),
      fallbackZone: parts.slice(2).join(' ').trim(),
    });
  });

  return { signals: out, errors };
}

/** 合并：在已存在的信号上追加新信号，按 标的@时间 去重（保留已存在的那条）。 */
export function mergeSignals(existing: TradeSignal[], incoming: TradeSignal[]): TradeSignal[] {
  const seen = new Set(existing.map(s => `${s.symbol}@${s.timeMs}`));
  const merged = [...existing];
  for (const sig of incoming) {
    const key = `${sig.symbol}@${sig.timeMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(sig);
  }
  return merged;
}

/** 按标的字母序排序；同一标的按时间升序。 */
export function sortSignalsAlpha(list: TradeSignal[]): TradeSignal[] {
  return [...list].sort((a, b) => {
    const s = a.symbol.localeCompare(b.symbol);
    return s !== 0 ? s : a.timeMs - b.timeMs;
  });
}

export function loadSignals(): TradeSignal[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is TradeSignal =>
      s && typeof s.id === 'string' && typeof s.symbol === 'string'
      && typeof s.timeMs === 'number' && Number.isFinite(s.timeMs));
  } catch {
    return [];
  }
}

export function saveSignals(list: TradeSignal[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / serialization errors */
  }
}
