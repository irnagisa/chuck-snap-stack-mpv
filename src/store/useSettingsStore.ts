import { create } from "zustand";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  mpvPath: string;
  ffmpegPath: string;
  ffprobePath: string;
}

const DEFAULTS: AppSettings = {
  mpvPath: "/opt/homebrew/bin/mpv",
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
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
      "SELECT key, value FROM settings WHERE key IN ('mpv_path', 'ffmpeg_path', 'ffprobe_path')"
    );

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }

    const settings: AppSettings = {
      mpvPath: map["mpv_path"] ?? DEFAULTS.mpvPath,
      ffmpegPath: map["ffmpeg_path"] ?? DEFAULTS.ffmpegPath,
      ffprobePath: map["ffprobe_path"] ?? DEFAULTS.ffprobePath,
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

    set({ ...settings });
    await syncToRust(settings);
  },
}));
