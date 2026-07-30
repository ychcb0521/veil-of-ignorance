/**
 * Order snapshots are audit data used by campaign playback. They must not be
 * truncated by a rolling UI limit, otherwise old campaign order layers vanish
 * after enough newer orders are placed.
 */
export function upsertOrderSnapshot<T extends { id: string }>(
  previous: T[],
  snapshot: T,
): T[] {
  const existingIndex = previous.findIndex(item => item.id === snapshot.id);
  if (existingIndex < 0) return [...previous, snapshot];

  const next = [...previous];
  next[existingIndex] = snapshot;
  return next;
}
