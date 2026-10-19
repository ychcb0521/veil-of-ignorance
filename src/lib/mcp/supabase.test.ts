import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@lovable.dev/mcp-js';
const createClient = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ mocked: true })));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import { supabaseForUser } from './supabase';

const caller = { isAuthenticated: () => true, getToken: () => 'synthetic-test-token', getUserId: () => 'test-caller' } as unknown as ToolContext;
afterEach(() => { vi.unstubAllEnvs(); createClient.mockClear(); });
describe('MCP caller-scoped database factory', () => {
  it('uses edge public key dictionaries and the verified caller header', () => {
    vi.stubEnv('SUPABASE_URL', 'https://database.invalid');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEYS', '{"default":"sb_publishable_test"}');
    supabaseForUser(caller);
    expect(createClient).toHaveBeenCalledWith('https://database.invalid', 'sb_publishable_test', {
      global: { headers: { Authorization: 'Bearer synthetic-test-token' } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });
  it('falls back to the legacy public key with a malformed dictionary', () => {
    vi.stubEnv('SUPABASE_URL', 'https://database.invalid');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEYS', 'malformed');
    vi.stubEnv('SUPABASE_ANON_KEY', 'test-public-key');
    supabaseForUser(caller);
    expect(createClient.mock.calls[0]?.[1]).toBe('test-public-key');
  });
  it('never creates an anonymous fallback for an unverified caller', () => {
    expect(() => supabaseForUser({ ...caller, isAuthenticated: () => false } as unknown as ToolContext)).toThrow('verified OAuth caller');
    expect(createClient).not.toHaveBeenCalled();
  });
});