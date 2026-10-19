import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const oauth = vi.hoisted(() => ({ getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { oauth } } }));
vi.mock('@/contexts/AuthContext', () => {
  const state = { user: { id: 'test-user', email: 'test@example.invalid' }, loading: false, signOut: vi.fn() };
  return { useAuth: () => state };
});
import OAuthConsent from '../OAuthConsent';

const mount = (path = '/.lovable/oauth/consent?authorization_id=test-request') => render(<MemoryRouter initialEntries={[path]}><OAuthConsent /></MemoryRouter>);
beforeEach(() => {
  Object.values(oauth).forEach(fn => fn.mockReset());
  oauth.getAuthorizationDetails.mockResolvedValue({ data: { client: { name: 'Test assistant' }, redirect_uri: 'https://assistant.invalid/callback', scope: 'openid email profile' }, error: null });
});
afterEach(cleanup);

describe('OAuth consent boundaries and recovery', () => {
  it('does not query the provider without an authorization ID', async () => {
    mount('/.lovable/oauth/consent');
    await screen.findByRole('alert');
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
  });
  it('queries the exact authorization ID and keeps approve failure retryable', async () => {
    oauth.approveAuthorization.mockResolvedValue({ data: null, error: { message: 'failed' } });
    mount();
    const approve = await screen.findByRole('button', { name: '允许' });
    expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith('test-request');
    fireEvent.click(approve);
    await screen.findByRole('alert');
    expect(oauth.approveAuthorization).toHaveBeenCalledWith('test-request');
    expect(approve).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '取消连接' })).not.toBeDisabled();
  });
  it('uses deny rather than approve and permits a retry after provider failure', async () => {
    oauth.denyAuthorization.mockRejectedValue(new Error('provider unavailable'));
    mount();
    const deny = await screen.findByRole('button', { name: '取消连接' });
    fireEvent.click(deny);
    await screen.findByRole('alert');
    expect(oauth.denyAuthorization).toHaveBeenCalledWith('test-request');
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(deny).not.toBeDisabled();
  });
  it('invalid or expired IDs cannot reach the approval controls', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: null, error: { message: 'expired' } });
    mount();
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '允许' })).toBeNull();
  });
});