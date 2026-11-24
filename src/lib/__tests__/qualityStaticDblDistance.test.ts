import {expect, it} from 'vitest';
import {chartAtr} from '@/lib/atr';
import {evaluateQualityFilter, qualityFilterReadingKey, newQualityStudy, qualityFilterStatus, type QualitySample} from '@/lib/fish/quality';
import {qualityFilterColumns, qualityFilterCell} from '@/lib/fish/qualityFilterColumns';
import {qualityFilterSettingSignature} from '@/lib/fish/qualityFilterLibrary';
import {makeStaticDblDistance, staticDblDistanceChoice, staticDblDistancePct, STATIC_DBL_DISTANCE_VERSION} from '@/lib/fish/qualityStaticDblDistance';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import {warm, impulse, START, STEP} from './fixtures/dbl5GuardPlusBars';

const filter = (metric: string, atr: number) => makeStaticDblDistance(
  staticDblDistanceChoice(STATIC_DBL_DISTANCE_VERSION + ':' + metric)!, '<', 3, true, atr);
const cut = START + 21 * STEP;
const source = {id:'sample', symbol:'TURING:TURING 1', timeLabel:'', timeMs:cut + 17_000, fallbackZone:''};
const row: QualitySample = {id:'sample', source, enteredAt:source.timeMs, basis:'signal', importedAt:cut, groups:[]};

it('uses absolute price gaps on both sides and compares the cached percentage strictly', () => {
  const condition = filter('guard', .5);
  const study = newQualityStudy(cut);
  const plan = {...study.groups[0], buyFilters:[condition]};
  for (const [line, expected] of [[97.7, 2.8], [102.3, 2.8], [102.5, 3], [102.50000001, 3.00000001]]) {
    const value = staticDblDistancePct(100, line, 1, .5);
    expect(value).toBe(expected);
    const key = qualityFilterReadingKey(row, condition);
    const readings = new Map([[key, {key, value}]]);
    const state = expected < 3 ? 'pass' : 'fail';
    expect(qualityFilterCell(row, condition, readings)).toMatchObject({value:expected+'%', state});
    expect(qualityFilterStatus(study, row, plan, readings).state).toBe(state);
  }
  expect(staticDblDistancePct(.1, .103, 1, 0)).toBe(3);
  expect(staticDblDistancePct(.1, .102999999999, 1, 0)).toBeLessThan(3);
});

it('uses both chart references before stop-price rounding and keeps different buffers distinct', async () => {
  const bars = [...warm(), impulse()].map(bar => ({...bar, quoteVolume:1000, takerBuyQuoteVolume:500}));
  const load: FishReconstructionLoader = async (_source, from, to, plan) => {
    expect(plan.step).toBe(STEP);
    expect(from).toBeGreaterThanOrEqual(START);
    expect(to).toBeLessThanOrEqual(cut);
    return bars.filter(bar => bar.openTime >= from && bar.openTime < to);
  };
  const conditions = ['guard','impulse','nearest'].map(metric => filter(metric, .25));
  const readings = await Promise.all(conditions.map(condition => evaluateQualityFilter(row,
    {...condition, initialization:'turing-origin-v1'}, cut + 17_000, load, new AbortController().signal, async () => START)));
  const atr = chartAtr(bars).at(-1)!;
  // The chart's guard and impulse lines on this closed candle are 98.44 and 99.49.
  for (const [index, line] of [98.44, 99.49, 99.49].entries()) {
    expect(readings[index].at).toBe(cut);
    expect(readings[index].value).toBeCloseTo(((101.4 - line) + .25 * atr) / 101.4 * 100, 12);
  }
  expect(readings[2].value).toBe(Math.min(readings[0].value!, readings[1].value!));
  const other = filter('guard', .75);
  expect(qualityFilterSettingSignature([other])).not.toBe(qualityFilterSettingSignature([conditions[0]]));
  expect(qualityFilterColumns({...newQualityStudy(cut), independentFilters:true, buyFilters:[conditions[0],other]})).toHaveLength(2);
});
