const PREFIX = 'TURING:';

export const isTuringCupSymbol = (symbol: string) => symbol.startsWith(PREFIX);
export const turingCupTicker = (symbol: string) => isTuringCupSymbol(symbol) ? symbol.slice(PREFIX.length) : symbol;
export function turingCupSymbol(ticker: string): string {
  const clean = turingCupTicker(ticker.trim().toUpperCase());
  return clean ? PREFIX + clean : '';
}
