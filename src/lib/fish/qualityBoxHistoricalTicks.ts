// UTC windows from Binance USD-M contract listings and tick-size announcements.
// Each row is bounded by the next rule or the archived exchangeInfo observation.
type TickWindow = readonly [from: string, until: string, orderTick: string, executionTick?: string];
const windows: Record<string, readonly TickWindow[]> = {
  AGTUSDT: [
    // https://www.binance.com/en/support/announcement/detail/84b9812b7a88404baedec318c5d60b37
    ['2025-05-20T10:30:00Z', '2026-10-22T06:30:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/84b9812b7a88404baedec318c5d60b37
    ['2026-10-22T06:30:00Z', '2026-11-21T00:00:00Z', '0.00001'],
  ],
  AKEUSDT: [
    // https://www.binance.com/en/support/announcement/detail/82a93632adbd4d0cb42bbf24c9b35400
    ['2025-09-26T12:30:00Z', '2026-08-15T06:00:00Z', '0.0000001'],
    // https://www.binance.com/en/support/announcement/detail/82a93632adbd4d0cb42bbf24c9b35400
    ['2026-08-15T06:00:00Z', '2026-11-21T00:00:00Z', '0.000001'],
  ],
  ATUSDT: [
    // https://www.binance.com/en/support/announcement/detail/1cd08ee9bafd40a2a94e8dfc58408f82
    ['2025-10-29T11:30:00Z', '2025-12-22T07:00:00Z', '0.0001'],
    // https://www.binance.com/en/support/announcement/detail/1cd08ee9bafd40a2a94e8dfc58408f82
    ['2025-12-22T07:00:00Z', '2026-06-13T06:30:00Z', '0.00001'],
    // https://www.binance.com/en/support/announcement/detail/6baee79f009c4f39b8aa62d8a09a24df
    ['2026-06-13T06:30:00Z', '2026-11-20T16:01:00Z', '0.0001'],
  ],
  BRUSDT: [
    // https://www.binance.com/en/support/announcement/detail/cb6f7e88fed2459a8de11d55a69bef58
    ['2025-03-21T12:45:00Z', '2025-04-17T06:00:00Z', '0.0001'],
    // https://www.binance.com/en/support/announcement/detail/cb6f7e88fed2459a8de11d55a69bef58
    ['2025-04-17T06:00:00Z', '2026-10-22T06:30:00Z', '0.00001'],
    // https://www.binance.com/en/support/announcement/detail/84b9812b7a88404baedec318c5d60b37
    ['2026-10-22T06:30:00Z', '2026-11-20T16:01:00Z', '0.0001'],
  ],
  BTWUSDT: [
    // https://www.binance.com/en/support/announcement/detail/3d7ade5e0521477cbe75ca92a913c211
    ['2026-06-04T14:15:00Z', '2026-06-10T06:30:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/3d7ade5e0521477cbe75ca92a913c211
    ['2026-06-10T06:30:00Z', '2026-09-17T06:30:00Z', '0.00001'],
    // https://www.binance.com/en/support/announcement/detail/2b19feada63c4f97b05322298f4121cb
    ['2026-09-17T06:30:00Z', '2026-11-21T00:00:00Z', '0.0001'],
  ],
  BULLAUSDT: [
    // https://www.binance.com/en/support/announcement/detail/cf3f3712e01843cf8616551013341612
    ['2025-07-04T09:00:00Z', '2025-08-04T07:00:00Z', '0.0001'],
    // https://www.binance.com/en/support/announcement/detail/cf3f3712e01843cf8616551013341612
    ['2025-08-04T07:00:00Z', '2026-04-02T06:30:00Z', '0.00001'],
    // https://www.binance.com/en/support/announcement/detail/74de1917c41548108f9b799658fa3f3f
    ['2026-04-02T06:30:00Z', '2026-09-17T06:30:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/2b19feada63c4f97b05322298f4121cb
    ['2026-09-17T06:30:00Z', '2026-11-20T16:01:00Z', '0.00001'],
  ],
  DOLOUSDT: [
    // https://www.binance.com/en/support/announcement/detail/0f7995f922734628892b4b66d9d62e1a
    ['2025-05-01T03:00:00Z', '2025-09-03T07:00:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/0f7995f922734628892b4b66d9d62e1a
    ['2025-09-03T07:00:00Z', '2026-11-20T16:01:00Z', '0.00001'],
  ],
  DOODUSDT: [
    // https://www.binance.com/en/support/announcement/detail/d901cffcd4a745b5a1151697109571a8
    ['2025-05-09T13:30:00Z', '2025-10-08T07:00:00Z', '0.0000001'],
    // https://www.binance.com/en/support/announcement/detail/d901cffcd4a745b5a1151697109571a8
    ['2025-10-08T07:00:00Z', '2026-11-20T16:01:00Z', '0.000001'],
  ],
  HAEDALUSDT: [
    // https://www.binance.com/en/support/announcement/detail/0f7995f922734628892b4b66d9d62e1a
    ['2025-05-01T03:15:00Z', '2025-09-03T07:00:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/0f7995f922734628892b4b66d9d62e1a
    ['2025-09-03T07:00:00Z', '2026-11-21T00:00:00Z', '0.00001'],
  ],
  NXPCUSDT: [
    // https://www.binance.com/en/support/announcement/detail/0f7995f922734628892b4b66d9d62e1a
    ['2025-05-15T06:30:00Z', '2025-09-03T07:00:00Z', '0.00001'],
    // https://www.binance.com/en/support/announcement/detail/0f7995f922734628892b4b66d9d62e1a
    ['2025-09-03T07:00:00Z', '2026-11-20T16:01:00Z', '0.0001', '0.00001'],
  ],
  QUSDT: [
    // https://www.binance.com/en/support/announcement/detail/4688df6f250848478383acf772a7424c
    ['2025-09-02T07:30:00Z', '2026-10-28T06:30:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/4688df6f250848478383acf772a7424c
    ['2026-10-28T06:30:00Z', '2026-11-21T00:00:00Z', '0.00001'],
  ],
  SOLUSDT: [
    // Confirmed replay month after the 2024-10-14 change; outstanding orders retained their grid.
    // https://www.binance.com/en/support/announcement/detail/8bfe2e9b86734cd08f3cbcdb82b79f51
    ['2025-02-01T00:00:00Z', '2025-03-01T00:00:00Z', '0.01', '0.001'],
  ],
  STABLEUSDT: [
    // https://www.binance.com/en/support/announcement/detail/1cd08ee9bafd40a2a94e8dfc58408f82
    ['2025-11-06T12:00:00Z', '2025-12-22T07:00:00Z', '0.00001'],
    // https://www.binance.com/en/support/announcement/detail/1cd08ee9bafd40a2a94e8dfc58408f82
    ['2025-12-22T07:00:00Z', '2026-04-06T06:30:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/6dbc37d4df4b42cd91b3ca768ec547dd
    ['2026-04-06T06:30:00Z', '2026-11-20T16:01:00Z', '0.00001'],
  ],
  TSTUSDT: [
    // https://www.binance.com/en/support/announcement/detail/fed6c0cbecb84685a157fed45da638ad
    ['2025-02-09T13:00:00Z', '2025-06-12T06:00:00Z', '0.0001'],
    // https://www.binance.com/en/support/announcement/detail/fed6c0cbecb84685a157fed45da638ad
    ['2025-06-12T06:00:00Z', '2026-04-02T06:30:00Z', '0.00001'],
    // https://www.binance.com/en/support/announcement/detail/74de1917c41548108f9b799658fa3f3f
    ['2026-04-02T06:30:00Z', '2026-07-30T06:30:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/731403f07ae7487b907bef649bdda4d6
    ['2026-07-30T06:30:00Z', '2026-11-20T16:01:00Z', '0.00001'],
  ],
  XVGUSDT: [
    // https://www.binance.com/en/support/announcement/detail/0f7995f922734628892b4b66d9d62e1a
    ['2024-12-01T00:00:00Z', '2025-09-03T07:00:00Z', '0.0000001'],
    // https://www.binance.com/en/support/announcement/detail/0f7995f922734628892b4b66d9d62e1a
    ['2025-09-03T07:00:00Z', '2026-11-20T16:01:00Z', '0.000001', '0.0000001'],
  ],
  龙虾USDT: [
    // https://www.binance.com/en/support/announcement/detail/2b19feada63c4f97b05322298f4121cb
    ['2026-03-11T11:30:00Z', '2026-09-17T06:30:00Z', '0.000001'],
    // https://www.binance.com/en/support/announcement/detail/2b19feada63c4f97b05322298f4121cb
    ['2026-09-17T06:30:00Z', '2026-11-21T00:00:00Z', '0.00001'],
  ],
};

const timelines = new Map(Object.entries(windows).map(([symbol, rows]) => [symbol,
  rows.map(([from, until, orderTick, executionTick = orderTick]) => ({ from: Date.parse(from), until: Date.parse(until), orderTick, executionTick })),
]));

export const historicalBoxTickWindows = (symbol: string) => timelines.get(symbol);
