import { create } from "zustand";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  mpvPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  downloadDir: string;
}

const DEFAULTS: AppSettings = {
  mpvPath: "/usr/local/bin/mpv",
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
  downloadDir: "",
};

interface SettingsStore extends AppSettings {
  isLoaded: boolean;
  loadSettings: (db: Database) => Promise<void>;
  saveSettings: (db: Database, settings: AppSettings) => Promise<void>;
}

async function syncToRust(settings: AppSettings) {
  await invoke("update_settings", {
    mpvPath: settings.mpvPath,
    ffmpegPath: settings.ffmpegPath,
    ffprobePath: settings.ffprobePath,
  });
}

// 保存済みパスが存在する場合はそれを使い、存在しない場合は自動検出にフォールバック
async function resolveMpvPath(saved: string | undefined): Promise<string> {
  if (saved && saved.trim().length > 0) {
    const exists = await invoke<boolean>("path_exists", { path: saved }).catch(() => false);
    if (exists) return saved;
  }
  try {
    return await invoke<string>("get_default_mpv_path");
  } catch {
    return DEFAULTS.mpvPath;
  }
}


export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULTS,
  isLoaded: false,

  loadSettings: async (db: Database) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const rows = await db.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM settings WHERE key IN ('mpv_path', 'ffmpeg_path', 'ffprobe_path', 'download_dir')"
    );

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }

    // DB に保存されたパスが存在しない場合はデフォルトにフォールバック
    const savedMpvPath = map["mpv_path"];
    const resolvedMpvPath = await resolveMpvPath(savedMpvPath);

    const settings: AppSettings = {
      mpvPath: resolvedMpvPath,
      ffmpegPath: map["ffmpeg_path"] ?? DEFAULTS.ffmpegPath,
      ffprobePath: map["ffprobe_path"] ?? DEFAULTS.ffprobePath,
      downloadDir: map["download_dir"] ?? DEFAULTS.downloadDir,
    };

    set({ ...settings, isLoaded: true });
    await syncToRust(settings);
  },

  saveSettings: async (db: Database, settings: AppSettings) => {
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('mpv_path', ?)",
      [settings.mpvPath]
    );
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('ffmpeg_path', ?)",
      [settings.ffmpegPath]
    );
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('ffprobe_path', ?)",
      [settings.ffprobePath]
    );
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('download_dir', ?)",
      [settings.downloadDir]
    );

    set({ ...settings });
    await syncToRust(settings);
  },
}));
