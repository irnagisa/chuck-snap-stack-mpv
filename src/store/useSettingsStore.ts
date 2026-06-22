import { create } from "zustand";
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
  autoPlayNext: boolean;
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
  autoPlayNext: false,
};

interface SettingsStore extends AppSettings {
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  saveKeybindings: (bindings: KeyBindings) => Promise<void>;
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

  loadSettings: async () => {
    const map = await invoke<Record<string, string>>("db_load_settings");

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
      autoPlayNext: map["auto_play_next"] === "true",
    };

    set({ ...settings, isLoaded: true });
    await syncToRust(settings);
  },

  saveSettings: async (settings: AppSettings) => {
    await invoke("db_save_settings", {
      mpvPath: settings.mpvPath,
      ffmpegPath: settings.ffmpegPath,
      ffprobePath: settings.ffprobePath,
      ytdlpPath: settings.ytdlpPath,
      downloadDir: settings.downloadDir,
      screenshotDir: settings.screenshotDir,
      theme: settings.theme,
      autoPlayNext: settings.autoPlayNext,
    });
    set({ ...settings });
    await syncToRust(settings);
  },

  saveKeybindings: async (bindings: KeyBindings) => {
    await invoke("db_save_keybindings", { bindingsJson: JSON.stringify(bindings) });
    set({ keybindings: bindings });
  },
}));
