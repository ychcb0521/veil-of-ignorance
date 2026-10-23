import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), messages: [] as any[], worker: undefined as any }));
vi.mock('@/lib/avgHighlightStorage', () => ({ readAvgCache: mocks.read, writeAvgCache: mocks.write }));
vi.mock('@/lib/signalLibrary', async original => ({ ...await original() as object, loadSignals: () => Array.from({length: 30}, (_, i) => ({id: String(i),symbol: `TEST${i}USDT`,quality: 5,timeMs:i,timeLabel:'',fallbackZone:''})) }));
beforeEach(() => {
  vi.resetModules(); mocks.messages.length = 0; mocks.read.mockResolvedValue(undefined); mocks.write.mockResolvedValue(undefined);
  vi.stubGlobal('Worker', class { onmessage: any; onerror: any; constructor() { mocks.worker = this; } postMessage(message: any) { mocks.messages.push(message); } });
});
it('requests a cache miss only once; caches the result and separates window and averaging kind', async () => {
  const client = await import('../avgHighlightClient');
  const context = () => client.avgCalibrationContext('state',24,36,'avg');
  context(); context();
  await vi.waitFor(() => expect(mocks.messages).toHaveLength(1));
  const limits = {lower:.4,upper:.6,d:.1,count:100,above:.2,below:.2};
  mocks.worker.onmessage({data:{key:mocks.messages[0].key,limits}});
  expect(context().limits).toEqual(limits);
  context(); expect(mocks.messages).toHaveLength(1);
  client.avgCalibrationContext('state',24,36,'avg2');
  await vi.waitFor(() => expect(mocks.messages).toHaveLength(2));
  client.avgCalibrationContext('state',24,48,'avg');
  await vi.waitFor(() => expect(mocks.messages).toHaveLength(3));
  vi.unstubAllGlobals();
});
