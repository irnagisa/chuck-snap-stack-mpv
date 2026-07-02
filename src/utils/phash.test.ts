import { describe, it, expect } from 'vitest';
import { hammingDistance, similarityPct } from './phash';

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance('0', '0')).toBe(0);
    expect(hammingDistance('42', '42')).toBe(0);
    // u64 max
    expect(hammingDistance('18446744073709551615', '18446744073709551615')).toBe(0);
  });

  it('returns 1 for hashes differing by a single bit', () => {
    expect(hammingDistance('0', '1')).toBe(1);
    expect(hammingDistance('0', '2')).toBe(1);
    // highest bit: 2^63
    expect(hammingDistance('0', '9223372036854775808')).toBe(1);
  });

  it('returns 64 when all bits differ', () => {
    // 0 vs u64::MAX (all 64 bits set)
    expect(hammingDistance('0', '18446744073709551615')).toBe(64);
  });

  it('is symmetric', () => {
    const a = '1234567890';
    const b = '9876543210';
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });

  it('counts each differing bit independently', () => {
    // 0b0000 vs 0b1111 = 4 bits differ
    expect(hammingDistance('0', '15')).toBe(4);
    // 0b1010 vs 0b0101 = 4 bits differ
    expect(hammingDistance('10', '5')).toBe(4);
    // 0b1100 vs 0b0011 = 4 bits differ
    expect(hammingDistance('12', '3')).toBe(4);
  });

  it('handles alternating bit patterns', () => {
    // 0xAAAAAAAAAAAAAAAA vs 0x5555555555555555 — all 64 bits differ
    expect(hammingDistance('12297829382473034410', '6148914691236517205')).toBe(64);
  });
});

describe('similarityPct', () => {
  it('returns 100 for identical hashes', () => {
    expect(similarityPct('0', '0')).toBe(100);
    expect(similarityPct('99999', '99999')).toBe(100);
  });

  it('returns 0 for completely different hashes (all 64 bits differ)', () => {
    expect(similarityPct('0', '18446744073709551615')).toBe(0);
  });

  it('returns ~88 for 8 bits difference (standard threshold)', () => {
    // 8 bits differ → (1 - 8/64) * 100 = 87.5 → rounds to 88
    expect(similarityPct('0', '255')).toBe(88); // 0 vs 0xFF = 8 bits
  });

  it('returns ~94 for 4 bits difference (strict threshold)', () => {
    // 4 bits differ → (1 - 4/64) * 100 = 93.75 → rounds to 94
    expect(similarityPct('0', '15')).toBe(94); // 0 vs 0b1111 = 4 bits
  });

  it('returns ~81 for 12 bits difference (loose threshold)', () => {
    // 12 bits differ → (1 - 12/64) * 100 = 81.25 → rounds to 81
    expect(similarityPct('0', '4095')).toBe(81); // 0 vs 0xFFF = 12 bits
  });

  it('is symmetric', () => {
    expect(similarityPct('100', '200')).toBe(similarityPct('200', '100'));
  });

  it('result is always in [0, 100]', () => {
    const cases = ['0', '1', '255', '65535', '18446744073709551615'];
    for (const a of cases) {
      for (const b of cases) {
        const pct = similarityPct(a, b);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    }
  });
});
