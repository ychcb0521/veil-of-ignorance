import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TradingProvider } from "@/contexts/TradingContext";
import Index from "./pages/Index.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import OnboardingPage from "./pages/OnboardingPage.tsx";
import NotFound from "./pages/NotFound.tsx";

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
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </TradingProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
