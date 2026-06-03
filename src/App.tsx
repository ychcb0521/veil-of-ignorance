import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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
import CognitiveAssetsPage from "./pages/CognitiveAssetsPage.tsx";
import ExecutionAssetsPage from "./pages/ExecutionAssetsPage.tsx";
import GuidePage from "./pages/GuidePage.tsx";
import NotFound from "./pages/NotFound.tsx";
import { MandatoryRuleQueueRoot } from "./components/journal/MandatoryRuleQueueRoot.tsx";

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, profile, loading } = useAuth();

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

  // Not authenticated or email not confirmed → auth page
  if (!user || !user.email_confirmed_at) {
    return (
      <Routes>
        <Route path="*" element={<AuthPage />} />
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
