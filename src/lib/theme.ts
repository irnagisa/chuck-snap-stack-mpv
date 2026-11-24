import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "../store/useSettingsStore";

export type ResolvedTheme = "light" | "dark";

/** 設定 (DB) 読込前でも直前のテーマで描画できるようにするキャッシュ */
const STORAGE_KEY = "themePreference";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(pref: Theme): ResolvedTheme {
  if (pref === "auto") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

export function readCachedTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    /* ストレージ不可の環境では既定値 */
  }
  return "auto";
}

export function cacheTheme(pref: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* noop */
  }
}

/** OS の明暗設定の変更を購読する。戻り値で購読解除 */
export function watchSystemTheme(onChange: (isDark: boolean) => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  const listener = (e: MediaQueryList | MediaQueryListEvent) => onChange(e.matches);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

function currentTheme(): ResolvedTheme | null {
  const cl = document.documentElement.classList;
  if (cl.contains("dark")) return "dark";
  if (cl.contains("light")) return "light";
  return null;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * <html> に .light / .dark を付ける。
 * - .dark は Tailwind の dark: バリアント用、両クラスとも tokens.css の color-scheme 用
 * - animate=true なら View Transitions API で画面全体をクロスフェードする
 *   (個々の要素の CSS トランジションがバラバラに走らないよう、切替中は .theme-switching で止める)
 */
export function applyTheme(theme: ResolvedTheme, { animate = false } = {}): void {
  const current = currentTheme();
  if (current === theme) return;

  const root = document.documentElement;
  const swap = () => {
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
  };

  if (!animate || current === null || prefersReducedMotion() || typeof document.startViewTransition !== "function") {
    swap();
    return;
  }

  root.classList.add("theme-switching");
  const transition = document.startViewTransition(swap);
  transition.finished.finally(() => root.classList.remove("theme-switching"));
}

/**
 * ネイティブウィンドウ (タイトルバー・WebView の prefers-color-scheme) のテーマを合わせる。
 * auto のときは null を渡して OS 追従に戻す。
 */
export function syncNativeWindowTheme(pref: Theme): void {
  if (!isTauri()) return;
  try {
    getCurrentWindow()
      .setTheme(pref === "auto" ? null : pref)
      .catch(() => {});
  } catch {
    /* noop */
  }
}

/** main.tsx で React の初回描画より前に呼ぶ (起動時のちらつき防止) */
export function initTheme(): void {
  applyTheme(resolveTheme(readCachedTheme()));
}
