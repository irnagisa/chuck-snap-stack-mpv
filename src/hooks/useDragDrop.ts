import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useToastStore } from '../store/useToastStore';
import { useModalStore } from '../store/useModalStore';

const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'flv', 'wmv', 'media']);

function getBasename(path: string) {
  return path.replace(/\\/g, '/').split('/').pop() ?? '';
}

function getFileStem(filename: string) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function isVideoPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? VIDEO_EXTENSIONS.has(ext) : false;
}

export function useDragDrop() {
  const [isDragging, setIsDragging] = useState(false);

  // watchDirs / actions を ref で保持して effect 再登録なしに最新値を参照
  const watchDirsRef = useRef<string[]>([]);
  const downloadDirRef = useRef<string>('');
  const addVideoFromPathRef = useRef<(path: string, title: string) => Promise<number | null>>(async () => null);
  const addToastRef = useRef<(message: string, type?: 'success' | 'error' | 'info') => void>(() => {});

  const watchDirs = useLibraryStore((s) => s.watchDirs);
  const addVideoFromPath = useLibraryStore((s) => s.addVideoFromPath);
  const downloadDir = useSettingsStore((s) => s.downloadDir);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => { watchDirsRef.current = watchDirs; }, [watchDirs]);
  useEffect(() => { downloadDirRef.current = downloadDir; }, [downloadDir]);
  useEffect(() => { addVideoFromPathRef.current = addVideoFromPath; }, [addVideoFromPath]);
  useEffect(() => { addToastRef.current = addToast; }, [addToast]);

  const pickDestDir = (files: string[]): Promise<string | null> =>
    new Promise((resolve) => {
      useModalStore.getState().openDndDestDir(files, resolve);
    });

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      unlistenFn = await getCurrentWindow().onDragDropEvent(async (event) => {
        const payload = event.payload as {
          type: 'enter' | 'over' | 'drop' | 'leave';
          paths?: string[];
        };

        if (payload.type === 'enter' || payload.type === 'over') {
          if (payload.paths?.some(isVideoPath)) {
            setIsDragging(true);
          }
        } else if (payload.type === 'leave') {
          setIsDragging(false);
        } else if (payload.type === 'drop') {
          setIsDragging(false);
          const dropped = (payload.paths ?? []).filter(isVideoPath);
          if (dropped.length === 0) return;

          const dirs = watchDirsRef.current;
          if (dirs.length === 0) {
            addToastRef.current('D&D インポートするにはまずフォルダを追加してください', 'error');
            return;
          }

          // watchDir 外のファイルがあるかチェック
          const normalizedDirsForCheck = dirs.map((dir) => dir.replace(/\\/g, '/').replace(/\/$/, ''));
          const outsideFiles = dropped.filter((path) => {
            const normPath = path.replace(/\\/g, '/');
            return !normalizedDirsForCheck.some((d) => normPath.startsWith(d + '/'));
          });

          // watchDir 外ファイルがあり watchDirs が複数の場合はユーザーにコピー先を選ばせる
          let destDir: string;
          if (outsideFiles.length > 0 && dirs.length > 1) {
            const picked = await pickDestDir(outsideFiles);
            if (picked === null) return;
            destDir = picked;
          } else {
            destDir = downloadDirRef.current || dirs[0];
          }

          let imported = 0;
          const errors: string[] = [];

          const normalizedDirs = normalizedDirsForCheck;

          for (const path of dropped) {
            const normPath = path.replace(/\\/g, '/');
            const isAlreadyInWatchDir = normalizedDirs.some((normDir) =>
              normPath.startsWith(normDir + '/')
            );

            try {
              if (isAlreadyInWatchDir) {
                // ウォッチ対象内にあるファイルは直接インポート (ウォッチャーは新規ファイルのみ検知)
                const title = getFileStem(getBasename(path));
                await addVideoFromPathRef.current(path, title);
              } else {
                // ウォッチ対象外はコピーしてから直接 DB 登録する。
                // ウォッチャーのイベントは遅延・欠落することがあるため、
                // copy_video_file が返す正規化済みパスで確実に addVideoFromPath を呼ぶ。
                // ウォッチャーが後で同じパスを通知しても INSERT OR IGNORE で無害に無視される。
                const newPath = await invoke<string>('copy_video_file', {
                  sourcePath: path,
                  destDir,
                });
                const title = getFileStem(getBasename(newPath));
                await addVideoFromPathRef.current(newPath, title);
              }
              imported++;
            } catch (e) {
              errors.push(getBasename(path));
              console.error(`D&D import failed for ${path}:`, e);
            }
          }

          if (imported > 0) {
            addToastRef.current(`${imported}件の動画をインポートしました`, 'success');
          }
          for (const name of errors) {
            addToastRef.current(`インポート失敗: ${name}`, 'error');
          }
        }
      });
      // setup 完了前に cleanup が走った場合は即座に解除
      if (cancelled) {
        unlistenFn?.();
      }
    };

    setup().catch(console.error);

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []); // ← 一度だけ登録。最新の値は ref 経由で参照

  return { isDragging };
}
