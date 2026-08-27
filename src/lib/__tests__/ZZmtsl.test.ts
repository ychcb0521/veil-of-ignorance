import { describe, it } from 'vitest';
import { orderReferencePrice, panelReferencePrice } from '@/lib/orderReferencePrice';
describe('mtsl', () => {
  it('panel vs list', () => {
    const p = panelReferencePrice({ orderType: 'MARKET', priceSelection: 'MARKET', limitPrice: 0, triggerPrice: 0, marketPrice: 0.011199 });
    const l = orderReferencePrice({ type: 'MARKET_TP_SL', price: 0, stopPrice: 0.015 } as any, 0.011199);
    console.log('PANEL', JSON.stringify(p), '->', 100*10/p.price);
    console.log('LIST ', JSON.stringify(l), '->', 100*10/l.price);
    const c = orderReferencePrice({ type: 'CONDITIONAL', price: 0.0113, stopPrice: 0.010344 } as any, 0.011199);
    console.log('legacy ghost-price CONDITIONAL:', JSON.stringify(c), '->', 10/c.price);
    const c2 = orderReferencePrice({ type: 'CONDITIONAL', price: 0, stopPrice: 0.010344 } as any, 0.011199);
    console.log('clean CONDITIONAL:', JSON.stringify(c2), '->', 10/c2.price);
    const t = orderReferencePrice({ type: 'CONDITIONAL', price: 0, triggerPrice: 0, stopPrice: 0.010344 } as any, 0.011199);
    console.log('triggerPrice:0 alias:', JSON.stringify(t));
  });
});
