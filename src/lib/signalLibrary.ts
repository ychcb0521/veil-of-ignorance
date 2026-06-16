/**
 * 信号库（Signal Library）
 * ------------------------------------------------------------------
 * Time Machine 旁边的「折叠接口」用到的本地数据层。
 *
 * 用户可以上传 / 粘贴一批「标的 + 时间 + 兜底区」信号，系统把它们落到 localStorage
 * 充当一个轻量数据库；之后从按字母排序的下拉里点开某个标的，即可越过手动输入标的与
 * 时间，直接把时间机器跳到对应盘面。
 *
 * 解析刻意做得宽松，同时支持两种排版：
 *   ① 区块格式（推荐）：一行「日期 时间」表头，其后多行「标的 [谢林兜底区] 兜底区」都继承该时间；
 *   ② 行内格式：每行「标的, 时间, 兜底区」（逗号 / 制表符 / 空白分隔）。
 * 另支持 `2024/01/15`、`HH:mm`、表头行、`#`//` 注释、`无` 日期标记、`补充` 前缀；标的自动补 USDT。
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

/** 「谢林兜底区」等兜底区标签：标签前是标的、标签后是价格/区间（两侧可无空格）。 */
const FALLBACK_LABEL_RE = /谢林兜底区|兜底区|谢林/;
/** 行首注释词（如「补充」「更新」），出现在标的前需剥离。 */
const LEADING_ANNOT_RE = /^(补充|更新|新增)\s*/;
/** 行首即完整日期时间 → 这是一条「日期表头」，其后多行标的都继承它（允许尾随「无」等注记）。 */
const DATE_HEADER_RE = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)/;
/** 旧版同一行内联格式：`标的 <完整日期时间> 兜底区`（空白分隔）。 */
const INLINE_DT_RE = /^(\S+)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s*([\s\S]*)$/;

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
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  // 月/日/时补零成合法 ISO，统一按 UTC 解析后减 8 小时 → 得到「UTC+8 墙钟」对应的瞬时。
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${(sec ?? '00').padStart(2, '0')}Z`;
  const ms = new Date(iso).getTime() - 8 * 3600_000;
  return Number.isNaN(ms) ? null : ms;
}

/** 归一化标的：大写、去空格/斜杠；若无 USDT 计价后缀则补 USDT（与盘面永续交易对一致）。 */
function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[\s/]+/g, '');
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

/**
 * 解析「区块格式」里的一条标的行：`标的 [谢林兜底区] 兜底区`，
 * 其中「谢林兜底区」是标签、可有可无、与两侧可无空格。
 * 例：`naoris 0.107`、`tac 谢林兜底区 0.0127`、`M谢林兜底区 3.4（无）`、`补充on 谢林兜底区0.108`。
 */
function parseSymbolLine(line: string): { symbol: string; zone: string } {
  const s = line.trim().replace(LEADING_ANNOT_RE, '');
  const lm = FALLBACK_LABEL_RE.exec(s);
  let symbolPart: string;
  let zonePart: string;
  if (lm) {
    symbolPart = s.slice(0, lm.index);
    zonePart = s.slice(lm.index + lm[0].length);
  } else {
    const m = /^(\S+)\s+([\s\S]*)$/.exec(s);
    if (m) {
      symbolPart = m[1];
      zonePart = m[2];
    } else {
      symbolPart = s;
      zonePart = '';
    }
  }
  return { symbol: normalizeSymbol(symbolPart), zone: zonePart.trim() };
}

function pushSignal(
  out: TradeSignal[],
  seen: Set<string>,
  symbol: string,
  timeMs: number,
  timeLabel: string,
  fallbackZone: string,
): void {
  const key = `${symbol}@${timeMs}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ id: makeId(), symbol, timeMs, timeLabel, fallbackZone });
}

/**
 * 解析整段文本（多行），支持两种排版：
 *   ① 区块格式：`2026-04-29 18:27` 这样的日期表头行设定「当前时间」，其后多行
 *      `naoris 0.107` / `tac 谢林兜底区 0.0127` 等标的行都继承该时间；
 *   ② 行内格式：`标的, 时间, 兜底区`（逗号 / 制表符 / 空白分隔，时间自带在行内）。
 * 空行、`#`//` 注释、表头行、`无` 日期行会被静默跳过；同一 标的@时间 自动去重。
 */
export function parseSignalText(text: string): { signals: TradeSignal[]; errors: string[] } {
  const errors: string[] = [];
  const out: TradeSignal[] = [];
  const seen = new Set<string>();

  // 「区块格式」核心：一条日期表头行设定当前时间，其后多行标的(+兜底区)都继承它。
  let curTimeMs: number | null = null;
  let curTimeLabel = '';

  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // 1) 日期表头：行首即完整日期时间（允许尾随「无 / （更新） / 空白」等注记）。
    const dh = DATE_HEADER_RE.exec(line);
    if (dh) {
      const t = parseSignalTime(dh[1]);
      if (t != null) {
        curTimeMs = t;
        curTimeLabel = dh[1].trim();
        continue;
      }
    }

    // 2) 旧版自带时间格式：`标的, 时间, 兜底区`（逗号 / 制表符 / 全角逗号分隔）。
    const parts = line.split(/[\t,，]/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      if (HEADER_TIME_RE.test(parts[1])) continue; // 表头行静默跳过
      const tOld = parseSignalTime(parts[1]);
      if (tOld != null) {
        const sym = normalizeSymbol(parts[0]);
        if (sym) pushSignal(out, seen, sym, tOld, parts[1].trim(), parts.slice(2).join(' ').trim());
        else errors.push(`第 ${idx + 1} 行缺少标的：${line}`);
        continue;
      }
    }

    // 2b) 旧版空白分隔自带时间：`标的 <完整日期时间> 兜底区`。
    const inline = INLINE_DT_RE.exec(line);
    if (inline) {
      const tInline = parseSignalTime(inline[2]);
      if (tInline != null) {
        const sym = normalizeSymbol(inline[1]);
        if (sym) pushSignal(out, seen, sym, tInline, inline[2].trim(), inline[3].trim());
        else errors.push(`第 ${idx + 1} 行缺少标的：${line}`);
        continue;
      }
    }

    // 3) 区块格式的标的行：时间继承自上方日期表头。
    if (curTimeMs == null) {
      errors.push(`第 ${idx + 1} 行无法解析（其上方缺少日期表头）：${line}`);
      continue;
    }
    const { symbol, zone } = parseSymbolLine(line);
    if (!symbol) {
      errors.push(`第 ${idx + 1} 行缺少标的：${line}`);
      continue;
    }
    pushSignal(out, seen, symbol, curTimeMs, curTimeLabel, zone);
  }

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

/** 按时间排序：dir='desc' 最近在前（默认），'asc' 最早在前；同一时间按标的字母序稳定。 */
export function sortSignalsByTime(list: TradeSignal[], dir: 'asc' | 'desc' = 'desc'): TradeSignal[] {
  const k = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const t = (a.timeMs - b.timeMs) * k;
    return t !== 0 ? t : a.symbol.localeCompare(b.symbol);
  });
}

/**
 * 取某条信号所属的「年-月」键（按 UTC+8 墙钟解释），如 `2026-04`。
 * 用于信号库里「按月份定位」：与展示用的 timeLabel 同一时区语义。
 */
export function signalMonthKey(timeMs: number): string {
  const d = new Date(timeMs + 8 * 3600_000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${mo}`;
}

/** 列出信号里出现过的所有月份（去重），按时间倒序——最近的月份排在最前。 */
export function listSignalMonths(signals: TradeSignal[]): string[] {
  const set = new Set<string>();
  for (const s of signals) set.add(signalMonthKey(s.timeMs));
  return [...set].sort((a, b) => b.localeCompare(a));
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

/**
 * 把 timeMs 还原成 `YYYY-MM-DD HH:mm:ss`（按 UTC+8 墙钟），用作导出时的「日期表头」。
 * 必须带上秒——parseSignalTime 接受可选秒位，丢秒会让带秒信号在 re-import 时偏移。
 */
function formatSignalHeader(timeMs: number): string {
  const d = new Date(timeMs + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * 把信号库序列化成「区块格式」纯文本——与 parseSignalText 完全互逆，导出的文本能原样再导入。
 * 同一时间的信号归到一个日期表头下，时间倒序（最近在前）、组内按标的字母序。
 * 例：
 *   2026-04-29 18:27:00
 *   MOODENGUSDT 0.0608
 *   NAORISUSDT 0.107
 *
 *   2026-04-28 21:00:00
 *   TACUSDT 0.0127
 */
export function serializeSignals(signals: TradeSignal[]): string {
  if (signals.length === 0) return '';
  const byTime = new Map<number, TradeSignal[]>();
  for (const s of signals) {
    const arr = byTime.get(s.timeMs);
    if (arr) arr.push(s);
    else byTime.set(s.timeMs, [s]);
  }
  const times = [...byTime.keys()].sort((a, b) => b - a); // 最近的时间在前
  const blocks = times.map(t => {
    const group = [...(byTime.get(t) ?? [])].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const lines = [formatSignalHeader(t)];
    for (const s of group) {
      lines.push(s.fallbackZone ? `${s.symbol} ${s.fallbackZone}` : s.symbol);
    }
    return lines.join('\n');
  });
  return `${blocks.join('\n\n')}\n`;
}
