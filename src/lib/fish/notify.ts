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
import { fishCaughtBy, fishDedupKey } from './records';

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
/** 还缺什么才能发（空 = 可以发）。 */
export function fishNotifyMissing(c: FishNotifyConfig): string {
  if (!c.emails.length) return '先添加至少一个收件邮箱';
  if (!c.serviceId || !c.templateId || !c.publicKey) return '先填好 EmailJS 的 Service ID、Template ID 和 Public Key';
  return '';
}

/** 邮件内容：主题、纯文本、HTML 表格（模板里用 {{message}} 或 {{{message_html}}} 都行）。 */
export function composeFishEmail(fish: readonly TradeSignal[], now = Date.now(), site = typeof location !== 'undefined' ? location.origin : '') {
  const rows = [...fish].sort((a, b) => b.timeMs - a.timeMs).map(s => ({
    symbol: s.symbol + (s.market === 'us_stock' ? '（美股）' : ''),
    exchange: EXCHANGE_NAMES[s.exchange ?? 'binance'] ?? s.exchange ?? '币安',
    time: formatUTC8(s.timeMs).slice(0, 16),
    algorithms: fishCaughtBy(s).join(' · '),
  }));
  const subject = `【渔】新鱼 ${rows.length} 条 · ${formatUTC8(now).slice(0, 16)}`;
  const message = [`这一轮捕到 ${rows.length} 条新鱼（时间为 UTC+8）：`, '', ...rows.map(r => `${r.symbol}　${r.exchange}　信号 ${r.time}　${r.algorithms}`), '', site ? `打开无知之幕：${site}` : ''].join('\n').trim();
  const esc = (v: string) => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const cell = 'padding:6px 10px;border-bottom:1px solid #eee;text-align:left';
  const message_html = `<p style="font:14px sans-serif">这一轮捕到 <b>${rows.length}</b> 条新鱼（时间为 UTC+8）：</p>`
    + `<table style="border-collapse:collapse;font:13px sans-serif"><tr>${['标的', '交易所', '信号时间', '算法类型'].map(h => `<th style="${cell};color:#888;font-weight:normal">${h}</th>`).join('')}</tr>`
    + rows.map(r => `<tr><td style="${cell};font-family:monospace">${esc(r.symbol)}</td><td style="${cell}">${esc(r.exchange)}</td><td style="${cell};font-family:monospace">${esc(r.time)}</td><td style="${cell}">${esc(r.algorithms)}</td></tr>`).join('')
    + `</table>${site ? `<p style="font:13px sans-serif"><a href="${esc(site)}">打开无知之幕</a></p>` : ''}`;
  return { subject, message, message_html, count: rows.length };
}

/** 调 EmailJS 发一封（收件人用逗号隔开，EmailJS 的「To Email」填 {{to_email}} 就能一次发给全部）。失败抛出可读的原因。 */
export async function sendFishEmail(config: FishNotifyConfig, content: { subject: string; message: string; message_html: string; count: number }, request: typeof fetch = fetch): Promise<void> {
  const missing = fishNotifyMissing(config);
  if (missing) throw new Error(missing);
  const response = await request(EMAILJS_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: config.serviceId, template_id: config.templateId, user_id: config.publicKey, template_params: { to_email: config.emails.join(','), ...content, count: String(content.count) } }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`EmailJS 拒绝发送（${response.status}）${detail ? `：${detail}` : ''}`);
  }
}

/** 发过邮件的鱼（键 → 发送时刻）：同一条鱼只提醒一次，哪怕切换组合后被撤下、下一轮又捕到。跟账号同步，换电脑也不重复发。 */
const SENT_KEY = 'fish_notified_v1', SENT_LIMIT = 5000;
const sentStorageKey = () => `${getUserPrefix()}${SENT_KEY}`;
export function readNotifiedFish(): Record<string, number> {
  try { const x = JSON.parse(readPersistedStateRaw(sentStorageKey()) ?? '{}'); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; }
}
/** 还没提醒过的那几条。 */
export const unnotifiedFish = (fish: readonly TradeSignal[]) => { const sent = readNotifiedFish(); return fish.filter(s => sent[fishDedupKey(s)] === undefined); };
export function markFishNotified(fish: readonly TradeSignal[], now = Date.now()): void {
  const next = Object.fromEntries(Object.entries({ ...readNotifiedFish(), ...Object.fromEntries(fish.map(s => [fishDedupKey(s), now])) }).sort((a, b) => b[1] - a[1]).slice(0, SENT_LIMIT));
  writePersistedStateRaw(sentStorageKey(), JSON.stringify(next));
  const uid = getUserId();
  if (uid) queueSimStatePush(uid, SENT_KEY, next);
}
