/**
 * Auth Context — Supabase Auth integration
 * Provides user session, profile, and auth state to the entire app.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

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
  devAuthEnabled: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  initializeAccount: (capital: number) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const DEV_AUTH_USERS_KEY = 'veil_dev_auth_users_v1';
const DEV_AUTH_SESSION_KEY = 'veil_dev_auth_session_v1';

interface DevAuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  profile: Profile;
}

function isDevAuthEnabled() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function hashPassword(password: string) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function readDevUsers(): DevAuthUserRecord[] {
  try {
    const raw = localStorage.getItem(DEV_AUTH_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeDevUsers(users: DevAuthUserRecord[]) {
  localStorage.setItem(DEV_AUTH_USERS_KEY, JSON.stringify(users));
}

function getDevUserByEmail(email: string) {
  const normalized = normalizeEmail(email);
  return readDevUsers().find(record => record.email === normalized) ?? null;
}

function getDevUserById(id: string) {
  return readDevUsers().find(record => record.id === id) ?? null;
}

function makeDevUser(record: DevAuthUserRecord): User {
  return {
    id: record.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: record.email,
    email_confirmed_at: record.createdAt,
    confirmed_at: record.createdAt,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'dev-local', providers: ['dev-local'] },
    user_metadata: {},
    identities: [],
    created_at: record.createdAt,
    updated_at: new Date().toISOString(),
  } as User;
}

function makeDevSession(record: DevAuthUserRecord): Session {
  return {
    access_token: `dev-local-token-${record.id}`,
    refresh_token: `dev-local-refresh-${record.id}`,
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    user: makeDevUser(record),
  } as Session;
}

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
  const devAuthEnabled = isDevAuthEnabled();

  const applyDevAuth = useCallback((record: DevAuthUserRecord) => {
    const nextSession = makeDevSession(record);
    localStorage.setItem(DEV_AUTH_SESSION_KEY, record.id);
    setSession(nextSession);
    setUser(nextSession.user);
    setProfile(record.profile);
  }, []);

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
    if (devAuthEnabled) {
      if (!user) return;
      const record = getDevUserById(user.id);
      setProfile(record?.profile ?? null);
      return;
    }
    if (user) await fetchProfile(user.id);
  }, [devAuthEnabled, user, fetchProfile]);

  // Set up auth listener BEFORE getSession
  useEffect(() => {
    if (devAuthEnabled) {
      const activeUserId = localStorage.getItem(DEV_AUTH_SESSION_KEY);
      const record = activeUserId ? getDevUserById(activeUserId) : null;
      if (record) {
        applyDevAuth(record);
      } else {
        localStorage.removeItem(DEV_AUTH_SESSION_KEY);
      }
      setLoading(false);
      return;
    }

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

    // Then get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [devAuthEnabled, applyDevAuth, fetchProfile]);

  const signUp = useCallback(async (email: string, password: string) => {
    if (devAuthEnabled) {
      const normalizedEmail = normalizeEmail(email);
      if (password.length < 6) return { error: 'Password should be at least 6 characters' };

      const users = readDevUsers();
      if (users.some(record => record.email === normalizedEmail)) {
        return { error: 'User already registered' };
      }

      const now = new Date().toISOString();
      const userId = crypto.randomUUID();
      const record: DevAuthUserRecord = {
        id: userId,
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        createdAt: now,
        profile: {
          id: crypto.randomUUID(),
          user_id: userId,
          initial_capital: 100000,
          is_initialized: false,
          display_name: null,
        },
      };

      writeDevUsers([...users, record]);
      applyDevAuth(record);
      return { error: null };
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  }, [devAuthEnabled, applyDevAuth]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (devAuthEnabled) {
      const record = getDevUserByEmail(email);
      if (!record || record.passwordHash !== await hashPassword(password)) {
        return { error: 'Invalid login credentials' };
      }

      applyDevAuth(record);
      return { error: null };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, [devAuthEnabled, applyDevAuth]);

  const signOut = useCallback(async () => {
    if (devAuthEnabled) {
      localStorage.removeItem(DEV_AUTH_SESSION_KEY);
      setUser(null);
      setSession(null);
      setProfile(null);
      return;
    }

    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  }, [devAuthEnabled]);

  const initializeAccount = useCallback(async (capital: number) => {
    if (!user) return false;
    if (devAuthEnabled) {
      const users = readDevUsers();
      const index = users.findIndex(record => record.id === user.id);
      if (index < 0) return false;

      const nextProfile: Profile = {
        ...users[index].profile,
        initial_capital: capital,
        is_initialized: true,
      };
      users[index] = { ...users[index], profile: nextProfile };
      writeDevUsers(users);
      setProfile(nextProfile);
      return true;
    }

    const { error } = await supabase
      .from('profiles')
      .update({ initial_capital: capital, is_initialized: true })
      .eq('user_id', user.id);
    if (!error) {
      setProfile(prev => prev ? { ...prev, initial_capital: capital, is_initialized: true } : prev);
      return true;
    }
    return false;
  }, [devAuthEnabled, user]);

  return (
    <AuthContext.Provider value={{
      user, session, profile, loading, devAuthEnabled,
      signUp, signIn, signOut,
      initializeAccount, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
