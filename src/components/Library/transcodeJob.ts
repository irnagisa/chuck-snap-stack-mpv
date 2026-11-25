import { invoke } from '@tauri-apps/api/core';
import i18n from 'i18next';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { useTranscodeStore, type TranscodeMode } from '../../store/useTranscodeStore';
import { toast } from '../../store/useToastStore';
import type { Tag } from '../../types';

export type { TranscodeMode };
export type TranscodeKind = TranscodeMode['kind'];

/** 変換元の情報 (変換後のファイルへメタデータを引き継ぐのに使う) */
export interface TranscodeSource {
  id: number;
  path: string;
  title: string | null;
  duration: number | null;
  categoryId: number | null;
  rating: number;
  createdAt: string | null;
}

/** trash_transcode_source の戻り値 */
type SourceDisposal =
  | { method: 'trash' }
  | { method: 'quarantine'; location: string };

// ── estimate_transcode の戻り値 (src-tauri/src/commands/transcode.rs) ─────

export interface StreamSummary {
  index: number;
  codecType: string;
  codecName: string;
  coverArt: boolean;
  width: number | null;
  height: number | null;
  channels: number | null;
  bitRateKbps: number | null;
  language: string | null;
  title: string | null;
  /** トラック整理で残せるか (データ・タイムコードは残せない) */
  remuxable: boolean;
}

export interface AudioPlan {
  index: number;
  codec: string;
  channels: number | null;
  bitRateKbps: number | null;
  language: string | null;
  title: string | null;
  /** Opus に変換するときのビットレート。null ならそのままコピー */
  opusKbps: number | null;
}

export interface TranscodeEstimate {
  verdict: 'worth' | 'alreadyAv1' | 'lowBitrate' | 'unknown';
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoBitrateKbps: number | null;
  bitsPerPixel: number | null;
  minSavingPercent: number;
  duration: number;
  streams: StreamSummary[];
  audio: AudioPlan[];
  audioSavingBytes: number;
  hevcAvailable: boolean;
  /** AV1 変換に使うエンコーダー (transcode.rs の Av1Encoder)。null ならこの ffmpeg では AV1 変換できない */
  av1Encoder: Av1Encoder | null;
}

/** svt: SVT-AV1 (速い) / aom: libaom (SVT-AV1 を含まない ffmpeg での代わり。かなり遅い) */
export type Av1Encoder = 'svt' | 'aom';

/** 出力ファイル名に付ける印 (transcode.rs の OUTPUT_SUFFIXES と合わせる) */
const OUTPUT_SUFFIX: Record<TranscodeKind, string> = {
  av1: 'av1',
  hevc: 'hevc',
  audio: 'opus',
  remux: 'slim',
};

/** 映像を再エンコードしたとき、この割合以上小さくならなければ破棄する (transcode.rs の MIN_SAVING_RATIO) */
export const MIN_SAVING_PERCENT = 15;

/** 出力先の見込み (同名があれば実際は連番が付く) */
export function outputPathFor(inputPath: string, kind: TranscodeKind): string {
  const lastDot = inputPath.lastIndexOf('.');
  const lastSlash = Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\'));
  const stem = lastDot > lastSlash ? inputPath.slice(0, lastDot) : inputPath;
  return `${stem}.${OUTPUT_SUFFIX[kind]}.mkv`;
}

/** ビットレート (kbps) から推奨 CRF を返す */
export function suggestCrf(bitrateKbps: number): { crf: number; reasonKey: string } {
  if (bitrateKbps > 20_000) return { crf: 28, reasonKey: 'transcode.crfHighBitrate' };
  if (bitrateKbps > 10_000) return { crf: 32, reasonKey: 'transcode.crfMedHighBitrate' };
  if (bitrateKbps > 5_000)  return { crf: 36, reasonKey: 'transcode.crfMedBitrate' };
  if (bitrateKbps > 2_000)  return { crf: 42, reasonKey: 'transcode.crfLowBitrate' };
  return { crf: 50, reasonKey: 'transcode.crfVeryLowBitrate' };
}

/** 選べるプリセット (数字が小さいほど遅く、よく縮む) */
export const PRESET_OPTIONS = [
  { value: 13, labelKey: 'transcode.preset13Label', descKey: 'transcode.preset13Desc' },
  { value: 8,  labelKey: 'transcode.preset8Label',  descKey: 'transcode.preset8Desc' },
  { value: 5,  labelKey: 'transcode.preset5Label',  descKey: 'transcode.preset5Desc' },
  { value: 3,  labelKey: 'transcode.preset3Label',  descKey: 'transcode.preset3Desc' },
] as const;

export const DEFAULT_PRESET = 8;

/** HEVC の目標ビットレート (元の映像に対する %) */
export const HEVC_PERCENT_RANGE = { min: 20, max: 80, default: 50 } as const;

/** 映像を再エンコードしても縮みにくいコーデック */
export function isEfficientCodec(codec: string | null): boolean {
  return codec === 'hevc' || codec === 'av1' || codec === 'vp9';
}

/**
 * 変換をキューに追加する。変換に成功したら、評価・カテゴリ・タグ・追加日を変換後のファイルへ写し、
 * 指定があれば元ファイルをゴミ箱へ移動する。同じファイルが実行中・待機中なら追加せず false を返す。
 * 成功時の処理はモーダルが閉じた後に走るため、ストアと invoke だけで完結させる。
 */
export function enqueueTranscode(
  source: TranscodeSource,
  mode: TranscodeMode,
  opts: { trashOriginal: boolean },
): boolean {
  const t = i18n.t.bind(i18n);
  const displayName = source.title ?? source.path.split('/').pop() ?? source.path;
  const outputPath = outputPathFor(source.path, mode.kind);
  const stem = outputPath.split('/').pop()?.replace(/\.[a-z0-9]+\.mkv$/, '') ?? outputPath;

  return useTranscodeStore.getState().enqueue({
    videoPath: source.path,
    videoName: displayName,
    durationSecs: source.duration ?? 0,
    mode,
    onSuccess: async (finalPath) => {
      const library = useLibraryStore.getState();
      const tagStore = useTagStore.getState();
      const newId = await library.addVideoFromPath(finalPath, stem);
      if (newId == null) {
        if (opts.trashOriginal) toast.error(t('transcode.trashOriginalSkipped'));
        return;
      }
      if (source.categoryId != null) {
        await tagStore.setVideoCategory(newId, source.categoryId);
      }
      await library.updateVideo(newId, {
        ...(source.rating > 0 ? { rating: source.rating } : {}),
        ...(source.createdAt ? { created_at: source.createdAt } : {}),
      });
      // タグは変換完了時点のものを写す (待機中に付け替えた分も引き継ぐ)
      const tags = await invoke<Tag[]>('db_fetch_video_tags', { videoId: source.id }).catch((e: unknown) => {
        console.error('[transcode] 元ファイルのタグ取得に失敗:', e);
        return [] as Tag[];
      });
      for (const tag of tags) {
        await tagStore.addTagToVideo(newId, tag.id);
      }
      await library.fetchVideos();

      // 元ファイルをゴミ箱へ移動 (メタデータのコピー完了後のみ)。
      // 変換結果の検証はバックエンドで行い、失敗時は元ファイルを残す。
      if (!opts.trashOriginal) return;
      let disposal: SourceDisposal;
      try {
        disposal = await invoke<SourceDisposal>('trash_transcode_source', { inputPath: source.path, outputPath: finalPath });
      } catch (e) {
        console.error('[transcode] 元ファイルのゴミ箱移動を中止:', e);
        toast.error(t('transcode.trashOriginalFailed', { error: String(e) }));
        return;
      }
      try {
        await library.removeVideo(source.id);
      } catch (e) {
        console.error('[transcode] 元ファイルのライブラリ登録解除に失敗:', e);
      }
      if (disposal.method === 'quarantine') {
        // ゴミ箱が使えない外部ストレージ等: 退避先を長めに表示する
        toast.info(t('transcode.trashOriginalQuarantined', { location: disposal.location }), 15000);
      } else {
        toast.success(t('transcode.trashOriginalDone'));
      }
    },
  });
}
