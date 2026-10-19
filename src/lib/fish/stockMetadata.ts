/** Audited public metadata only. Unknown/non-US RWA is excluded, never relabelled crypto by its name. */
export function binanceStockMarket(row: any): 'us_stock' | 'crypto' | null {
  if (row.underlyingType === 'EQUITY' && ['TRADIFI_PERPETUAL','PERPETUAL'].includes(row.contractType)) return 'us_stock';
  return row.contractType === 'PERPETUAL' && (!row.underlyingType || row.underlyingType === 'COIN') ? 'crypto' : null;
}
export function bitgetStockMarket(row: any, metadata?: any): 'us_stock' | 'crypto' | null {
  if (metadata?.instrumentType === 'stock' && metadata.marketRegion === 'US') return 'us_stock';
  if (metadata) return metadata.instrumentType === 'crypto' ? 'crypto' : null;
  // Old metadata without an RWA flag remains backwards-compatible; explicit RWA is never guessed.
  return row.isRwa === 'YES' ? null : 'crypto';
}
