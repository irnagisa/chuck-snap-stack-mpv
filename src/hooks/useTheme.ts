import { useEffect } from "react";
import { useSettingsStore } from "../store/useSettingsStore";

export function useTheme() {
  const theme = useSettingsStore((s) => s.theme);
  const isLoaded = useSettingsStore((s) => s.isLoaded);

  useEffect(() => {
    if (!isLoaded) return;
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      return;
    }
    if (theme === "light") {
      root.classList.remove("dark");
      return;
    }
    // 'auto': OS 設定に追従
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (e: MediaQueryList | MediaQueryListEvent) => {
      root.classList.toggle("dark", e.matches);
    };
    apply(mq);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, isLoaded]);
}
