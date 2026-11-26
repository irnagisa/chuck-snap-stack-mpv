import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { computePhash, type VideoForPhash } from "../components/Library/phashCompute";
import type { UncheckedVideo, UnprobedVideo } from "../components/Library/storageTypes";
import { isForegroundCheckRunning } from "../lib/foregroundChecks";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useTranscodeStore } from "../store/useTranscodeStore";

/** 起動直後はライブラリやサムネイルの読み込みを先に回す */
const START_DELAY_MS = 60_000;
/** アプリを操作してからこれだけ経つまでは始めない */
const USER_IDLE_MS = 30_000;
/** 続けてよいかを確かめる間隔 */
const POLL_MS = 15_000;
/** 全部終わったあと、新しく増えた分を探しに行く間隔 */
const RESCAN_MS = 10 * 60_000;
/** 無音の確認で一度に取ってくる件数 */
const SILENCE_BATCH = 20;
/** 映像の情報 (ffprobe) を一度に取ってくる件数 */
const PROBE_BATCH = 50;

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/**
 * 何もしていないときに、整理画面の確認 (映像の情報・pHash・無音の簡易判定) を 1 本ずつ進めておく。
 * 結果は DB に保存されるので、整理画面を開いたときに待たずに済む。
 * 再生中・変換中・アプリを操作している間・画面から確認を始めている間は休む。
 * ffmpeg は優先度を下げて起動される (Rust の `background_command`)
 */
export function useBackgroundChecks() {
  const enabled = useSettingsStore((s) => s.isLoaded && s.backgroundChecks);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let lastInput = Date.now();
    const onInput = () => {
      lastInput = Date.now();
    };
    for (const e of INPUT_EVENTS) window.addEventListener(e, onInput, { passive: true, capture: true });

    /** 読めなかったもの (このセッションでは試し直さない) */
    const failedPhash = new Set<number>();
    const failedSilence = new Set<number>();
    const failedProbe = new Set<number>();

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const canRun = () => {
      const player = usePlayerStore.getState();
      return (
        Date.now() - lastInput >= USER_IDLE_MS &&
        !(player.currentVideo && !player.isPaused) &&
        !useTranscodeStore.getState().current &&
        !isForegroundCheckRunning()
      );
    };
    /** 続けてよくなるまで待つ。止められたら false */
    const waitUntilIdle = async () => {
      while (!stopped && !canRun()) await sleep(POLL_MS);
      return !stopped;
    };

    const runPhash = async () => {
      const pending = await invoke<VideoForPhash[]>("db_get_videos_without_phash").catch(() => []);
      for (const v of pending) {
        if (failedPhash.has(v.id)) continue;
        if (!(await waitUntilIdle())) return;
        if (!(await computePhash(v))) failedPhash.add(v.id);
      }
    };

    /** 高ビットレートの一覧で減る割合を見積もるための映像の情報 (先頭を読むだけで軽いので最初に) */
    const runProbe = async () => {
      while (!stopped) {
        const pending = (
          await invoke<UnprobedVideo[]>("get_videos_without_probe", { limit: PROBE_BATCH + failedProbe.size }).catch(
            () => [] as UnprobedVideo[],
          )
        ).filter((v) => !failedProbe.has(v.id));
        if (pending.length === 0) return;
        for (const v of pending.slice(0, PROBE_BATCH)) {
          if (!(await waitUntilIdle())) return;
          try {
            await invoke("probe_video_info", { videoId: v.id });
          } catch (e) {
            failedProbe.add(v.id);
            console.debug("[backgroundChecks] probe_video_info:", v.id, e);
          }
        }
      }
    };

    const runSilence = async () => {
      while (!stopped) {
        const pending = (
          await invoke<UncheckedVideo[]>("get_videos_without_silence_check", {
            limit: SILENCE_BATCH + failedSilence.size,
          }).catch(() => [] as UncheckedVideo[])
        ).filter((v) => !failedSilence.has(v.id));
        if (pending.length === 0) return;
        for (const v of pending.slice(0, SILENCE_BATCH)) {
          if (!(await waitUntilIdle())) return;
          try {
            await invoke("detect_silent_audio", { videoId: v.id });
          } catch (e) {
            failedSilence.add(v.id);
            console.debug("[backgroundChecks] detect_silent_audio:", v.id, e);
          }
        }
      }
    };

    void (async () => {
      await sleep(START_DELAY_MS);
      while (!stopped) {
        if (!(await waitUntilIdle())) return;
        await runProbe();
        if (stopped) return;
        await runPhash();
        if (stopped) return;
        await runSilence();
        await sleep(RESCAN_MS);
      }
    })();

    return () => {
      stopped = true;
      for (const e of INPUT_EVENTS) window.removeEventListener(e, onInput, { capture: true });
    };
  }, [enabled]);
}
