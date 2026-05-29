import { useState } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { usePlaylistStore } from '../../store/usePlaylistStore';

interface Props {
  onClose: () => void;
}

type Phase = 'idle' | 'exporting' | 'importing' | 'done' | 'error';

export function ExportModal({ onClose }: Props) {
  const db = useLibraryStore((s) => s.db);
  const fetchVideos = useLibraryStore((s) => s.fetchVideos);
  const initTag = useTagStore((s) => s.init);
  const initPlaylist = usePlaylistStore((s) => s.init);

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');

  const handleExport = async () => {
    if (!db) return;

    const filePath = await save({
      defaultPath: `chuck-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return;

    setPhase('exporting');
    try {
      const [videos, categories, tags, tagCategories, videoTags, playlists, playlistItems, settings, watchDirs, smartPlaylists] =
        await Promise.all([
          db.select('SELECT * FROM videos'),
          db.select('SELECT * FROM categories'),
          db.select('SELECT * FROM tags'),
          db.select('SELECT * FROM tag_categories').catch(() => []),
          db.select('SELECT * FROM video_tags'),
          db.select('SELECT * FROM playlists'),
          db.select('SELECT * FROM playlist_items'),
          db.select('SELECT * FROM settings'),
          db.select('SELECT * FROM watch_dirs'),
          db.select('SELECT * FROM smart_playlists').catch(() => []),
        ]);

      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        videos, categories, tags, tagCategories, videoTags, playlists,
        playlistItems, settings, watchDirs, smartPlaylists,
      };

      await invoke('save_text_file', {
        path: filePath,
        content: JSON.stringify(backup, null, 2),
      });

      setPhase('done');
      setMessage(`エクスポート完了: ${filePath}`);
    } catch (e) {
      setPhase('error');
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleImport = async () => {
    if (!db) return;
    const filePath = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    });
    if (!filePath) return;

    setPhase('importing');
    try {
      const content = await invoke<string>('read_text_file', { path: filePath as string });
      const backup = JSON.parse(content);

      if (!backup.version || !backup.videos) {
        throw new Error('バックアップファイルの形式が正しくありません');
      }

      await db.execute('BEGIN');
      try {
        await db.execute('DELETE FROM playlist_items');
        await db.execute('DELETE FROM video_tags');
        await db.execute('DELETE FROM playlists');
        await db.execute('DELETE FROM videos');
        await db.execute('DELETE FROM tags');
        await db.execute('DELETE FROM categories');
        await db.execute('DELETE FROM smart_playlists').catch(() => {});

        for (const row of backup.categories ?? []) {
          await db.execute(
            'INSERT OR IGNORE INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)',
            [row.id, row.name, row.color, row.created_at]
          );
        }
        for (const row of backup.tags ?? []) {
          await db.execute(
            'INSERT OR IGNORE INTO tags (id, name, color, tag_category_id, created_at) VALUES (?, ?, ?, ?, ?)',
            [row.id, row.name, row.color, row.tag_category_id, row.created_at]
          );
        }
        for (const row of backup.videos ?? []) {
          await db.execute(
            `INSERT OR IGNORE INTO videos
              (id, path, title, duration, thumbnail, watched_at, progress, rating, category_id, has_audio, watch_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id, row.path, row.title, row.duration, row.thumbnail, row.watched_at,
             row.progress ?? 0, row.rating ?? 0, row.category_id, row.has_audio, row.watch_count ?? 0, row.created_at]
          );
        }
        for (const row of backup.videoTags ?? []) {
          await db.execute(
            'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)',
            [row.video_id, row.tag_id]
          );
        }
        for (const row of backup.playlists ?? []) {
          await db.execute(
            'INSERT OR IGNORE INTO playlists (id, name, created_at) VALUES (?, ?, ?)',
            [row.id, row.name, row.created_at]
          );
        }
        for (const row of backup.playlistItems ?? []) {
          await db.execute(
            'INSERT OR IGNORE INTO playlist_items (playlist_id, video_id, position) VALUES (?, ?, ?)',
            [row.playlist_id, row.video_id, row.position]
          );
        }
        for (const row of backup.smartPlaylists ?? []) {
          await db.execute(
            'INSERT OR IGNORE INTO smart_playlists (id, name, filter_json, created_at) VALUES (?, ?, ?, ?)',
            [row.id, row.name, row.filter_json, row.created_at]
          );
        }

        await db.execute('COMMIT');
      } catch (e) {
        await db.execute('ROLLBACK');
        throw e;
      }

      await fetchVideos();
      await initTag(db);
      await initPlaylist(db);

      setPhase('done');
      setMessage('インポート完了。ライブラリが更新されました。');
    } catch (e) {
      setPhase('error');
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">エクスポート / インポート</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            ライブラリのデータ（動画情報・タグ・プレイリスト）を JSON ファイルに保存/復元します。
          </p>

          {phase === 'idle' && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleExport}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
              >
                📤 バックアップをエクスポート
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium"
              >
                📥 バックアップからインポート
              </button>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ インポートすると現在のデータが上書きされます
              </p>
            </div>
          )}

          {(phase === 'exporting' || phase === 'importing') && (
            <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
              {phase === 'exporting' ? 'エクスポート中...' : 'インポート中...'}
            </div>
          )}

          {(phase === 'done' || phase === 'error') && (
            <div className="flex flex-col gap-3">
              <p className={`text-sm ${phase === 'done' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {message}
              </p>
              <button
                type="button"
                onClick={() => setPhase('idle')}
                className="w-full py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
              >
                戻る
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
