import { describe, expect, it } from 'vitest';
import { upsertOrderSnapshot } from '../orderSnapshotHistory';

describe('order snapshot audit history', () => {
  it('retains snapshots beyond the former 500-item UI limit', () => {
    const snapshots = Array.from({ length: 650 }, (_, index) => ({
      id: `order-${index}`,
      value: index,
    }));

    const result = snapshots.reduce(
      (history, snapshot) => upsertOrderSnapshot(history, snapshot),
      [] as typeof snapshots,
    );

    expect(result).toHaveLength(650);
    expect(result[0].id).toBe('order-0');
    expect(result[649].id).toBe('order-649');
  });

  it('updates the existing order without duplicating its audit row', () => {
    const result = upsertOrderSnapshot(
      [{ id: 'order-1', value: 1 }],
      { id: 'order-1', value: 2 },
    );

    expect(result).toEqual([{ id: 'order-1', value: 2 }]);
  });
});
