/**
 * Compute the Hamming distance between two pHash values.
 * Values are stored as decimal u64 strings (from Rust's u64::to_string()).
 */
export function hammingDistance(a: string, b: string): number {
  let xor = BigInt(a) ^ BigInt(b);
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

/**
 * Returns the visual similarity percentage (0–100) between two pHash values.
 * 100 = identical, 0 = completely different.
 */
export function similarityPct(a: string, b: string): number {
  return Math.round((1 - hammingDistance(a, b) / 64) * 100);
}
