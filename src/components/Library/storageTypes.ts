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
  trash: TrashUsage;
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
export type ListKind = "large" | "highBitrate" | "unwatched" | "staleInbox" | "longUnviewed";
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
}

export interface CleanupCandidates {
  totalCount: number;
  totalBytes: number;
  thresholdDays: number | null;
  minBitrateKbps: number | null;
  items: CleanupItem[];
}

export interface DuplicateGroup {
  /** すべてのファイルの中身が同じ */
  exact: boolean;
  keepId: number;
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
