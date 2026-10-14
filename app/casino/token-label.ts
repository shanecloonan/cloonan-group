/** User-facing label for a token symbol (internal "DEV" chips read as "FakeMONEY"). */
export function displaySymbol(symbol: string): string {
  return symbol === "DEV" ? "FakeMONEY" : symbol;
}
