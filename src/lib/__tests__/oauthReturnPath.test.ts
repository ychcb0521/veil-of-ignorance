import { afterEach, describe, expect, it } from 'vitest';
import { currentAuthReturnPath, oauthReturnPath } from '../oauth-return-path';

afterEach(() => window.history.replaceState({}, '', '/'));

describe('OAuth return boundary', () => {
  it('preserves consent ID, query and fragment', () => {
    const path = '/.lovable/oauth/consent?authorization_id=request-123#decision';
    expect(oauthReturnPath(path)).toBe(path);
    window.history.replaceState({}, '', path);
    expect(currentAuthReturnPath()).toBe(path);
  });
  it.each(['//outside.invalid', '/\\outside.invalid', 'https://outside.invalid', '/\nunsafe', '/\u0000unsafe', '/%2f/evil'])('rejects or canonicalizes unsafe paths: %s', path => {
    const result = oauthReturnPath(path);
    if (path === '/%2f/evil') expect(result).toBe('/%2f/evil');
    else expect(result).toBe('/');
  });
  it('consumes decoded next once', () => {
    window.history.replaceState({}, '', '/login?next=' + encodeURIComponent('/.lovable/oauth/consent?authorization_id=abc#approve'));
    expect(currentAuthReturnPath()).toBe('/.lovable/oauth/consent?authorization_id=abc#approve');
  });
});