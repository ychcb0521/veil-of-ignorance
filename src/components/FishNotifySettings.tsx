/**
 * 「渔」的新鱼邮件提醒设置：开关、收件邮箱（可加多个）、EmailJS 三个编号、发测试邮件、上次发送结果。
 * 【用户要求】2026-10-21「我希望捕捉到的新鱼能够及时发送到我的邮箱，并且邮箱地址数量可以添加」。
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import type { FishNotify } from '@/hooks/useFishNotify';
import { FISH_NOTIFY_MAX_EMAILS, fishNotifyFieldProblem, fishNotifyMissing, isEmail } from '@/lib/fish/notify';
import { FishCheck } from './FishAlgorithmCard';

const field = 'h-7 min-w-0 rounded-md border border-transparent bg-background px-2 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring/60';
export function FishNotifySettings({ notify }: { notify: FishNotify }) {
  const { config, status, sending } = notify;
  const [draft, setDraft] = useState(''), [hint, setHint] = useState('');
  const missing = fishNotifyMissing(config);
  const add = () => {
    const parts = draft.split(/[\s,;，；]+/).map(v => v.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter(v => !isEmail(v));
    if (bad.length) { setHint(`邮箱格式不对：${bad.join('、')}`); return; }
    const emails = [...new Set([...config.emails, ...parts])];
    if (emails.length > FISH_NOTIFY_MAX_EMAILS) { setHint(`最多 ${FISH_NOTIFY_MAX_EMAILS} 个邮箱`); return; }
    notify.update({ ...config, emails }); setDraft(''); setHint('');
  };
  return <div className="space-y-2 rounded-lg bg-muted/30 px-3 py-2.5 text-[11px]" data-testid="fish-notify" aria-label="邮件提醒设置">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="flex items-center gap-1.5 font-medium"><FishCheck aria-label="新鱼发到邮箱" checked={config.enabled} onChange={e => notify.update({ ...config, enabled: e.target.checked })} />新鱼发到邮箱</label>
      <span className="text-[10.5px] text-muted-foreground">每轮捕捞结束（手动或自动），把这一轮第一次捕到的鱼发一封邮件；以前就在列表里的不重复发</span>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      {config.emails.map(e => <span key={e} className="inline-flex h-6 items-center gap-1 rounded-md bg-background pl-2 pr-1 font-mono text-[10.5px]">{e}<button type="button" aria-label={`删除 ${e}`} className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground" onClick={() => notify.update({ ...config, emails: config.emails.filter(x => x !== e) })}><X className="h-3 w-3" /></button></span>)}
      <input aria-label="添加收件邮箱" placeholder={config.emails.length ? '再加一个邮箱…' : '收件邮箱，如 me@qq.com'} value={draft} onChange={e => { setDraft(e.target.value); setHint(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={`${field} w-48 font-mono`} />
      <button type="button" onClick={add} disabled={!draft.trim()} className="h-7 rounded-md border border-border/70 bg-background px-2.5 hover:bg-muted disabled:opacity-40">添加</button>
      {hint && <span className="text-destructive/80" role="alert">{hint}</span>}
    </div>
    <details className="group" open={!config.serviceId || !config.templateId || !config.publicKey}>
      <summary className="w-fit cursor-pointer text-[10.5px] text-muted-foreground hover:text-foreground">发信设置（EmailJS）{!missing && ' · 已填好'}</summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {([['serviceId', 'Service ID', 'service_xxx'], ['templateId', 'Template ID', 'template_xxx'], ['publicKey', 'Public Key', '公钥']] as const).map(([k, label, ph]) =>
            <label key={k} className="flex items-center gap-1 text-muted-foreground"><span className="w-20 shrink-0 sm:w-auto">{label}</span><input key={`${k}:${config[k]}`} aria-label={`EmailJS ${label}`} placeholder={ph} defaultValue={config[k]} onBlur={e => { if (e.target.value.trim() !== config[k]) notify.update({ ...config, [k]: e.target.value }); }} className={`${field} w-36 font-mono`} /></label>)}
        </div>
        <ol className="list-decimal space-y-0.5 pl-4 text-[10.5px] leading-relaxed text-muted-foreground">
          <li>在 emailjs.com 免费注册（每月 200 封），「Email Services」里连上你的邮箱（Gmail / QQ / 163 / Outlook 都行），得到 <b>Service ID</b>。</li>
          <li>「Email Templates」新建模板：<b>To Email</b> 填 <code>{'{{to_email}}'}</code>，<b>Subject</b> 填 <code>{'{{subject}}'}</code>，正文填 <code>{'{{{message_html}}}'}</code>（三层大括号，显示表格）或 <code>{'{{message}}'}</code>（纯文字），保存得到 <b>Template ID</b>。</li>
          <li>「Account」页复制 <b>Public Key</b>。三个都填好后点「发测试邮件」，收到就成了。</li>
        </ol>
      </div>
    </details>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void notify.test()} disabled={!!missing || sending} className="h-7 rounded-md border border-border/70 bg-background px-2.5 hover:bg-muted disabled:opacity-40">{sending ? '发送中…' : '发测试邮件'}</button>
      {missing ? <span className={`text-[10.5px] ${fishNotifyFieldProblem(config) ? 'text-destructive/80' : 'text-muted-foreground'}`} data-testid="fish-notify-missing">{missing}</span>
        : status ? <span className={`text-[10.5px] ${status.ok ? 'text-muted-foreground' : 'text-destructive/80'}`} data-testid="fish-notify-status">{new Date(status.at).toLocaleTimeString('zh-CN', { hour12: false })} {status.test ? '测试邮件' : `新鱼 ${status.count} 条`}{status.ok ? ` 已发到 ${config.emails.length} 个邮箱` : ` 发送失败：${status.error}`}</span>
        : !config.enabled && <span className="text-[10.5px] text-muted-foreground">勾选「新鱼发到邮箱」后开始提醒</span>}
    </div>
  </div>;
}
