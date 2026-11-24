import { useEffect, useRef } from "react";
import { useSettingsStore } from "../store/useSettingsStore";
import {
  applyTheme,
  cacheTheme,
  resolveTheme,
  syncNativeWindowTheme,
  watchSystemTheme,
} from "../lib/theme";

/**
 * 設定のテーマ (light / dark / auto) を画面に反映する。
 * auto のときは OS の外観設定に追従し、変更もリアルタイムに反映する。
 * 起動直後の反映は main.tsx の initTheme() が担当し、ここでは設定読込後の確定と変更を扱う。
 */
export function useTheme() {
  const theme = useSettingsStore((s) => s.theme);
  const isLoaded = useSettingsStore((s) => s.isLoaded);
  // 設定読込直後の 1 回目はアニメーションしない (キャッシュとの差分をそのまま確定させる)
  const settled = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    const animate = settled.current;
    settled.current = true;

    cacheTheme(theme);
    syncNativeWindowTheme(theme);
    applyTheme(resolveTheme(theme), { animate });

    if (theme !== "auto") return;
    return watchSystemTheme((isDark) => applyTheme(isDark ? "dark" : "light", { animate: true }));
  }, [theme, isLoaded]);
}
