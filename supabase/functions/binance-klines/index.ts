import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://veil-of-ignorance.lovable.app',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const intervals = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
const userWindows = new Map<string, { startedAt: number; count: number }>();

const cors = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});
const json = (body: unknown, status: number, origin: string) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(origin), 'Content-Type': 'application/json' },
});

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? '';
  if (!allowedOrigins.has(origin)) return new Response('Forbidden origin', { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Authentication required' }, 401, origin);
  const auth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user) return json({ error: 'Invalid session' }, 401, origin);

  const now = Date.now();
  const window = userWindows.get(user.id);
  const current = !window || now - window.startedAt >= 60_000 ? { startedAt: now, count: 0 } : window;
  if (current.count >= 120) return json({ error: 'Fallback rate limit exceeded' }, 429, origin);
  current.count += 1;
  userWindows.set(user.id, current);

  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }
  const symbol = String(input.symbol ?? '').toUpperCase();
  const interval = String(input.interval ?? '');
  const startTime = Number(input.startTime);
  const endTime = Number(input.endTime);
  const limit = Math.min(1_500, Math.max(1, Math.trunc(Number(input.limit) || 1_500)));
  if (!/^[A-Z0-9]{5,24}$/.test(symbol) || !intervals.has(interval)
    || !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime <= startTime) {
    return json({ error: 'Invalid K-line parameters' }, 400, origin);
  }

  const params = new URLSearchParams({ symbol, interval, startTime: String(Math.trunc(startTime)), endTime: String(Math.trunc(endTime)), limit: String(limit) });
  try {
    const upstream = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...cors(origin), 'Content-Type': upstream.headers.get('content-type') ?? 'application/json', 'Cache-Control': upstream.ok ? 'private, max-age=300' : 'no-store' },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Upstream unavailable' }, 502, origin);
  }
});
