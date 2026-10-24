import { expect, it, vi } from 'vitest';
import { averageAreaColor, drawAverageArea } from '../drawAverageArea';

const scale = { center: 0, lower: -1, upper: 1 };
function drawing(values: (number | null)[]) {
  const gradients: { stops: [number, string][]; addColorStop: ReturnType<typeof vi.fn> }[] = [];
  const context = () => ({
    createLinearGradient: vi.fn(() => {
      const stops: [number, string][] = [];
      const gradient = { stops, addColorStop: vi.fn((at: number, color: string) => stops.push([at, color])) };
      gradients.push(gradient); return gradient;
    }),
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    setLineDash: vi.fn(), drawImage: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
    globalCompositeOperation: 'source-over',
  });
  const ctx = context(), buffer = context();
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => buffer) };
  const doc = { defaultView: { devicePixelRatio: 2 }, createElement: vi.fn(() => canvas) };
  Object.assign(ctx, { canvas: { ownerDocument: doc } });
  const args = { ctx, indicator: { result: values.map(value => value == null ? {} : { value }) },
    bounding: { width: 320, height: 80 }, visibleRange: { from: 0, to: values.length },
    xAxis: { convertToPixel: (i: number) => i * 10 }, yAxis: { convertToPixel: (value: number) => 40 - value * 20 },
  };
  return { args: args as any, ctx, buffer, canvas, doc, gradients };
}

it('colors increase continuously in strength with value and keep the center neutral', () => {
  expect(averageAreaColor(0, scale)).toBe('rgba(132,142,156,0.6)');
  expect(averageAreaColor(.5, scale)).toBe('rgba(73,173,143,0.8)');
  expect(averageAreaColor(1, scale)).toBe('rgba(14,203,129,1)');
  expect(averageAreaColor(-1, scale)).toBe('rgba(246,70,93,1)');
  expect(averageAreaColor(2, scale)).not.toBe(averageAreaColor(1, scale));
  expect(averageAreaColor(-3, scale)).not.toBe(averageAreaColor(-2, scale));
  expect(averageAreaColor(.5, { center: .5, lower: .4, upper: .6 })).toBe(averageAreaColor(0, scale));
  expect(averageAreaColor(.25, { center: 0, lower: NaN, upper: NaN, range: [-1, 1] })).not.toContain('NaN');
});

it('draws a fading area and rounded stroke while leaving missing values disconnected', () => {
  const { args, ctx, buffer, gradients } = drawing([.1, .2, null, .4, .5]);
  expect(drawAverageArea(args, 'value', scale)).toBe(true);
  expect(ctx.moveTo.mock.calls).toEqual([[0, 38], [30, 32]]);
  expect(ctx.lineTo.mock.calls).toEqual([[10, 36], [40, 30]]);
  expect(buffer.moveTo.mock.calls).toEqual([[0, 80], [30, 80]]);
  expect(buffer.closePath).toHaveBeenCalledTimes(2);
  expect(gradients[1].stops.at(-1)).toEqual([1, 'rgba(255,255,255,0)']);
  expect(ctx.drawImage).toHaveBeenCalledOnce();
  expect(ctx.globalCompositeOperation).toBe('source-over');
  expect(ctx.restore).toHaveBeenCalledOnce();
});

it('reuses the private surface and resizes its bitmap at device pixel ratio', () => {
  const { args, doc, canvas, buffer } = drawing([.1, .2]);
  drawAverageArea(args, 'value', scale);
  expect([canvas.width, canvas.height]).toEqual([640, 160]);
  expect(buffer.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  drawAverageArea(args, 'value', scale);
  expect(doc.createElement).toHaveBeenCalledOnce();
  expect(buffer.setTransform).toHaveBeenCalledOnce();
  args.bounding.height = 40;
  drawAverageArea(args, 'value', scale);
  expect(canvas.height).toBe(80);
  expect(buffer.setTransform).toHaveBeenCalledTimes(2);
});

it('does not invent values in an empty pane and allows unsupported contexts to fall back', () => {
  const { args, ctx, doc } = drawing([null, null]);
  expect(drawAverageArea(args, 'value', scale)).toBe(true);
  expect(ctx.stroke).not.toHaveBeenCalled(); expect(doc.createElement).not.toHaveBeenCalled();
  expect(drawAverageArea({ ...args, xAxis: undefined }, 'value', scale)).toBe(false);
});

it('preserves narrow peak colors and neutral crossings when a long series is sampled', () => {
  const values = Array.from({ length: 1024 }, () => .1); values[501] = 2; values[502] = -2;
  const { args, gradients } = drawing(values);
  args.xAxis.convertToPixel = (i: number) => i / 4;
  drawAverageArea(args, 'value', scale);
  expect(gradients[0].stops.some(([, color]) => color === averageAreaColor(2, scale))).toBe(true);
  expect(gradients[0].stops.some(([, color]) => color === averageAreaColor(-2, scale))).toBe(true);
  expect(gradients[0].stops.some(([, color]) => color === averageAreaColor(0, scale))).toBe(true);
});
