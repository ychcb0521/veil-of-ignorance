import type { ResearchBar } from '@/lib/deepRsa/window';

export function mbiBars(count = 900, step = 300000): ResearchBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 * Math.exp(.02 * Math.sin(i / 9) + .012 * Math.sin(i / 2.7) + .0002 * i);
    const quoteVolume = 30000 * (1.5 + .6 * Math.sin(i / 7));
    return { openTime: i * step, close, open: close * .9995, high: close * 1.003, low: close * .997,
      quoteVolume, volume: quoteVolume / (close * 1.0001), takerBuyVolume: null,
      takerBuyQuoteVolume: quoteVolume * (.5 + .3 * Math.sin(i / 11)), refClose: 50000 * Math.exp(.01 * Math.sin(i / 10)) };
  });
}
