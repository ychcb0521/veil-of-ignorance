/**
 * 登录态恢复失败时的分类、自救与诊断。
 *
 * 事故：页面永远停在「加载中...」。那一屏只等一件事——Supabase 的 getSession() 返回；
 * 而线上那版登录库在三种情况下不返回或直接报错：登录锁被另一个标签页抢走、
 * 刷新令牌的请求一直没有回应、本地存储写满令牌存不进去。原来的代码既不接错误也不设超时，
 * 三种情况都表现为无限转圈，从屏幕上分不出是哪一种。
 *
 * 这里不碰登录库本身：只负责认出是哪一种、能自救的自救一次、救不回来就把原因和现场读数
 * 摆到屏幕上。读数只取长度、数量与到期时刻，不读令牌内容。
 */
import { BUILD_STAMP } from '@/lib/buildStamp';
import { describeStorageUsage, ensureCriticalStorageHeadroom, measureRebuildableCaches, type StorageHeadroom } from '@/lib/persistedStateStorage';

/** 超过这么久还没恢复出登录态，就不再只转圈。刷新令牌自带的重试最长 30 秒，页面继续等它。 */
export const AUTH_BOOT_TIMEOUT_MS = 12_000;
/** 同一个标签页在这段时间内最多自动重载一次：自救不能变成重载循环。 */
export const AUTH_BOOT_AUTO_RELOAD_WINDOW_MS = 60_000;
const AUTO_RELOAD_KEY = 'veil.authBoot.autoReloadAt';

export type AuthBootIssueKind = 'lock-stolen' | 'storage-full' | 'timeout' | 'error';
export interface AuthBootDiagnostic { label: string; value: string }
export interface AuthBootIssue {
  kind: AuthBootIssueKind;
  reason: string;
  diagnostics: AuthBootDiagnostic[];
}

const AUTH_TOKEN_KEY = /^sb-.+-auth-token(-code-verifier|-user)?$/;
const AUTH_SESSION_KEY = /^sb-.+-auth-token$/;

function errorName(error: unknown): string {
  return typeof (error as { name?: unknown })?.name === 'string' ? (error as { name: string }).name : '';
}

function errorMessage(error: unknown): string {
  if (typeof (error as { message?: unknown })?.message === 'string') return (error as { message: string }).message;
  return typeof error === 'string' ? error : '';
}

export function classifyAuthBootError(error: unknown): Exclude<AuthBootIssueKind, 'timeout'> {
  const name = errorName(error);
  const message = errorMessage(error);
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(message)) return 'storage-full';
  // 发布包里类名被压缩，认不得类名：登录库给这类错误都打了 isAcquireTimeout。
  if ((error as { isAcquireTimeout?: unknown })?.isAcquireTimeout === true || /lock\b.*(stole|steal|not released|immediately failed)/i.test(message)) return 'lock-stolen';
  // 靠抢锁拿到锁的标签页再被别人抢走时，登录库没有包这一层：抛出来的是浏览器原生的 AbortError
  //（Chrome：Lock broken by another request with the 'steal' option.）。启动期只有抢锁会产生它。
  if (name === 'AbortError') return 'lock-stolen';
  return 'error';
}

export function authBootReason(kind: AuthBootIssueKind, headroom?: StorageHeadroom): string {
  if (kind === 'lock-stolen') return '登录锁被另一个无知之幕标签页抢走了。把其它无知之幕标签页关掉，只留这一个再重试。';
  if (kind === 'storage-full') {
    // 只有确知「能清的都清了仍然不够」才这么说；其余情况位置已经腾出来了
    return headroom === 'full'
      ? '浏览器给本站的本地存储写满了，新的登录令牌存不进去；可重建的缓存与消息记录都已清掉，剩下的全是交易数据（见下方占用）。'
      : '浏览器给本站的本地存储写满了，新的登录令牌存不进去。可重建的缓存已经清掉腾出了位置，重试即可。';
  }
  if (kind === 'timeout') return `向登录服务刷新令牌已经等了 ${AUTH_BOOT_TIMEOUT_MS / 1000} 秒没有回应，多半是这个浏览器到登录服务的连接卡住了。页面还在等，回应一到会自动进入。`;
  return '恢复登录态时出错。';
}

/** 自动重载的名额：成功领到才可以重载；sessionStorage 不可用时一律不自动重载。 */
export function claimAuthBootAutoReload(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(AUTO_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < AUTH_BOOT_AUTO_RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(now));
    return sessionStorage.getItem(AUTO_RELOAD_KEY) === String(now);
  } catch {
    return false;
  }
}

export function reloadPage(): void {
  window.location.reload();
}

/**
 * 只清登录令牌：持仓、成交、日志的本地数据按用户 id 分区存放，重新登录同一账号后原样接上。
 *
 * 令牌是同源各标签页共用的。直接删掉它，别的正在交易的标签页收不到任何登录事件，却会从下一次读写起
 * 认不出自己是谁（用户 id 取自这个键）：状态写进匿名分区、不再推云，等令牌回来又被删令牌之前的旧值盖回。
 * 所以先在登录库自己的跨标签通道上发一条退出——别的标签页照正常退出处理（回到登录页、卸掉交易界面），再删令牌。
 */
export function forgetStoredSession(): number {
  let removed = 0;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!AUTH_TOKEN_KEY.test(key)) continue;
      if (AUTH_SESSION_KEY.test(key)) announceSignOut(key);
      localStorage.removeItem(key);
      removed += 1;
    }
  } catch { /* 存储不可用时没有令牌可清，重载后自然回到登录页。 */ }
  return removed;
}

/** 登录库的跨标签通道以令牌键命名，消息就是它自己退出时发的那一条。 */
function announceSignOut(storageKey: string): void {
  try {
    const channel = new BroadcastChannel(storageKey);
    channel.postMessage({ event: 'SIGNED_OUT', session: null });
    channel.close();
  } catch { /* 没有 BroadcastChannel 的环境里也就没有别的标签页在听。 */ }
}

function megabytes(chars: number): string {
  return `${(chars / 1024 / 1024).toFixed(2)} MB`;
}

function minutes(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  return total >= 60 ? `${Math.floor(total / 60)} 小时 ${total % 60} 分钟` : `${total} 分钟`;
}

function storedTokenState(now: number): string {
  try {
    const key = Object.keys(localStorage).find(candidate => AUTH_SESSION_KEY.test(candidate));
    if (!key) return '本机没有';
    const expiresAt = Number((JSON.parse(localStorage.getItem(key) ?? 'null') as { expires_at?: unknown } | null)?.expires_at);
    if (!Number.isFinite(expiresAt)) return '有，读不出到期时刻';
    const remaining = expiresAt * 1000 - now;
    return remaining > 0 ? `有效，还有 ${minutes(remaining)}到期` : `已过期 ${minutes(-remaining)}，需要刷新`;
  } catch {
    return '读不出';
  }
}

function storageUsage(): string {
  try {
    let chars = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) chars += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    const caches = measureRebuildableCaches();
    return `${megabytes(chars)}（其中可重建缓存 ${megabytes(caches.chars)} / ${caches.entries} 项）`;
  } catch {
    return '读不出';
  }
}

const HEADROOM_TEXT: Record<StorageHeadroom, string> = {
  ok: '写得下登录令牌',
  reclaimed: '清掉缓存后写得下登录令牌',
  full: '写不下登录令牌，且已没有可清理的缓存',
  unavailable: '浏览器不允许本站写本地存储',
};

/** 「成交历史 3.21 MB · 撤单快照 0.84 MB」：是什么把存储占满的。 */
export function storageUsageBreakdown(): string {
  const { categories } = describeStorageUsage();
  return categories.length ? categories.map(item => `${item.label} ${megabytes(item.chars)}`).join(' · ') : '空';
}

async function authLockState(): Promise<string> {
  try {
    const snapshot = await navigator.locks.query();
    const mine = (lock: { name?: string }) => (lock.name ?? '').startsWith('lock:sb-');
    return `持有 ${(snapshot.held ?? []).filter(mine).length} · 排队 ${(snapshot.pending ?? []).filter(mine).length}`;
  } catch {
    return '读不出';
  }
}

/**
 * 一屏截图就能定因的现场读数。探余量会顺手清掉可重建缓存：调用方已经探过（并清过）时把那次结果传进来，
 * 不然这里再探一次只会得到「写得下」，把「刚清过」误报成「本来就够」。
 */
export async function collectAuthBootDiagnostics(error?: unknown, now: number = Date.now(), knownHeadroom?: StorageHeadroom): Promise<{ diagnostics: AuthBootDiagnostic[]; headroom: StorageHeadroom }> {
  const headroom = knownHeadroom ?? ensureCriticalStorageHeadroom();
  const diagnostics: AuthBootDiagnostic[] = [
    { label: '版本', value: BUILD_STAMP },
    { label: '网络', value: typeof navigator !== 'undefined' && navigator.onLine === false ? '浏览器报告离线' : '在线' },
    { label: '登录令牌', value: storedTokenState(now) },
    { label: '登录锁', value: await authLockState() },
    { label: '本地存储', value: storageUsage() },
    { label: '占用最大', value: storageUsageBreakdown() },
    { label: '存储余量', value: HEADROOM_TEXT[headroom] },
  ];
  if (error !== undefined) {
    const text = [errorName(error), errorMessage(error)].filter(Boolean).join('：');
    diagnostics.push({ label: '错误', value: text || String(error) });
  }
  return { diagnostics, headroom };
}
