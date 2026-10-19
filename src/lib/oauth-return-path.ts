export function oauthReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  const origin = 'https://app.invalid';
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname.startsWith('//')) return '/';
    return target.pathname + target.search + target.hash;
  } catch {
    return '/';
  }
}

/** Auth renders directly at protected URLs, so preserve the consent URL too. */
export function currentAuthReturnPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  if (next !== null) return oauthReturnPath(next);
  return window.location.pathname === '/.lovable/oauth/consent'
    ? oauthReturnPath(window.location.pathname + window.location.search + window.location.hash)
    : '/';
}