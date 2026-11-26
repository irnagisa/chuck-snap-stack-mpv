// ストレージ整理の型 (src-tauri/src/commands/storage.rs・storage_duplicates.rs と対応)

export interface SizeBucket {
  key: string;
  count: number;
  bytes: number;
}

export interface QuarantineDir {
  path: string;
  fileCount: number;
  bytes: number;
}

export interface TrashUsage {
  /** macOS ではフルディスクアクセスがないと読めないため null */
  osTrashBytes: number | null;
  quarantine: QuarantineDir[];
  quarantineBytes: number;
}

export interface StorageOverview {
  library: {
    count: number;
    bytes: number;
    unknownSizeCount: number;
    missingCount: number;
    byMediaType: SizeBucket[];
    byExtension: SizeBucket[];
  };
  thumbnails: {
    fileCount: number;
    bytes: number;
    orphanCount: number;
    orphanBytes: number;
    oversizedCount: number;
    oversizedBytes: number;
  };
  databaseBytes: number;
  aiModelBytes: number;
  aiModels: AiModelUsage[];
  /** 設定で AI タグ提案を有効にしているか */
  aiEnabled: boolean;
  trash: TrashUsage;
}

export interface AiModelUsage {
  /** 設定 ai_model_type の値 */
  modelType: "wd-tagger" | "joytag";
  /** 中断したダウンロードの残りも含む */
  bytes: number;
  /** 設定で選んでいるモデル */
  selected: boolean;
}

/** 途中で止まった処理の残りファイル (src-tauri/src/commands/storage_leftovers.rs) */
export type LeftoverKind = "download" | "transcode" | "aiDownload";

export interface LeftoverFile {
  path: string;
  kind: LeftoverKind;
  bytes: number;
  /** 最終更新 (Unix ミリ秒) */
  modifiedMs: number | null;
}

export interface LeftoverFiles {
  totalCount: number;
  totalBytes: number;
  /** 容量の大きい順 (上位だけ) */
  files: LeftoverFile[];
}

export interface LeftoverCleanupResult {
  removedFiles: number;
  freedBytes: number;
}

export interface ThumbnailCleanupResult {
  removedOrphans: number;
  resetOversized: number;
  freedBytes: number;
}

export interface QuarantineCleanupResult {
  removedFiles: number;
  freedBytes: number;
}

/** get_cleanup_candidates の種類 */
export type ListKind = "large" | "highBitrate" | "unwatched" | "staleInbox" | "longUnviewed" | "silentAudio";
/** 画面で選べる整理候補の種類 (重複は別のコマンドで取る) */
export type CandidateKind = ListKind | "duplicates";

export interface CleanupItem {
  id: number;
  path: string;
  title: string | null;
  thumbnail: string | null;
  fileSize: number;
  mediaType: string;
  rating: number;
  watchCount: number;
  createdAt: string;
  lastSeenAt: string | null;
  duration: number | null;
  categoryId: number | null;
  /** 他のファイルと共有していない (消すと空く) 容量。重複の一覧でだけ入る */
  privateBytes?: number;
  /** 同じグループで互いに APFS のクローン (中身を共有) になっているものに同じ番号 */
  cloneGroup?: number;
  /** 無音と分かった音声トラックの番号 (無音のトラックがなければ入らない) */
  silentStreams?: number[];
  /** 無音のトラックが使っている容量の見込み (外すと空く) */
  silentBytes?: number;
  /** 無音のトラックは一部を読んだだけの簡易判定 (外す前に全体を読んで確かめる) */
  silentSampled?: boolean;
  /**
   * AV1 に変換したとき、ファイル全体のうち減る割合の見積もり (0〜1)。高ビットレートの一覧でだけ入る。
   * 解像度・fps・コーデック・ビットレートからの目安 (映像の中身までは分からない)
   */
  savingRatio?: number;
}

export interface CleanupCandidates {
  totalCount: number;
  totalBytes: number;
  thresholdDays: number | null;
  minBitrateKbps: number | null;
  /** まだ調べていない動画の数 (silentAudio: 音量、highBitrate: 映像の情報) */
  uncheckedCount?: number;
  items: CleanupItem[];
}

// ── 無音の音声トラック (src-tauri/src/commands/silent_audio.rs) ─────────────

export type AudioSilence = "none" | "partial" | "all";

/** get_audio_silence の戻り値 (調べていなければ null) */
export interface StoredSilence {
  status: AudioSilence;
  silentStreams: number[];
  silentBytes: number;
  /** 無音のトラックは一部を読んだだけの簡易判定 (無音のトラックがなければ false) */
  sampled: boolean;
}

/** detect_silent_audio の戻り値 */
export interface SilenceReport extends StoredSilence {
  tracks: { index: number; peakDb: number | null; silent: boolean }[];
}

export interface UncheckedVideo {
  id: number;
  path: string;
}

/** get_videos_without_probe の戻り値 (src-tauri/src/commands/media_probe.rs) */
export interface UnprobedVideo {
  id: number;
}

/** 変換で減る割合の見積もりを表示用に丸める (5% 刻み) */
export function roundedSavingPercent(ratio: number): number {
  return Math.round(ratio * 20) * 5;
}

export interface DuplicateGroup {
  /** すべてのファイルの中身が同じ */
  exact: boolean;
  keepId: number;
  /** 残すもの以外を消したときに空く容量 (クローンで共有している分は除く) */
  reclaimableBytes: number;
  /** 残すものが先頭 */
  items: CleanupItem[];
}

export interface DuplicateGroups {
  totalGroups: number;
  totalReclaimableBytes: number;
  phashMissingCount: number;
  groups: DuplicateGroup[];
}

/** ビットレート (kbps)。長さが分からなければ null */
export function bitrateKbps(item: Pick<CleanupItem, "fileSize" | "duration">): number | null {
  return item.duration && item.duration > 0 ? (item.fileSize * 8) / 1000 / item.duration : null;
}

/**
 * グループのうち `removed` を消したときに空く容量の見込み
 * (src-tauri/src/commands/storage_duplicates.rs の `freed_bytes` と同じ規則)。
 * - クローンでないもの: 共有していない容量 (分からなければファイルサイズ)
 * - 残すものとクローンのもの: 共有していない容量だけ (共有分は残すものが使い続ける)
 * - 消すものどうしだけでクローンのもの: 共有分は 1 回だけ数える
 */
export function freedBytes(items: CleanupItem[], removed: (item: CleanupItem) => boolean): number {
  const privateOf = (it: CleanupItem) => Math.min(it.privateBytes ?? it.fileSize, it.fileSize);
  const keptGroups = new Set<number>();
  for (const it of items) if (!removed(it) && it.cloneGroup != null) keptGroups.add(it.cloneGroup);
  const counted = new Set<number>();
  let total = 0;
  for (const it of items) {
    if (!removed(it)) continue;
    const g = it.cloneGroup;
    if (g != null && !keptGroups.has(g) && !counted.has(g)) {
      counted.add(g);
      total += it.fileSize;
    } else {
      total += privateOf(it);
    }
  }
  return total;
}
