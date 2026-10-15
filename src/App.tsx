import { lazy } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { useSimStateHydration } from "@/hooks/useSimStateHydration";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TradingProvider } from "@/contexts/TradingContext";
import { RouteLoadBoundary } from './components/RouteLoadBoundary';
const Index = lazy(() => import('./pages/Index.tsx'));
const AuthPage = lazy(() => import('./pages/AuthPage.tsx'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage.tsx'));
const JournalTagsPage = lazy(() => import('./pages/JournalTagsPage.tsx'));
const JournalListPage = lazy(() => import('./pages/JournalListPage.tsx'));
const JournalPlaybackPage = lazy(() => import('./pages/JournalPlaybackPage.tsx'));
const JournalInsightsPage = lazy(() => import('./pages/JournalInsightsPage.tsx'));
const JournalRulesPage = lazy(() => import('./pages/JournalRulesPage.tsx'));
const JournalDeepRsaPage = lazy(() => import('./pages/JournalDeepRsaPage.tsx'));
const JournalCampaignsPage = lazy(() => import('./pages/JournalCampaignsPage.tsx'));
const JournalCampaignDetailPage = lazy(() => import('./pages/JournalCampaignDetailPage.tsx'));
const JournalCampaignClassifyPage = lazy(() => import('./pages/JournalCampaignClassifyPage.tsx'));
const JournalEmotionDiaryPage = lazy(() => import('./pages/JournalEmotionDiaryPage.tsx'));
const CognitiveAssetsPage = lazy(() => import('./pages/CognitiveAssetsPage.tsx'));
const ExecutionAssetsPage = lazy(() => import('./pages/ExecutionAssetsPage.tsx'));
const GuidePage = lazy(() => import('./pages/GuidePage.tsx'));
import NotFound from "./pages/NotFound.tsx";
const OAuthConsent = lazy(() => import('./pages/OAuthConsent.tsx'));
import { MandatoryRuleQueueRoot } from "./components/journal/MandatoryRuleQueueRoot.tsx";
import { AuthBootRecoveryScreen } from "./components/AuthBootRecoveryScreen.tsx";

const queryClient = new QueryClient();

function AppRoutes() {
  const location = useLocation();
  const { user, profile, loading, bootIssue } = useAuth();
  const simStateReady = useSimStateHydration(user?.id);

  if (loading) {
    // 登录态恢复不出来时不再只转圈：摆出原因、出路与现场读数。
    if (bootIssue) return <AuthBootRecoveryScreen issue={bootIssue} />;
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
      <RouteLoadBoundary key={location.pathname}><Routes>
        <Route path="*" element={<AuthPage />} />
      </Routes></RouteLoadBoundary>
    );
  }

  // OAuth consent must be reachable even before onboarding — it belongs to
  // the auth surface, not the app shell.
  if (isConsentRoute) {
    return (
      <RouteLoadBoundary key={location.pathname}><Routes>
        <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
      </Routes></RouteLoadBoundary>
    );
  }

  // Authenticated but not initialized → onboarding
  if (profile && !profile.is_initialized) {
    return (
      <RouteLoadBoundary key={location.pathname}><Routes>
        <Route path="*" element={<OnboardingPage />} />
      </Routes></RouteLoadBoundary>
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
      <RouteLoadBoundary key={location.pathname}><Routes>
        <Route path="/" element={<Index />} />
        <Route path="/journal" element={<JournalListPage />} />
        <Route path="/journal/tags" element={<JournalTagsPage />} />
        <Route path="/journal/rules" element={<JournalRulesPage />} />
        <Route path="/journal/deep-rsa" element={<JournalDeepRsaPage />} />
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
      </Routes></RouteLoadBoundary>
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
