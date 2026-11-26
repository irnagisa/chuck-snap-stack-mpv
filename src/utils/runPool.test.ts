import { describe, it, expect } from 'vitest';
import { runPool } from './runPool';

describe('runPool', () => {
  it('runs every item with at most `concurrency` in flight and reports progress', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    const progress: number[] = [];
    const done = await runPool(
      [1, 2, 3, 4, 5],
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        seen.push(n);
        inFlight--;
      },
      { concurrency: 2, onProgress: (d) => progress.push(d) },
    );
    expect(done).toBe(5);
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops taking new items once cancelled', async () => {
    let cancelled = false;
    const seen: number[] = [];
    const done = await runPool(
      [1, 2, 3, 4],
      async (n) => {
        seen.push(n);
        if (n === 2) cancelled = true;
      },
      { concurrency: 1, isCancelled: () => cancelled },
    );
    expect(done).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it('handles an empty list', async () => {
    expect(await runPool([], async () => {}, { concurrency: 3 })).toBe(0);
  });
});
