export interface PoolOptions {
  /** 同時に処理する数 */
  concurrency: number;
  /** true を返すと、いま処理している分が終わったところで止める */
  isCancelled?: () => boolean;
  /** 1 件終わるごとに呼ぶ (失敗した分も数える) */
  onProgress?: (done: number, total: number) => void;
}

/** `items` を `concurrency` 件ずつ並べて処理する。終えた件数を返す */
export async function runPool<T>(items: T[], work: (item: T) => Promise<void>, opts: PoolOptions): Promise<number> {
  const total = items.length;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < total && !opts.isCancelled?.()) {
      const item = items[next++];
      await work(item);
      done++;
      opts.onProgress?.(done, total);
    }
  };
  const n = Math.max(1, Math.min(opts.concurrency, total));
  await Promise.all(Array.from({ length: n }, worker));
  return done;
}
