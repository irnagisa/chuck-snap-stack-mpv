import { create } from "zustand";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

export type KeyAction =
  | 'pause'
  | 'seekForward'
  | 'seekBackward'
  | 'volumeUp'
  | 'volumeDown'
  | 'fullscreen'
  | 'next'
  | 'prev'
  | 'escape';

export type KeyBindings = Record<KeyAction, string>;

export const DEFAULT_KEYBINDINGS: KeyBindings = {
  pause: ' ',
  seekForward: 'ArrowRight',
  seekBackward: 'ArrowLeft',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  fullscreen: 'f',
  next: 'n',
  prev: 'p',
  escape: 'Escape',
};

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  pause: '一時停止/再開',
  seekForward: '5秒進む',
  seekBackward: '5秒戻る',
  volumeUp: '音量+',
  volumeDown: '音量-',
  fullscreen: 'フルスクリーン',
  next: '次の動画',
  prev: '前の動画',
  escape: 'モーダルを閉じる',
};

export type Theme = 'light' | 'dark' | 'auto';

export interface AppSettings {
  mpvPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  ytdlpPath: string;
  downloadDir: string;
  screenshotDir: string;
  keybindings: KeyBindings;
  theme: Theme;
}

const DEFAULTS: AppSettings = {
  mpvPath: "/usr/local/bin/mpv",
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
  ytdlpPath: "",
  downloadDir: "",
  screenshotDir: "",
  keybindings: DEFAULT_KEYBINDINGS,
  theme: "auto",
};

interface SettingsStore extends AppSettings {
  isLoaded: boolean;
  loadSettings: (db: Database) => Promise<void>;
  saveSettings: (db: Database, settings: AppSettings) => Promise<void>;
  saveKeybindings: (db: Database, bindings: KeyBindings) => Promise<void>;
}

async function syncToRust(settings: AppSettings) {
  await invoke("update_settings", {
    mpvPath: settings.mpvPath,
    ffmpegPath: settings.ffmpegPath,
    ffprobePath: settings.ffprobePath,
    ytdlpPath: settings.ytdlpPath,
  });
}

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
      "SELECT key, value FROM settings WHERE key IN ('mpv_path', 'ffmpeg_path', 'ffprobe_path', 'ytdlp_path', 'download_dir', 'screenshot_dir', 'keybindings', 'theme')"
    );

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }

    const savedMpvPath = map["mpv_path"];
    const resolvedMpvPath = await resolveMpvPath(savedMpvPath);

    let keybindings = DEFAULT_KEYBINDINGS;
    if (map["keybindings"]) {
      try {
        const parsed = JSON.parse(map["keybindings"]) as Partial<KeyBindings>;
        keybindings = { ...DEFAULT_KEYBINDINGS, ...parsed };
      } catch { /* use defaults */ }
    }

    const settings: AppSettings = {
      mpvPath: resolvedMpvPath,
      ffmpegPath: map["ffmpeg_path"] ?? DEFAULTS.ffmpegPath,
      ffprobePath: map["ffprobe_path"] ?? DEFAULTS.ffprobePath,
      ytdlpPath: map["ytdlp_path"] ?? DEFAULTS.ytdlpPath,
      downloadDir: map["download_dir"] ?? DEFAULTS.downloadDir,
      screenshotDir: map["screenshot_dir"] ?? DEFAULTS.screenshotDir,
      keybindings,
      theme: (map["theme"] as Theme | undefined) ?? DEFAULTS.theme,
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
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('ytdlp_path', ?)",
      [settings.ytdlpPath]
    );
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('download_dir', ?)",
      [settings.downloadDir]
    );
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('screenshot_dir', ?)",
      [settings.screenshotDir]
    );
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)",
      [settings.theme]
    );

    set({ ...settings });
    await syncToRust(settings);
  },

  saveKeybindings: async (db: Database, bindings: KeyBindings) => {
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('keybindings', ?)",
      [JSON.stringify(bindings)]
    );
    set({ keybindings: bindings });
  },
}));
