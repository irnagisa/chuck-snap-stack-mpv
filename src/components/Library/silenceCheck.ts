import { invoke } from "@tauri-apps/api/core";
import type { SilenceReport } from "./storageTypes";

/** 同時に調べる本数。ffmpeg は音声だけを読むので CPU より読み込みが詰まりやすく、多すぎても速くならない */
export const SILENCE_CONCURRENCY = 3;

export interface SilenceCheckResult {
  /** 調べ終えた本数 (失敗を含む) */
  done: number;
  /** 読めなかった本数 */
  failed: number;
  /** 無音のトラックが見つかった本数 */
  found: number;
}

interface Options {
  /** true を返すと、いま調べている分が終わったところで止める */
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number) => void;
  concurrency?: number;
}

/**
 * 動画の音声トラックが無音かを、何本かずつ並べて調べる (結果は Rust 側で DB に保存される)。
 * 読めないファイルは飛ばし、未確認のまま残す (次回また試す)
 */
export async function checkSilence(videoIds: number[], opts: Options = {}): Promise<SilenceCheckResult> {
  const total = videoIds.length;
  const result: SilenceCheckResult = { done: 0, failed: 0, found: 0 };
  let next = 0;
  const worker = async () => {
    while (next < total && !opts.isCancelled?.()) {
      const id = videoIds[next++];
      try {
        const report = await invoke<SilenceReport>("detect_silent_audio", { videoId: id });
        if (report.silentStreams.length > 0) result.found++;
      } catch (e) {
        result.failed++;
        console.warn("[silenceCheck] detect_silent_audio:", id, e);
      }
      result.done++;
      opts.onProgress?.(result.done, total);
    }
  };
  const n = Math.max(1, Math.min(opts.concurrency ?? SILENCE_CONCURRENCY, total));
  await Promise.all(Array.from({ length: n }, worker));
  return result;
}
