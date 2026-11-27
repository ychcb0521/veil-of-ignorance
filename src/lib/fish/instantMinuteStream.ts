const MINUTE = 60_000;
const openings = new Map<string, { at: number; price: number }>();

export function instantMinuteOpening(symbol: string, at: number) {
  const opening = openings.get(symbol);
  return opening?.at === at ? opening.price : undefined;
}

/** Wake once the exchange minute-close grace has elapsed, independently of polling phase. */
export function watchMinuteBoundary(wake: () => void, grace: number) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => { wake(); schedule(); }, MINUTE - Date.now() % MINUTE + grace);
  };
  schedule();
  return () => clearTimeout(timer);
}

/** Wake on market messages, independently of browser timer alignment. */
export function watchInstantMinuteStreams(symbols: string[], wake: () => void) {
  const watched = new Set(symbols);
  const streams = symbols.map(symbol => encodeURIComponent(symbol.toLowerCase()) + '@kline_1m').join('/');
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let backoff = 1000;
  const reconnect = () => {
    if (stopped) return;
    retry = setTimeout(connect, backoff);
    backoff = Math.min(60_000, backoff * 2);
  };
  const connect = () => {
    try { socket = new WebSocket('wss://fstream.binance.com/market/stream?streams=' + streams); }
    catch { reconnect(); return; }
    socket.onmessage = event => {
      if (stopped || typeof event.data !== 'string') return;
      let data;
      try { data = JSON.parse(event.data)?.data; } catch { return; }
      const k = data?.k;
      if (!k || data.e !== 'kline' || !watched.has(data.s) || k.s !== data.s || k.i !== '1m'
        || !Number.isSafeInteger(k.t) || k.t % MINUTE !== 0 || k.T !== k.t + MINUTE - 1) return;
      backoff = 1000;
      const price = Number(k.o);
      const last = openings.get(data.s);
      if (Number(k.n) > 0 && price > 0 && Number.isFinite(price) && (!last || last.at < k.t)) {
        openings.set(data.s, { at: k.t, price });
        wake();
      } else if (k.x === true) wake();
    };
    socket.onclose = reconnect;
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    if (socket) { socket.onclose = null; socket.close(); }
    for (const symbol of symbols) openings.delete(symbol);
  };
}
