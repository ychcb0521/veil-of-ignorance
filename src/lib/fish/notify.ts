/**
 * 新鱼邮件提醒：每轮捕捞结束，把这一轮「第一次捕到」的鱼发到用户填的邮箱（可填多个）。
 * 【用户要求】2026-10-21「我希望捕捉到的新鱼能够及时发送到我的邮箱，并且邮箱地址数量可以添加」；发信方式用户选定 EmailJS + 自己的邮箱。
 *
 * 网站在浏览器里运行，自己发不了信：借 EmailJS（emailjs.com）——用户在那里连上自己的 Gmail / QQ / 163 等邮箱，
 * 建一个模板，把 Service ID、Template ID、Public Key 三个编号填进来；这里调用它的公开接口，用用户的邮箱发给所填的全部地址。
 * Public Key 本来就是给网页公开用的，可以随账号同步；设置跟账号走（换电脑也在）。
 */
import type { TradeSignal } from '@/lib/signalLibrary';
import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { queueSimStatePush } from '@/lib/simStateSync';
import { formatUTC8 } from '@/lib/timeFormat';
import { EXCHANGE_NAMES } from './exchanges';
import { fishCaughtBy, fishVisibleKey } from './records';

export interface FishNotifyConfig { enabled: boolean; emails: string[]; serviceId: string; templateId: string; publicKey: string }
export const DEFAULT_FISH_NOTIFY: FishNotifyConfig = { enabled: false, emails: [], serviceId: '', templateId: '', publicKey: '' };
export const FISH_NOTIFY_MAX_EMAILS = 20;
const LOGICAL_KEY = 'fish_notify_v1';
const storageKey = () => `${getUserPrefix()}${LOGICAL_KEY}`;
export const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

/** 宽松但够用的邮箱格式检查：有 @、@ 前后不空、域名里有点、没有空白。 */
export const isEmail = (v: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v.trim());
export function normalizeFishNotify(raw: unknown): FishNotifyConfig {
  const x = (raw && typeof raw === 'object' ? raw : {}) as Partial<FishNotifyConfig>;
  const emails = Array.isArray(x.emails) ? [...new Set(x.emails.filter((e): e is string => typeof e === 'string' && isEmail(e)).map(e => e.trim().toLowerCase()))].slice(0, FISH_NOTIFY_MAX_EMAILS) : [];
  const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
  return { enabled: x.enabled === true, emails, serviceId: text(x.serviceId), templateId: text(x.templateId), publicKey: text(x.publicKey) };
}
export function readFishNotify(): FishNotifyConfig {
  try { return normalizeFishNotify(JSON.parse(readPersistedStateRaw(storageKey()) ?? 'null')); } catch { return DEFAULT_FISH_NOTIFY; }
}
export function saveFishNotify(config: FishNotifyConfig): void {
  const value = normalizeFishNotify(config);
  writePersistedStateRaw(storageKey(), JSON.stringify(value));
  const uid = getUserId();
  if (uid) queueSimStatePush(uid, LOGICAL_KEY, value);
}
/**
 * 三个编号填错位置的常见情况（2026-10-21 用户截图：Service ID 填了邮箱、Template ID 填了 {{to_email}}）：直接指出该填什么。
 */
export function fishNotifyFieldProblem(c: Pick<FishNotifyConfig, 'serviceId' | 'templateId' | 'publicKey'>): string {
  if (c.serviceId.includes('@')) return 'Service ID 填的是邮箱：这里要填 EmailJS「Email Services」里那一串编号（形如 service_abc123）';
  if (/[{}]/.test(c.templateId)) return 'Template ID 填成了模板内容：{{to_email}} 是填在 EmailJS 网站的模板里的；这里要填模板编号（形如 template_abc123）';
  if (/[{}@\s]/.test(c.publicKey)) return 'Public Key 不对：到 EmailJS「Account」页复制 Public Key（一串字母数字）';
  return '';
}
/** 还缺什么才能发（空 = 可以发）。 */
export function fishNotifyMissing(c: FishNotifyConfig): string {
  if (!c.emails.length) return '先添加至少一个收件邮箱';
  // 填错位置的先指出来（哪怕另外几个还空着），再提示没填的
  return fishNotifyFieldProblem(c) || (!c.serviceId || !c.templateId || !c.publicKey ? '先填好 EmailJS 的 Service ID、Template ID 和 Public Key' : '');
}

/**
 * 邮件内容：主题、纯文本、HTML 表格。
 * 【用户要求】2026-10-21「我希望邮件的内容是这个新鱼的截图」：HTML 版照「新鱼」列表的样子画——
 * 对外只显示中性的信号信息，列为 标的 / 信号时间 / 算法类型 / 市场，信号时间最近的在上；传了 newKeys 时本轮新增的那几条标「新」。
 * 模板正文写 {{{message_html}}}（三层大括号）显示表格；写 {{message}} 是纯文字版。
 */
/** 邮件表格最多列这么多行（其余写「还有 N 条」），保证不超过 EmailJS 免费版的大小上限。 */
export const FISH_EMAIL_MAX_ROWS = 60;
export function composeFishEmail(fish: readonly TradeSignal[], now = Date.now(), newKeys?: ReadonlySet<string>) {
  const rows = [...fish].sort((a, b) => b.timeMs - a.timeMs).map(s => ({
    symbol: s.symbol,
    market: [s.market === 'us_stock' ? '美股' : '', s.exchange && s.exchange !== 'binance' ? EXCHANGE_NAMES[s.exchange] ?? s.exchange : ''].filter(Boolean).join(' · '),
    time: formatUTC8(s.timeMs).slice(0, 19),
    algorithms: fishCaughtBy(s).join(' · '),
    isNew: !!newKeys?.has(fishVisibleKey(s)),
  }));
  const added = newKeys ? rows.filter(r => r.isNew).length : rows.length;
  const tail = newKeys && added < rows.length ? `（新增 ${added}）` : '';
  const subject = `信号通知 ${rows.length} 条${tail} · ${formatUTC8(now).slice(0, 16)}`;
  const message = [`信号 ${rows.length} 条${tail}（信号时间为 UTC+8，最近的在上）：`, '', ...rows.map(r => `${r.isNew && newKeys ? '【新】' : ''}${r.symbol}　${r.time}　${r.algorithms}${r.market ? `　${r.market}` : ''}`)].join('\n').trim();
  const esc = (v: string) => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  // EmailJS 免费版模板变量合计约 50KB：样式尽量放在 table 上继承，每行只留必需的内联样式；最多列 60 行
  const shown = rows.slice(0, FISH_EMAIL_MAX_ROWS), more = rows.length - shown.length;
  const sans = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif", mono = 'ui-monospace,Menlo,Consolas,monospace';
  const cell = 'padding:8px 12px;border-top:1px solid #f0f1f3';
  const message_html = `<div style="font:14px ${sans};color:#111827;max-width:720px">`
    + `<div style="margin:0 0 10px;font-size:15px;font-weight:600">信号 <span style="padding:1px 7px;border-radius:5px;background:#fdf1d6;color:#b7791f;font:12px ${mono}">${rows.length}</span>`
    + `${tail ? ` <span style="font-size:12px;font-weight:400;color:#6b7280">本轮新增 ${added}</span>` : ''}</div>`
    + `<table cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:10px;width:100%;font:13px ${mono};color:#374151">`
    + `<tr style="background:#f8fafc;font:12px ${sans};color:#6b7280;text-align:left">${['标的', '信号时间 ↓', '算法类型', '市场'].map(h => `<th style="padding:9px 12px;font-weight:500">${h}</th>`).join('')}</tr>`
    + shown.map(r => {
      const mark = r.isNew && newKeys;
      const [date, clock] = r.time.split(' ');
      return `<tr${mark ? ' style="background:#fffbeb"' : ''}><td style="${cell};color:#111827;white-space:nowrap">${esc(r.symbol)}${mark ? ` <span style="padding:0 4px;border-radius:4px;background:#fdf1d6;color:#b7791f;font:10px ${sans}">新</span>` : ''}</td>`
        + `<td style="${cell};color:#4b5563"><span style="white-space:nowrap">${date}</span> ${clock}</td>`
        + `<td style="${cell}">${r.algorithms.split(' · ').map(esc).join(' ·&nbsp;')}</td><td style="${cell};color:#6b7280;font-family:${sans}">${esc(r.market)}</td></tr>`;
    }).join('')
    + `</table>`
    + `<p style="margin:10px 0 0;font-size:12px;color:#9ca3af">${more ? `还有 ${more} 条 · ` : ''}信号时间为 UTC+8</p></div>`;
  return { subject, message, message_html, count: rows.length };
}

/**
 * EmailJS 自带「Contact Us」模板的变量（{{name}} {{title}} {{time}} {{email}}）也一并填上：
 * 使用中性的名称和主题，正文 {{message}} 就是信号列表。
 * 【用户要求】2026-10-21「还是找不到编辑的」「还有别的办法拿 Template ID 吗」
 */
const contactUsParams = (config: FishNotifyConfig, subject: string) => ({ name: '信号通知', title: subject, time: formatUTC8(Date.now()).slice(0, 16), email: config.emails[0] ?? '' });
/** 调 EmailJS 发一封（收件人用逗号隔开，EmailJS 的「To Email」填 {{to_email}} 就能一次发给全部）。失败抛出可读的原因。 */
export async function sendFishEmail(config: FishNotifyConfig, content: { subject: string; message: string; message_html: string; count: number }, request: typeof fetch = fetch): Promise<void> {
  const missing = fishNotifyMissing(config);
  if (missing) throw new Error(missing);
  const response = await request(EMAILJS_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: config.serviceId, template_id: config.templateId, user_id: config.publicKey, template_params: { to_email: config.emails.join(','), ...content, count: String(content.count), ...contactUsParams(config, content.subject) } }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`EmailJS 拒绝发送（${response.status}）${detail ? `：${detail}` : ''}`);
  }
}

/**
 * 上一封邮件里的新鱼列表（鱼的键）。
 * 【用户要求】2026-10-21「新鱼只要有更新，都发一次邮件，无论是手动还是自动模式，都要发」：
 * 每轮结束拿当前新鱼列表和它比，不一样就发整张表（比上一封多出来的标「新」），一样就不发。跟账号同步。
 */
const LAST_KEY = 'fish_notified_last_v1';
const lastStorageKey = () => `${getUserPrefix()}${LAST_KEY}`;
export function readLastFishTable(): string[] {
  try { const x = JSON.parse(readPersistedStateRaw(lastStorageKey()) ?? '[]'); return Array.isArray(x) ? x.filter((k): k is string => typeof k === 'string') : []; } catch { return []; }
}
export function saveLastFishTable(keys: readonly string[]): void {
  const value = [...new Set(keys)];
  writePersistedStateRaw(lastStorageKey(), JSON.stringify(value));
  const uid = getUserId();
  if (uid) queueSimStatePush(uid, LAST_KEY, value);
}
/** 这张新鱼表和上一封比：changed = 有变化（要发），added = 上一封里没有的。 */
export function fishTableChange(table: readonly TradeSignal[]): { changed: boolean; added: Set<string>; keys: string[] } {
  // 按整行显示的内容比（同一信号换了算法键不算变化）
  const keys = [...new Set(table.map(fishVisibleKey))], last = new Set(readLastFishTable());
  const added = new Set(keys.filter(k => !last.has(k)));
  return { changed: keys.length > 0 && (added.size > 0 || keys.length !== last.size), added, keys };
}
