import { useTranslation } from "react-i18next";
import { useShallow } from 'zustand/shallow';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useModalStore } from '../../store/useModalStore';

function formatTime(sec: number | null): string {
  if (!sec) return '--:--';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// playerControls の高さ分だけ bottom をずらす (約 80px)
const PLAYER_HEIGHT = 84;

export function QueuePanel() {
  const { t } = useTranslation();
  const { queue, queueIndex, jumpToQueue, removeFromQueue } = usePlayerStore(
    useShallow((s) => ({
      queue: s.queue,
      queueIndex: s.queueIndex,
      jumpToQueue: s.jumpToQueue,
      removeFromQueue: s.removeFromQueue,
    }))
  );
  const { showQueuePanel, closeQueuePanel } = useModalStore(
    useShallow((s) => ({
      showQueuePanel: s.showQueuePanel,
      closeQueuePanel: s.closeQueuePanel,
    }))
  );

  if (!showQueuePanel || queue.length === 0) return null;

  return (
    <div
      className="fixed right-0 z-40 bg-gray-900 border-l border-gray-700 shadow-xl flex flex-col"
      style={{ bottom: PLAYER_HEIGHT, top: 0, width: 280 }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <span className="text-sm font-medium text-gray-200">{t('queue.title', { count: queue.length })}</span>
        <button
          type="button"
          onClick={closeQueuePanel}
          className="text-gray-400 hover:text-gray-200 text-lg leading-none"
          title={t('queue.close')}
        >
          ×
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {queue.map((video, idx) => {
          const isCurrent = idx === queueIndex;
          return (
            <div
              key={`${video.id}-${idx}`}
              className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer group transition-colors ${
                isCurrent
                  ? 'bg-blue-600/30 border-l-2 border-blue-500'
                  : 'hover:bg-gray-800 border-l-2 border-transparent'
              }`}
              onClick={() => jumpToQueue(idx)}
            >
              {/* サムネイル */}
              <div className="w-12 h-8 rounded overflow-hidden shrink-0 bg-gray-700">
                {video.thumbnail ? (
                  <img
                    src={convertFileSrc(video.thumbnail)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">▶</div>
                )}
              </div>

              {/* タイトル + 時間 */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs truncate ${isCurrent ? 'text-blue-200 font-medium' : 'text-gray-300'}`}>
                  {video.title ?? video.path.split('/').pop()}
                </p>
                <p className="text-xs text-gray-500 tabular-nums">
                  {formatTime(video.duration)}
                </p>
              </div>

              {/* 削除ボタン (非現在曲のみ) */}
              {!isCurrent && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromQueue(video.id);
                  }}
                  className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-sm shrink-0 transition-opacity"
                  title={t('queue.remove')}
                >
                  ×
                </button>
              )}
              {isCurrent && (
                <span className="text-blue-400 text-xs shrink-0">▶</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
