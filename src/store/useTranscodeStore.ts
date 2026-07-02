import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from './useToastStore';

export interface TranscodeProgressPayload {
  percent: number;
  speed: string;
  elapsed_secs: number;
  frames: number;
  fps: number;
  total_size_bytes: number;
}

interface TranscodeStore {
  isRunning: boolean;
  isDone: boolean;
  error: string | null;
  progress: TranscodeProgressPayload | null;
  videoName: string;
  outputPath: string | null;
  inputSizeBytes: number | null;
  outputSizeBytes: number | null;

  start(opts: {
    videoPath: string;
    videoName: string;
    durationSecs: number;
    inputSizeBytes: number | null;
    crf: number;
    preset: number;
    onSuccess: (outputPath: string) => Promise<void>;
  }): Promise<void>;
  cancel(): Promise<void>;
  dismiss(): void;
}

let _unlisten: UnlistenFn | null = null;

export const useTranscodeStore = create<TranscodeStore>((set, get) => ({
  isRunning: false,
  isDone: false,
  error: null,
  progress: null,
  videoName: '',
  outputPath: null,
  inputSizeBytes: null,
  outputSizeBytes: null,

  async start({ videoPath, videoName, durationSecs, inputSizeBytes, crf, preset, onSuccess }) {
    if (get().isRunning) return;

    if (_unlisten) { _unlisten(); _unlisten = null; }
    try {
      _unlisten = await listen<TranscodeProgressPayload>('transcode://progress', (e) => {
        set({ progress: e.payload });
      });
    } catch (e) {
      console.error('[transcode] progress リスナー登録失敗 (プログレス表示なしで続行):', e);
      toast.error('トランスコードのプログレス表示に失敗しました。処理は続行されます。');
    }

    set({ isRunning: true, isDone: false, error: null, progress: null, videoName, outputPath: null, inputSizeBytes, outputSizeBytes: null });

    try {
      const result = await invoke<string>('transcode_video', {
        inputPath: videoPath,
        durationSecs,
        crf,
        preset,
      });
      set({ outputPath: result });
      await onSuccess(result);
      // 出力ファイルサイズを取得
      const outSize = await invoke<number>('get_file_size', { path: result }).catch(() => null);
      set({ isRunning: false, isDone: true, outputSizeBytes: outSize });
    } catch (e) {
      const msg = String(e);
      if (msg === 'キャンセルされました') {
        set({ isRunning: false, isDone: false, error: null, progress: null });
      } else {
        set({ isRunning: false, isDone: false, error: msg });
      }
    } finally {
      if (_unlisten) {
        _unlisten();
        _unlisten = null;
      }
    }
  },

  async cancel() {
    await invoke('cancel_transcode').catch((e: unknown) => {
      console.error('[transcode] キャンセル命令の送信に失敗しました:', e);
      toast.error(`トランスコードのキャンセルに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    });
  },

  dismiss() {
    set({ isDone: false, error: null, progress: null, videoName: '', outputPath: null, inputSizeBytes: null, outputSizeBytes: null });
  },
}));
