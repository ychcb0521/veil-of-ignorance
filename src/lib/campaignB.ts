/** The geometric definition is the sole source of b; net settlement is a separate metric. */
export function resolveUnifiedMagicB(geometricB: number | null | undefined): number | null {
  return geometricB != null && Number.isFinite(geometricB) ? geometricB : null;
}
