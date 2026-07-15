/**
 * OAuth consent page for the app's MCP server (Supabase OAuth 2.1).
 * Route: /.lovable/oauth/consent
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
  const { user, loading } = useAuth();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    let active = true;
    (async () => {
      if (!authorizationId) return setError("缺少 authorization_id 参数");
      if (!user) {
        // Not signed in — the outer AppRoutes will render AuthPage on this
        // URL; after sign-in the URL is preserved and this component renders.
        return;
      }
      try {
        const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) return setError(error.message);
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
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
    setBusy(true);
    setError(null);
    try {
      const { data, error } = approve
        ? await oauth().approveAuthorization(authorizationId)
        : await oauth().denyAuthorization(authorizationId);
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        return setError("授权服务器未返回跳转地址");
      }
      window.location.href = target;
    } catch (e: any) {
      setBusy(false);
      setError(e?.message ?? "授权失败");
    }
  }

  if (loading || (!user && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0B0E11" }}>
        <p className="text-sm text-muted-foreground font-mono">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0B0E11" }}>
        <div className="max-w-md w-full rounded-xl border border-border p-6 space-y-3" style={{ background: "hsl(var(--card))" }}>
          <h1 className="text-lg font-semibold text-foreground">无法加载授权请求</h1>
          <p className="text-sm text-muted-foreground break-words">{error}</p>
        </div>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0B0E11" }}>
        <p className="text-sm text-muted-foreground font-mono">加载授权详情中...</p>
      </div>
    );
  }

  const clientName = details.client?.name ?? details.client?.client_name ?? "外部应用";

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0B0E11" }}>
      <div className="max-w-md w-full rounded-xl border border-border p-6 space-y-5" style={{ background: "hsl(var(--card))" }}>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">
            允许 <span className="text-[#F0B90B]">{clientName}</span> 连接你的账户？
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            连接后，{clientName} 可通过 MCP 工具以你的身份读取错题集、错题标签、交易规则等数据（受行级安全策略保护，仅限你本人可见的内容）。
          </p>
          {user?.email && (
            <p className="text-xs text-muted-foreground">当前账户：{user.email}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 h-10 rounded bg-[#F0B90B] text-black text-sm font-medium hover:bg-[#F0B90B]/90 disabled:opacity-60"
          >
            {busy ? "处理中..." : "允许"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 h-10 rounded border border-border text-sm text-foreground hover:bg-muted disabled:opacity-60"
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
