import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { hydrateSimState } from "@/lib/simStateSync";
import { toast } from "sonner";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TradingProvider } from "@/contexts/TradingContext";
import Index from "./pages/Index.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import OnboardingPage from "./pages/OnboardingPage.tsx";
import JournalTagsPage from "./pages/JournalTagsPage.tsx";
import JournalListPage from "./pages/JournalListPage.tsx";
import JournalPlaybackPage from "./pages/JournalPlaybackPage.tsx";
import JournalInsightsPage from "./pages/JournalInsightsPage.tsx";
import JournalRulesPage from "./pages/JournalRulesPage.tsx";
import JournalCampaignsPage from "./pages/JournalCampaignsPage.tsx";
import JournalCampaignDetailPage from "./pages/JournalCampaignDetailPage.tsx";
import JournalCampaignClassifyPage from "./pages/JournalCampaignClassifyPage.tsx";
import JournalEmotionDiaryPage from "./pages/JournalEmotionDiaryPage.tsx";
import CognitiveAssetsPage from "./pages/CognitiveAssetsPage.tsx";
import ExecutionAssetsPage from "./pages/ExecutionAssetsPage.tsx";
import GuidePage from "./pages/GuidePage.tsx";
import NotFound from "./pages/NotFound.tsx";
import OAuthConsent from "./pages/OAuthConsent.tsx";
import { MandatoryRuleQueueRoot } from "./components/journal/MandatoryRuleQueueRoot.tsx";

const queryClient = new QueryClient();

/**
 * 登录后、交易组件树挂载前，把云端的引擎状态镜像水化回 localStorage。
 * 换浏览器登录同一账号时，持仓 / 成交历史 / 挂单 / 余额 / 各币时间线 / 信号库
 * 由此恢复；水化必须先于 TradingProvider——它的各 usePersistedState 在首次
 * render 就从 localStorage 取初值，晚了就只能读到空。
 * 失败或超时（4s）直接放行：离线也要能交易，同步永远不阻塞使用。
 */
function useSimStateHydration(userId: string | null | undefined): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const timeout = setTimeout(() => { if (!cancelled) setReady(true); }, 4000);
    hydrateSimState(userId).then((result) => {
      // 云端存档没建起来时必须让人看见——静默降级正是「换浏览器数据全没了」
      // 的成因，绝不能再悄悄发生。每个会话只提示一次。
      if (result.status === 'table-missing' && !cancelled) {
        toast.warning('云端存档未启用：交易数据目前只存在本浏览器', {
          description: '换浏览器或换电脑将看不到这些记录。需要在 Supabase 执行一次建表 SQL（见仓库 SETUP_云端存档.md）。',
          duration: 12_000,
        });
      }
    }).finally(() => {
      clearTimeout(timeout);
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [userId]);
  return !userId || ready;
}

function AppRoutes() {
  const { user, profile, loading } = useAuth();
  const simStateReady = useSimStateHydration(user?.id);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: '#0B0E11' }}>
        <div className="text-center space-y-3">
          <div className="text-3xl animate-pulse">⚡</div>
          <p className="text-sm text-muted-foreground font-mono">加载中...</p>
        </div>
      </div>
    );
  }

  const isConsentRoute =
    typeof window !== 'undefined' && window.location.pathname === '/.lovable/oauth/consent';

  // Not authenticated or email not confirmed → auth page (URL is preserved,
  // so after sign-in the consent route below matches automatically).
  if (!user || !user.email_confirmed_at) {
    return (
      <Routes>
        <Route path="*" element={<AuthPage />} />
      </Routes>
    );
  }

  // OAuth consent must be reachable even before onboarding — it belongs to
  // the auth surface, not the app shell.
  if (isConsentRoute) {
    return (
      <Routes>
        <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
      </Routes>
    );
  }

  // Authenticated but not initialized → onboarding
  if (profile && !profile.is_initialized) {
    return (
      <Routes>
        <Route path="*" element={<OnboardingPage />} />
      </Routes>
    );
  }

  // 云端引擎状态尚未水化完成 → 与 auth 同款加载屏。
  // 常驻浏览器几乎瞬时（本地已有数据，比较后放行）；新浏览器等一次全量拉取。
  if (!simStateReady) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: '#0B0E11' }}>
        <div className="text-center space-y-3">
          <div className="text-3xl animate-pulse">⚡</div>
          <p className="text-sm text-muted-foreground font-mono">同步账号数据...</p>
        </div>
      </div>
    );
  }

  // Fully initialized → main app
  return (
    <TradingProvider>
      <MandatoryRuleQueueRoot />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/journal" element={<JournalListPage />} />
        <Route path="/journal/tags" element={<JournalTagsPage />} />
        <Route path="/journal/rules" element={<JournalRulesPage />} />
        <Route path="/journal/insights" element={<JournalInsightsPage />} />
        <Route path="/journal/emotion-diary" element={<JournalEmotionDiaryPage />} />
        <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
        <Route path="/journal/campaigns/classify" element={<JournalCampaignClassifyPage />} />
        <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        <Route path="/journal/:id" element={<JournalPlaybackPage />} />
        <Route path="/execution-assets" element={<ExecutionAssetsPage />} />
        <Route path="/cognitive-assets" element={<CognitiveAssetsPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </TradingProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
