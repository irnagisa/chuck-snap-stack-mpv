import { useState } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';

interface Props {
  onClose: () => void;
}

export function SmartPlaylistModal({ onClose }: Props) {
  const {
    db, filterSearch, filterCategoryId, filterTagIds, filterMinRating,
    filterHasAudio, filterMinDuration, filterWatchedStatus, filterSortBy, filterSortOrder,
  } = useLibraryStore();

  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!db || !name.trim()) return;
    setIsSaving(true);
    try {
      const filterState = {
        filterSearch, filterCategoryId, filterTagIds, filterMinRating,
        filterHasAudio, filterMinDuration, filterWatchedStatus, filterSortBy, filterSortOrder,
      };
      await db.execute(
        'INSERT INTO smart_playlists (name, filter_json) VALUES (?, ?)',
        [name.trim(), JSON.stringify(filterState)]
      );
      setSaved(true);
    } catch (e) {
      console.error('Smart playlist save failed:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const filterSummary: string[] = [];
  if (filterSearch) filterSummary.push(`検索: "${filterSearch}"`);
  if (filterCategoryId !== null) filterSummary.push(`カテゴリフィルター適用`);
  if (filterTagIds.length > 0) filterSummary.push(`タグ: ${filterTagIds.length}件`);
  if (filterMinRating > 0) filterSummary.push(`評価: ${filterMinRating}★以上`);
  if (filterHasAudio !== null) filterSummary.push(`音声: ${filterHasAudio ? 'あり' : 'なし'}`);
  if (filterMinDuration > 0) filterSummary.push(`最短: ${filterMinDuration}秒`);
  if (filterWatchedStatus !== 'all') filterSummary.push(filterWatchedStatus === 'watched' ? '視聴済み' : '未視聴');

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
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">スマートプレイリストを保存</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {saved ? (
            <div className="flex flex-col gap-3 text-center">
              <p className="text-green-600 dark:text-green-400 text-sm">保存しました！</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                サイドバーの「スマートプレイリスト」セクションから呼び出せます。
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
              >
                閉じる
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  現在のフィルター条件
                </label>
                {filterSummary.length > 0 ? (
                  <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                    {filterSummary.map((s, i) => (
                      <li key={i}>• {s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                    フィルターなし（全動画）
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  プレイリスト名
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500"
                  placeholder="例: 未視聴の高評価動画"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!name.trim() || isSaving}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                >
                  {isSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
