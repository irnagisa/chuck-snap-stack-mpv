import { usePlayerStore } from '../../store/usePlayerStore';

export function PlayerControls() {
  const { currentVideo, queue, queueIndex, quit, playNext, playPrev } = usePlayerStore();

  if (!currentVideo) return null;

  const hasPrev = queue.length > 0 && queueIndex > 0;
  const hasNext = queue.length > 0 && queueIndex < queue.length - 1;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white px-4 py-3 flex items-center gap-3 shadow-lg border-t border-gray-700">
      {queue.length > 0 && (
        <span className="text-xs text-gray-400 shrink-0">
          {queueIndex + 1} / {queue.length}
        </span>
      )}
      <span className="flex-1 text-sm truncate text-gray-300">
        {currentVideo.title ?? currentVideo.path}
      </span>
      {hasPrev && (
        <button
          onClick={playPrev}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm flex-shrink-0"
          title="前の動画"
        >
          ⏮
        </button>
      )}
      {hasNext && (
        <button
          onClick={playNext}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm flex-shrink-0"
          title="次の動画"
        >
          ⏭
        </button>
      )}
      <button
        onClick={quit}
        className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm flex-shrink-0"
        title="終了"
      >
        終了
      </button>
    </div>
  );
}
