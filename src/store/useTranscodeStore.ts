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

export interface TranscodeJob {
  id: number;
  videoPath: string;
  videoName: string;
  durationSecs: number;
  crf: number;
  preset: number;
  /** 変換成功後に呼ばれる (メタデータのコピー等)。モーダルが閉じた後に実行されるため、ストアの関数だけで完結させること */
  onSuccess: (outputPath: string) => Promise<void>;
}

export type EnqueueOptions = Omit<TranscodeJob, 'id'>;

/** 現在のバッチ (キューが空になるまでの一連の変換) の集計 */
export interface TranscodeBatch {
  /** キャンセル・除外分を除いたジョブ総数 */
  total: number;
  succeeded: number;
  failed: number;
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

  /** キューに追加する。同じファイルが実行中・待機中の場合は追加せず false を返す */
  enqueue(opts: EnqueueOptions): boolean;
  /** 実行中のジョブだけをキャンセルする (待機中のジョブは続行) */
  cancel(): Promise<void>;
  /** 待機中のジョブをすべて外し、実行中のジョブもキャンセルする */
  cancelAll(): Promise<void>;
  /** 待機中のジョブを 1 件外す */
  removeFromQueue(id: number): void;
  dismiss(): void;
}

const CANCELLED_MESSAGE = 'キャンセルされました';

const EMPTY_BATCH: TranscodeBatch = { total: 0, succeeded: 0, failed: 0, inputSizeBytes: 0, outputSizeBytes: 0, lastSucceededName: '' };

let _nextId = 1;
let _processing = false;
/** 実行中ジョブへのキャンセル要求 (transcode_video 呼び出し前の要求を取りこぼさないため) */
let _cancelRequested = false;

export const useTranscodeStore = create<TranscodeStore>((set, get) => {
  async function runJob(job: TranscodeJob): Promise<'succeeded' | 'failed' | 'cancelled'> {
    try {
      // 待機中に移動・削除された可能性があるため、実行直前に存在を確認する
      const inputSize = await invoke<number>('get_file_size', { path: job.videoPath }).catch(() => null);
      if (inputSize == null) {
        throw new Error(i18n.t('transcode.sourceMissing'));
      }
      if (_cancelRequested) return 'cancelled';

      const outputPath = await invoke<string>('transcode_video', {
        inputPath: job.videoPath,
        durationSecs: job.durationSecs,
        crf: job.crf,
        preset: job.preset,
      });
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
      // 後続ジョブの処理中もステータスバーの表示は次のジョブに移るため、トーストでも通知する
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
        if (outcome === 'cancelled') {
          set((s) => ({ batch: { ...s.batch, total: s.batch.total - 1 } }));
        }
      }
    } finally {
      unlisten?.();
      _processing = false;
      _cancelRequested = false;
      const { batch } = get();
      const finished = batch.succeeded + batch.failed;
      // すべてキャンセルされた場合は何も表示しない
      set({ current: null, progress: null, isDone: finished > 0, ...(finished === 0 && { batch: EMPTY_BATCH, lastError: null }) });
    }
  }

  return {
    current: null,
    queue: [],
    progress: null,
    batch: EMPTY_BATCH,
    isDone: false,
    lastError: null,

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

    dismiss() {
      if (get().current) return;
      set({ isDone: false, batch: EMPTY_BATCH, lastError: null, progress: null });
    },
  };
});
