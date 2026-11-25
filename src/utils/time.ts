export function formatTime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}

/**
 * SQLite の日時文字列を Date にする。
 * CURRENT_TIMESTAMP の "YYYY-MM-DD HH:MM:SS" は UTC だがタイムゾーンが付かず、
 * WebKit では解釈できないことがあるため ISO 形式に直して読む。
 */
export function parseSqliteDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
