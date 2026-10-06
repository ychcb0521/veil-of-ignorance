/**
 * Auth Context — Supabase Auth integration
 * Provides user session, profile, and auth state to the entire app.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { setActiveSyncUser } from '@/lib/simStateSync';
import { ensureCriticalStorageHeadroom } from '@/lib/persistedStateStorage';
import {
  AUTH_BOOT_TIMEOUT_MS, authBootReason, claimAuthBootAutoReload, classifyAuthBootError,
  collectAuthBootDiagnostics, reloadPage, type AuthBootIssue, type AuthBootIssueKind,
} from '@/lib/authBootRecovery';

interface Profile {
  id: string;
  user_id: string;
  initial_capital: number;
  is_initialized: boolean;
  display_name: string | null;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** 登录态没能恢复出来的原因；有值时 loading 可能一直为 true，界面不能只转圈。 */
  bootIssue: AuthBootIssue | null;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  initializeAccount: (capital: number) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootIssue, setBootIssue] = useState<AuthBootIssue | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (data && !error) {
      setProfile(data as Profile);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  // Set up auth listener BEFORE getSession
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Use setTimeout to avoid Supabase deadlock
          setTimeout(() => fetchProfile(session.user.id), 0);
        } else {
          setProfile(null);
        }
      }
    );

    /**
     * getSession() 不保证返回：登录锁被别的标签页抢走、本地存储写满时它直接报错，
     * 刷新令牌的请求卡住时它一直不返回。三种都不能表现为无限的「加载中...」。
     */
    let active = true;
    let settled = false;
    const report = async (kind: AuthBootIssueKind, error?: unknown) => {
      const { diagnostics, headroom } = await collectAuthBootDiagnostics(error);
      // 读现场要等一拍：这期间登录态可能已经恢复，迟到的超时提示不能再盖上去。
      if (!active || (kind === 'timeout' && settled)) return;
      setBootIssue({ kind, reason: authBootReason(kind, headroom), diagnostics });
    };
    const watchdog = setTimeout(() => { if (!settled) void report('timeout'); }, AUTH_BOOT_TIMEOUT_MS);

    // Then get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      settled = true;
      clearTimeout(watchdog);
      setBootIssue(null);
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    }, (error: unknown) => {
      settled = true;
      clearTimeout(watchdog);
      if (!active) return;
      const kind = classifyAuthBootError(error);
      // 锁被抢之后这个客户端此后每次取登录态都会失败，只有重载才换得到新的客户端；
      // 存储写满则要先腾出位置，否则重载后令牌照样存不进去。各自动重载一次，再不行就摆出原因。
      const recoverable = kind === 'lock-stolen' || (kind === 'storage-full' && ensureCriticalStorageHeadroom() !== 'full');
      if (recoverable && claimAuthBootAutoReload()) {
        reloadPage();
        return;
      }
      void report(kind, error);
    });

    return () => {
      active = false;
      clearTimeout(watchdog);
      subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const attempt = async () => (await supabase.auth.signInWithPassword({ email, password })).error?.message ?? null;
    try {
      return { error: await attempt() };
    } catch (error) {
      // 令牌签发了却存不进本地存储时登录库直接抛错：不接住的话登录按钮会一直转圈。
      if (classifyAuthBootError(error) !== 'storage-full') return { error: error instanceof Error ? error.message : String(error) };
      if (ensureCriticalStorageHeadroom() === 'full') return { error: '浏览器给本站的本地存储已写满，登录令牌存不进去' };
      try {
        return { error: await attempt() };
      } catch (again) {
        return { error: again instanceof Error ? again.message : String(again) };
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    /**
     * 先把这个账号名下积压的云端推送冲刷干净、再解除归属。
     * 不解除的话，同一标签页换个账号登录时，页面隐藏 / 关闭那两个冲刷监听器
     * 仍会按**上一个人的 id** 推送——新账号的持仓与成交历史会覆盖掉旧账号的云端存档。
     */
    setActiveSyncUser(null);
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  }, []);

  const initializeAccount = useCallback(async (capital: number) => {
    if (!user) return false;
    const { error } = await supabase
      .from('profiles')
      .update({ initial_capital: capital, is_initialized: true })
      .eq('user_id', user.id);
    if (!error) {
      setProfile(prev => prev ? { ...prev, initial_capital: capital, is_initialized: true } : prev);
      return true;
    }
    return false;
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, session, profile, loading, bootIssue,
      signUp, signIn, signOut,
      initializeAccount, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
