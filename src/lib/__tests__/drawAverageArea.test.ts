import { expect, it, vi } from 'vitest';
import { averageAreaColor, drawAverageArea } from '../drawAverageArea';

const scale = { center: 0, lower: -1, upper: 1 };
function drawing(values: (number | null)[], center = 0) {
  const gradients: { stops: [number, string][]; axis: number[] }[] = [];
  const ctx = {
    createLinearGradient: vi.fn((...axis: number[]) => {
      const stops: [number, string][] = [], gradient = { stops, axis, addColorStop: (at: number, color: string) => stops.push([at, color]) };
      gradients.push(gradient); return gradient;
    }),
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), rect: vi.fn(), clip: vi.fn(), setLineDash: vi.fn(),
  };
  const args = { ctx, indicator: { result: values.map(value => value == null ? {} : { value }) },
    bounding: { width: 320, height: 80 }, visibleRange: { from: 0, to: values.length },
    xAxis: { convertToPixel: (i: number) => i * 10 }, yAxis: { convertToPixel: (value: number) => 40 - (value - center) * 20, convertFromPixel: (y: number) => center + (40 - y) / 20 },
  };
  return { args: args as any, ctx, gradients };
}

it('uses unambiguous green/red hues around the center and deepens values beyond their reference limits', () => {
  expect(averageAreaColor(0, scale)).toBe('rgba(132,142,156,0.6)');
  expect(averageAreaColor(.5, scale)).toBe('rgba(14,203,129,0.97)');
  expect(averageAreaColor(1, scale)).toBe('rgba(14,203,129,1)');
  expect(averageAreaColor(-1, scale)).toBe('rgba(246,70,93,1)');
  expect(averageAreaColor(2, scale)).not.toBe(averageAreaColor(1, scale));
  expect(averageAreaColor(-3, scale)).not.toBe(averageAreaColor(-2, scale));
  expect(averageAreaColor(.5, { center: .5, lower: .4, upper: .6 })).toBe(averageAreaColor(0, scale));
  expect(averageAreaColor(.25, { center: 0, lower: NaN, upper: NaN, range: [-1, 1] })).not.toContain('NaN');
});

it('fills to the threshold rather than the pane bottom, leaving missing values disconnected', () => {
  const { args, ctx } = drawing([.1, .2, null, -.4, -.5]);
  expect(drawAverageArea(args, 'value', scale)).toBe(true);
  // Separate fill contours and line contours, with no invented segment across the missing reading.
  expect(ctx.moveTo.mock.calls).toEqual([[0, 40], [30, 40], [0, 38], [30, 48]]);
  expect(ctx.lineTo.mock.calls).toEqual([[0,38],[10,36],[10,40],[30,48],[40,50],[40,40],[10,36],[40,50]]);
  expect(ctx.closePath).toHaveBeenCalledTimes(2);
  expect(ctx.fill).toHaveBeenCalledOnce(); expect(ctx.stroke).toHaveBeenCalledOnce();
  expect(ctx.clip).toHaveBeenCalledOnce(); expect(ctx.restore).toHaveBeenCalledOnce();
});

it('switches color precisely at crossings and makes fill stronger away from the threshold', () => {
  const { args, gradients } = drawing([1, -1]);
  drawAverageArea(args, 'value', scale);
  const fill = gradients[0], line = gradients[1];
  expect(fill.axis).toEqual([0, 0, 0, 80]);
  expect(fill.stops.filter(([at])=>at===.5)).toEqual([[.5,'rgba(14,203,129,0.035)'],[.5,'rgba(246,70,93,0.035)']]);
  expect(fill.stops).toContainEqual([.25,'rgba(14,203,129,0.28)']);
  expect(fill.stops).toContainEqual([.75,'rgba(246,70,93,0.28)']);
  expect(line.stops.filter(([at])=>at===.5)).toEqual([[.5,'rgba(14,203,129,0.94)'],[.5,'rgba(246,70,93,0.94)']]);
});

it('uses 0.5 as the S average baseline, and preserves the same reference shades after resizing', () => {
  const {args,ctx,gradients}=drawing([.8,.2],.5), state={center:.5,lower:.4,upper:.6};
  drawAverageArea(args,'value',state);
  expect(ctx.moveTo.mock.calls[0]).toEqual([0,40]);
  const referenceColor=averageAreaColor(.6,state,.28);
  expect(gradients[0].stops.map(([,color])=>color)).toContain(referenceColor);
  args.bounding.height=160;
  args.yAxis.convertToPixel=(v:number)=>80-(v-.5)*40;
  args.yAxis.convertFromPixel=(y:number)=>.5+(80-y)/40;
  drawAverageArea(args,'value',state);
  expect(ctx.moveTo.mock.calls[2]).toEqual([0,80]);
  expect(gradients[2].stops.map(([,color])=>color)).toContain(referenceColor);
});

it('clips to the pane when the threshold is outside the viewport', () => {
  const { args, ctx } = drawing([5, 6]);
  args.yAxis.convertToPixel=(v:number)=>150-v*20;
  args.yAxis.convertFromPixel=(y:number)=>(150-y)/20;
  drawAverageArea(args,'value',scale);
  expect(ctx.moveTo.mock.calls[0]).toEqual([0,150]);
  expect(ctx.rect).toHaveBeenCalledWith(0,0,320,80);
  expect(ctx.clip).toHaveBeenCalledOnce();
});

it('does not invent empty values and allows unsupported contexts to fall back', () => {
  const { args, ctx } = drawing([null, null]);
  expect(drawAverageArea(args, 'value', scale)).toBe(true);
  expect(ctx.stroke).not.toHaveBeenCalled();
  expect(drawAverageArea({ ...args, xAxis: undefined }, 'value', scale)).toBe(false);
});
