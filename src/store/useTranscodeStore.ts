import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import i18n from 'i18next';
import { toast } from './useToastStore';

export interface TranscodeProgressPayload {
  percent: number;
  speed: string;
  elapsed_secs: number;
  frames: number;
  fps: number;
  total_size_bytes: number;
}

/** 変換の種類 (src-tauri/src/commands/transcode.rs の TranscodeMode) */
export type TranscodeMode =
  /** 映像を SVT-AV1 で再エンコード (遅いがよく縮む) */
  | { kind: 'av1'; crf: number; preset: number }
  /** 映像を VideoToolbox の HEVC で再エンコード (速い)。元の映像ビットレートに対する割合 */
  | { kind: 'hevc'; bitratePercent: number }
  /** 映像はコピーし、音声だけ Opus に */
  | { kind: 'audio' }
  /** 再エンコードせず、選んだトラックだけ残す・切り詰める */
  | { kind: 'remux'; streams: number[]; trimStart: number | null; trimEnd: number | null }
  /** 再エンコードせず、指定した音声トラックだけ外す (無音のトラックの整理用) */
  | { kind: 'dropStreams'; streams: number[] };

export interface TranscodeJob {
  id: number;
  videoPath: string;
  videoName: string;
  durationSecs: number;
  mode: TranscodeMode;
  /**
   * 変換の直前に呼ばれ、実際に使う指定を返す (null なら変換せずに外す)。
   * 待機中に変わりうるもの (簡易判定だった無音のトラックの確認など) を最新にするために使う
   */
  prepare?: () => Promise<TranscodeMode | null>;
  /** 変換成功後に呼ばれる (メタデータのコピー等)。モーダルが閉じた後に実行されるため、ストアの関数だけで完結させること */
  onSuccess: (outputPath: string) => Promise<void>;
}

export type EnqueueOptions = Omit<TranscodeJob, 'id'>;

/** transcode_video の戻り値 */
export type TranscodeOutcome =
  | { status: 'done'; outputPath: string }
  /** 十分に小さくならなかったため変換後のファイルを破棄した (元ファイルはそのまま) */
  | { status: 'discarded'; inputBytes: number; outputBytes: number };

/** 現在のバッチ (キューが空になるまでの一連の変換) の集計 */
export interface TranscodeBatch {
  /** キャンセル・除外分を除いたジョブ総数 */
  total: number;
  succeeded: number;
  failed: number;
  /** 小さくならなかったため変換後のファイルを破棄したジョブ数 */
  discarded: number;
  /** 直近に破棄したジョブの表示名 */
  lastDiscardedName: string;
  /** 成功したジョブの変換前後サイズ合計 (どちらかが取得できなかったジョブは含めない) */
  inputSizeBytes: number;
  outputSizeBytes: number;
  /** 直近に成功したジョブの表示名 */
  lastSucceededName: string;
}

interface TranscodeStore {
  /** 実行中のジョブ */
  current: TranscodeJob | null;
  /** 待機中のジョブ (先頭から順に処理) */
  queue: TranscodeJob[];
  progress: TranscodeProgressPayload | null;
  batch: TranscodeBatch;
  /** バッチが終了し、結果を表示中 */
  isDone: boolean;
  /** 直近に失敗したジョブ */
  lastError: { videoName: string; message: string } | null;
  /**
   * 変換後に元ファイルをゴミ箱へ移した (ライブラリから外した) パス (バッチをまたいで持つ)。
   * 開いている整理画面の一覧から、読み直さずにすぐ外すのに使う
   */
  removedSourcePaths: ReadonlySet<string>;
  /**
   * 再エンコード (AV1 / HEVC) しても縮まず、変換後のファイルを破棄したパス (バッチをまたいで持つ)。
   * 開いている整理画面の高ビットレートの一覧から、読み直さずにすぐ外すのに使う
   * (バックエンドも記録するので、読み直した一覧にも出ない)
   */
  discardedPaths: ReadonlySet<string>;

  /** キューに追加する。同じファイルが実行中・待機中の場合は追加せず false を返す */
  enqueue(opts: EnqueueOptions): boolean;
  /** 実行中のジョブだけをキャンセルする (待機中のジョブは続行) */
  cancel(): Promise<void>;
  /** 待機中のジョブをすべて外し、実行中のジョブもキャンセルする */
  cancelAll(): Promise<void>;
  /** 待機中のジョブを 1 件外す */
  removeFromQueue(id: number): void;
  /** 変換後に元ファイルを消したことを記録する (removedSourcePaths) */
  markSourceRemoved(path: string): void;
  dismiss(): void;
}

const CANCELLED_MESSAGE = 'キャンセルされました';

const EMPTY_BATCH: TranscodeBatch = {
  total: 0,
  succeeded: 0,
  failed: 0,
  discarded: 0,
  lastDiscardedName: '',
  inputSizeBytes: 0,
  outputSizeBytes: 0,
  lastSucceededName: '',
};

/** バッチ内で処理が終わったジョブ数 */
export function finishedCount(batch: TranscodeBatch): number {
  return batch.succeeded + batch.failed + batch.discarded;
}

/** 終わったバッチの結果の 1 行 (作業の一覧と完了の通知で使う) */
export function transcodeResultLabel(batch: TranscodeBatch, lastError: TranscodeStore['lastError']): string {
  if (batch.total > 1) {
    let label = batch.failed > 0
      ? i18n.t('app.transcodeBatchPartial', { total: batch.total, failed: batch.failed })
      : i18n.t('app.transcodeBatchSuccess', { total: batch.total });
    if (batch.discarded > 0) label += i18n.t('app.transcodeBatchDiscarded', { count: batch.discarded });
    return label;
  }
  if (batch.failed > 0 && lastError) return i18n.t('app.transcodeError', { name: lastError.videoName });
  if (batch.discarded > 0) return i18n.t('app.transcodeDiscarded', { name: batch.lastDiscardedName });
  return i18n.t('app.transcodeSuccess', { name: batch.lastSucceededName });
}

/** バッチが終わったことを、時間で消える通知で知らせる */
function notifyBatchFinished(batch: TranscodeBatch, lastError: TranscodeStore['lastError']) {
  // 1 件だけで破棄になったときは、破棄の通知 (減った割合つき) をもう出している
  if (batch.total === 1 && batch.discarded === 1) return;
  const label = transcodeResultLabel(batch, lastError);
  if (batch.failed > 0) {
    const detail = batch.total === 1 && lastError ? `\n${lastError.message}` : '';
    toast.error(label + detail, 8000);
  } else if (batch.succeeded === 0) {
    toast.info(label, 5000);
  } else {
    toast.success(label, 5000);
  }
}

let _nextId = 1;
let _processing = false;
/** 実行中ジョブへのキャンセル要求 (transcode_video 呼び出し前の要求を取りこぼさないため) */
let _cancelRequested = false;

export const useTranscodeStore = create<TranscodeStore>((set, get) => {
  async function runJob(job: TranscodeJob): Promise<'succeeded' | 'failed' | 'cancelled' | 'discarded' | 'skipped'> {
    try {
      // 待機中に移動・削除された可能性があるため、実行直前に存在を確認する
      const inputSize = await invoke<number>('get_file_size', { path: job.videoPath }).catch(() => null);
      if (inputSize == null) {
        throw new Error(i18n.t('transcode.sourceMissing'));
      }
      if (_cancelRequested) return 'cancelled';

      const mode = job.prepare ? await job.prepare() : job.mode;
      if (_cancelRequested) return 'cancelled';
      if (!mode) return 'skipped';

      const outcome = await invoke<TranscodeOutcome>('transcode_video', {
        inputPath: job.videoPath,
        durationSecs: job.durationSecs,
        mode,
      });
      if (outcome.status === 'discarded') {
        // 変換後のファイルは破棄済み。元ファイル・メタデータには触らない (onSuccess も呼ばない)
        const reencoded = mode.kind === 'av1' || mode.kind === 'hevc';
        set((s) => ({
          batch: { ...s.batch, discarded: s.batch.discarded + 1, lastDiscardedName: job.videoName },
          ...(reencoded && { discardedPaths: new Set(s.discardedPaths).add(job.videoPath) }),
        }));
        const savedPercent = outcome.inputBytes > 0
          ? Math.max(0, (1 - outcome.outputBytes / outcome.inputBytes) * 100)
          : 0;
        toast.info(i18n.t('transcode.discarded', { name: job.videoName, percent: savedPercent.toFixed(1) }), 8000);
        return 'discarded';
      }
      const { outputPath } = outcome;
      // onSuccess (元ファイルのゴミ箱移動を含む) は次の変換開始前に完了させる。
      // バックエンドの完了記録は次の transcode_video 開始時に破棄されるため。
      await job.onSuccess(outputPath);
      const outputSize = await invoke<number>('get_file_size', { path: outputPath }).catch(() => null);
      set((s) => ({
        batch: {
          ...s.batch,
          succeeded: s.batch.succeeded + 1,
          lastSucceededName: job.videoName,
          ...(outputSize != null && {
            inputSizeBytes: s.batch.inputSizeBytes + inputSize,
            outputSizeBytes: s.batch.outputSizeBytes + outputSize,
          }),
        },
      }));
      return 'succeeded';
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === CANCELLED_MESSAGE) return 'cancelled';
      console.error(`[transcode] 変換失敗 (${job.videoPath}):`, e);
      set((s) => ({
        batch: { ...s.batch, failed: s.batch.failed + 1 },
        lastError: { videoName: job.videoName, message },
      }));
      // 後続ジョブの処理中は作業の一覧の表示が次のジョブに移るため、トーストでも通知する
      if (get().queue.length > 0) {
        toast.error(`${i18n.t('app.transcodeError', { name: job.videoName })}\n${message}`);
      }
      return 'failed';
    }
  }

  async function processQueue(): Promise<void> {
    if (_processing) return;
    _processing = true;

    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<TranscodeProgressPayload>('transcode://progress', (e) => {
        set({ progress: e.payload });
        // transcode_video の開始処理中に届いたキャンセル要求はフラグがリセットされ得るため再送する
        if (_cancelRequested) invoke('cancel_transcode').catch(() => {});
      });
    } catch (e) {
      console.error('[transcode] progress リスナー登録失敗 (プログレス表示なしで続行):', e);
      toast.error('トランスコードのプログレス表示に失敗しました。処理は続行されます。');
    }

    try {
      for (let job = get().queue[0]; job; job = get().queue[0]) {
        _cancelRequested = false;
        set((s) => ({ current: job, queue: s.queue.slice(1), progress: null }));
        const outcome = await runJob(job);
        if (outcome === 'cancelled' || outcome === 'skipped') {
          set((s) => ({ batch: { ...s.batch, total: s.batch.total - 1 } }));
        }
      }
    } finally {
      unlisten?.();
      _processing = false;
      _cancelRequested = false;
      const { batch, lastError } = get();
      const finished = finishedCount(batch);
      // すべてキャンセルされた場合は何も表示しない
      set({ current: null, progress: null, isDone: finished > 0, ...(finished === 0 && { batch: EMPTY_BATCH, lastError: null }) });
      if (finished > 0) notifyBatchFinished(batch, lastError);
    }
  }

  return {
    current: null,
    queue: [],
    progress: null,
    batch: EMPTY_BATCH,
    isDone: false,
    lastError: null,
    removedSourcePaths: new Set(),
    discardedPaths: new Set(),

    enqueue(opts) {
      const { current, queue, isDone } = get();
      if (current?.videoPath === opts.videoPath || queue.some((j) => j.videoPath === opts.videoPath)) {
        return false;
      }
      const job: TranscodeJob = { ...opts, id: _nextId++ };
      set((s) => {
        // 前回のバッチの結果表示中なら、新しいバッチとして開始する
        const batch = isDone ? EMPTY_BATCH : s.batch;
        return {
          queue: [...s.queue, job],
          batch: { ...batch, total: batch.total + 1 },
          ...(isDone && { isDone: false, lastError: null }),
        };
      });
      void processQueue();
      return true;
    },

    async cancel() {
      if (!get().current) return;
      _cancelRequested = true;
      await invoke('cancel_transcode').catch((e: unknown) => {
        console.error('[transcode] キャンセル命令の送信に失敗しました:', e);
        toast.error(`トランスコードのキャンセルに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      });
    },

    async cancelAll() {
      set((s) => ({ queue: [], batch: { ...s.batch, total: s.batch.total - s.queue.length } }));
      await get().cancel();
    },

    removeFromQueue(id) {
      set((s) => {
        const queue = s.queue.filter((j) => j.id !== id);
        return { queue, batch: { ...s.batch, total: s.batch.total - (s.queue.length - queue.length) } };
      });
    },

    markSourceRemoved(path) {
      set((s) => ({ removedSourcePaths: new Set(s.removedSourcePaths).add(path) }));
    },

    dismiss() {
      if (get().current) return;
      set({ isDone: false, batch: EMPTY_BATCH, lastError: null, progress: null });
    },
  };
});
