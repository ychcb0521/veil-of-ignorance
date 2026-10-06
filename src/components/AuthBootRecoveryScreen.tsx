import { forgetStoredSession, reloadPage, type AuthBootIssue } from '@/lib/authBootRecovery';

/** 登录态没恢复出来时替代「加载中...」：说清原因、给出两条出路，现场读数供截图。 */
export function AuthBootRecoveryScreen({ issue }: { issue: AuthBootIssue }) {
  const waiting = issue.kind === 'timeout';
  return (
    <div className="h-screen flex items-center justify-center bg-background px-4" data-testid="auth-boot-recovery" data-kind={issue.kind}>
      <div className="w-full max-w-md space-y-4 text-left">
        <div className="flex items-center gap-2">
          <span className={`text-xl ${waiting ? 'animate-pulse' : ''}`}>⚡</span>
          <h1 className="text-base font-medium text-foreground">{waiting ? '登录态还没恢复出来' : '登录态没能恢复'}</h1>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{issue.reason}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reloadPage}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => { forgetStoredSession(); reloadPage(); }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          >
            重新登录
          </button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          重新登录只清掉这台浏览器里的登录令牌（开着的其它无知之幕标签页会一并退出）；持仓、成交和日志都不动，登录同一个账号后原样接上。
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-3 font-mono text-xs">
          {issue.diagnostics.map(item => (
            <div key={item.label} className="contents">
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="break-all text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
