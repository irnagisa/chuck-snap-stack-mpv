import { useState } from 'react';
import { useTagStore } from '../../store/useTagStore';

interface Props {
  videoIds: number[];
  onClose: () => void;
  onDone: () => void;
}

export function BulkTagModal({ videoIds, onClose, onDone }: Props) {
  const { tags, addTagToMultiple } = useTagStore();
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const handleApply = async () => {
    if (selectedTagIds.size === 0) return;
    setLoading(true);
    try {
      for (const tagId of selectedTagIds) {
        await addTagToMultiple(videoIds, tagId);
      }
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-72 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
          一括タグ設定
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {videoIds.length} 件の動画に追加するタグを選択
        </p>

        {tags.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">タグがありません</p>
        ) : (
          <div className="flex flex-col gap-1.5 mb-4 max-h-60 overflow-y-auto">
            {tags.map((tag) => (
              <label
                key={tag.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded"
              >
                <input
                  type="checkbox"
                  checked={selectedTagIds.has(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                  className="rounded"
                />
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-sm text-gray-800 dark:text-gray-200">{tag.name}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading || selectedTagIds.size === 0}
            className="flex-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            onClick={handleApply}
          >
            {loading ? '処理中...' : `適用 (${selectedTagIds.size}件のタグ)`}
          </button>
          <button
            type="button"
            disabled={loading}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
            onClick={onClose}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
