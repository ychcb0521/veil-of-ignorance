/**
 * OAuth consent page for the app's MCP server (Supabase OAuth 2.1).
 * Route: /.lovable/oauth/consent
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from '@/components/ui/button';

// Minimal typed wrapper — supabase.auth.oauth is beta and not always in types.
type OAuthShim = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
function oauth(): OAuthShim {
  return (supabase.auth as unknown as { oauth: OAuthShim }).oauth;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const { user, loading, signOut } = useAuth();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    setError(null);
    setDetails(null);
    setActionError(null);
    let active = true;
    (async () => {
       if (!authorizationId) return setError("此连接请求无效，请从 AI 助手重新发起连接。");
      if (!user) {
        // Not signed in — the outer AppRoutes will render AuthPage on this
        // URL; after sign-in the URL is preserved and this component renders.
        return;
      }
      try {
        const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) return setError('连接请求无效、已过期或暂时无法加载，请从 AI 助手重新发起连接。');
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        if (!data?.client) return setError('无法识别请求连接的应用，请重新发起连接。');
        setDetails(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? "无法加载授权详情");
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId, user, loading]);

  async function decide(approve: boolean) {
    if (busy || !user || !details || !authorizationId) return;
    setBusy(true);
    setActionError(null);
    try {
      const { data, error } = approve
        ? await oauth().approveAuthorization(authorizationId)
        : await oauth().denyAuthorization(authorizationId);
      if (error) {
        setBusy(false);
        return setActionError(approve ? '未能允许连接，请重试。' : '未能取消连接，请重试。');
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        return setActionError("未收到连接完成地址，请重试。");
      }
      window.location.href = target;
    } catch (e: any) {
      setBusy(false);
      setActionError("暂时无法完成连接，请重试。");
    }
  }

  if (loading || (!user && !error)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground font-mono">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 space-y-3">
          <h1 className="text-lg font-semibold text-foreground">无法加载授权请求</h1>
          <p role="alert" className="text-sm text-muted-foreground break-words">{error}</p>
        </div>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground font-mono">加载授权详情中...</p>
      </div>
    );
  }

  const clientName = details.client?.name ?? details.client?.client_name ?? "外部应用";
  const redirectUri = details.redirect_uri ?? details.client?.redirect_uri;
  const scope = details.granted_scope ?? details.scope ?? details.scopes ?? '';
  const scopes: string[] = Array.isArray(scope) ? scope : typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : [];
  const labels: Record<string, string> = { openid: '确认你的账户身份', email: '分享你的邮箱地址', profile: '分享你的基本资料' };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 space-y-5">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">
            将 <span className="text-primary break-words">{clientName}</span> 连接到无知之幕
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {clientName} 将以你的身份读取账户资料、错题集、错题标签和交易规则，不能修改或删除这些内容。
          </p>
          {user?.email && (
            <p className="text-xs text-muted-foreground">当前账户：{user.email}</p>
          )}
          {redirectUri && <p className="text-xs text-muted-foreground break-all">连接返回地址：{redirectUri}</p>}
          {scopes.length > 0 && <ul className="text-sm text-foreground space-y-1">{scopes.map(s => <li key={s}>{labels[s] ?? `额外请求的权限：${s}`}</li>)}</ul>}
          <p className="text-xs text-muted-foreground">仅可访问你有权查看的数据，现有账户权限保持不变。</p>
          <Button variant="link" size="sm" className="px-0" disabled={busy} onClick={() => void signOut()}>切换账户</Button>
        </div>
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1"
          >
            {busy ? "处理中..." : "允许"}
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            variant="outline"
            className="flex-1"
          >
            取消连接
          </Button>
        </div>
      </div>
    </div>
  );
}
