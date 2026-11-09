import { afterEach, expect, it, vi } from 'vitest';
import { screeningTimeSlice, yieldScreening } from '../screeningYield';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('does not schedule a wait for every cheap minute and resets the budget after yielding', async () => {
  vi.useFakeTimers(); vi.stubGlobal('MessageChannel', undefined);
  let at = 0; vi.spyOn(performance, 'now').mockImplementation(() => at);
  const slice = screeningTimeSlice(new AbortController().signal);
  for (let i = 0; i < 1000; i++) expect(slice()).toBeUndefined();
  at = 13; const yielding = slice(); expect(yielding).toBeInstanceOf(Promise);
  await vi.runAllTimersAsync(); await yielding;
  expect(slice()).toBeUndefined();
});
it.each([false, true])('closes both message ports and removes the abort listener (abort=%s)', async aborted => {
  const close1 = vi.fn(), close2 = vi.fn(); let deliver!: () => void;
  class Channel {
    port1 = { close: close1, onmessage: undefined as (() => void) | undefined };
    port2 = { close: close2, postMessage: () => { deliver = () => this.port1.onmessage?.(); } };
  }
  vi.stubGlobal('MessageChannel', Channel);
  const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = yieldScreening(controller.signal);
  const checked = aborted ? expect(pending).rejects.toMatchObject({ name: 'AbortError' }) : expect(pending).resolves.toBeUndefined();
  if (aborted) controller.abort(); else deliver();
  await checked; deliver();
  expect(close1).toHaveBeenCalledOnce(); expect(close2).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
});
it('honors an already requested pause before creating any channel', async () => {
  const create = vi.fn(); vi.stubGlobal('MessageChannel', create);
  const controller = new AbortController(); controller.abort();
  await expect(yieldScreening(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(create).not.toHaveBeenCalled();
});
