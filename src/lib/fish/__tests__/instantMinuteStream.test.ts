import { expect, it, vi } from 'vitest';
import { instantMinuteOpening, watchInstantMinuteStreams } from '../instantMinuteStream';

it('wakes on the first trade or close and isolates the opening price by market and minute', () => {
  const at = 60_000, wake = vi.fn();
  let socket: { onmessage?: (event: { data: string }) => void; close: () => void };
  vi.stubGlobal('WebSocket', class { constructor() { socket = this; } close() {} });
  const stop = watchInstantMinuteStreams(['SEIUSDT'], wake);
  const send = (s: string, n: number, x = false) => socket.onmessage!({ data: JSON.stringify({
    data: { e: 'kline', s, k: { s, t: at, T: at + 59_999, i: '1m', n, o: '0.03791', x } },
  }) });
  try {
    send('BTCUSDT', 1); send('SEIUSDT', 0);
    expect(wake).not.toHaveBeenCalled();
    send('SEIUSDT', 1); send('SEIUSDT', 2); send('SEIUSDT', 3, true);
    expect(wake).toHaveBeenCalledTimes(2);
    expect(instantMinuteOpening('SEIUSDT', at)).toBe(0.03791);
    expect(instantMinuteOpening('SEIUSDT', at + 60_000)).toBeUndefined();
  } finally { stop(); vi.unstubAllGlobals(); }
  expect(instantMinuteOpening('SEIUSDT', at)).toBeUndefined();
});
