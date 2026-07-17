import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import i18n, { type Language } from "../i18n";

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

/** i18n キーのみ残す（表示は t('keybindings.xxx') で行う） */
export const KEY_ACTION_KEYS: Record<KeyAction, string> = {
  pause: 'keybindings.pause',
  seekForward: 'keybindings.seekForward',
  seekBackward: 'keybindings.seekBackward',
  volumeUp: 'keybindings.volumeUp',
  volumeDown: 'keybindings.volumeDown',
  fullscreen: 'keybindings.fullscreen',
  next: 'keybindings.next',
  prev: 'keybindings.prev',
  escape: 'keybindings.escape',
};

export type Theme = 'light' | 'dark' | 'auto';

export type CategoryMode = 'virtual' | 'sync';

export type AiModelType = 'wd-tagger' | 'joytag';

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
  language: Language;
  categoryMode: CategoryMode;
  aiEnabled: boolean;
  aiModelType: AiModelType;
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
  language: "ja",
  categoryMode: 'virtual',
  aiEnabled: false,
  aiModelType: 'wd-tagger',
};

interface SettingsStore extends AppSettings {
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  saveKeybindings: (bindings: KeyBindings) => Promise<void>;
  setCategoryMode: (mode: CategoryMode) => Promise<void>;
  setAiModelType: (type: AiModelType) => Promise<void>;
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

    const language = (map["language"] as Language | undefined) ?? DEFAULTS.language;
    await i18n.changeLanguage(language);

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
      language,
      categoryMode: (map["category_mode"] as CategoryMode | undefined) ?? 'virtual',
      aiEnabled: map["ai_enabled"] === "true",
      aiModelType: (map["ai_model_type"] as AiModelType | undefined) ?? 'wd-tagger',
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
      language: settings.language,
      aiEnabled: settings.aiEnabled,
    });
    await i18n.changeLanguage(settings.language);
    // categoryMode・aiModelType は独立したコマンドで管理するため上書きしない
    set((state) => ({ ...settings, categoryMode: state.categoryMode, aiModelType: state.aiModelType }));
    await syncToRust(settings);
  },

  saveKeybindings: async (bindings: KeyBindings) => {
    await invoke("db_save_keybindings", { bindingsJson: JSON.stringify(bindings) });
    set({ keybindings: bindings });
  },

  setCategoryMode: async (mode: CategoryMode) => {
    await invoke("db_set_setting", { key: "category_mode", value: mode });
    set({ categoryMode: mode });
  },

  setAiModelType: async (type: AiModelType) => {
    await invoke("db_set_setting", { key: "ai_model_type", value: type });
    set({ aiModelType: type });
  },
}));
