import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";

interface Stats {
  totalVideos: number;
  watchedCount: number;
  totalDurationSec: number;
  avgRating: number;
  categoryStats: { name: string; count: number }[];
  topRated: { title: string | null; path: string; rating: number }[];
  recentlyWatched: { title: string | null; path: string; watchedAt: string }[];
  topWatched: { title: string | null; path: string; watchCount: number }[];
  topTags: { name: string; count: number }[];
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

function BarChart({ items, max }: { items: { label: string; value: number }[]; max: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-28 truncate shrink-0 text-right">{item.label}</span>
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className="bg-blue-500 rounded-full h-3 transition-all"
              style={{ width: max > 0 ? `${(item.value / max) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-300 w-6 text-right shrink-0 tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export function StatsModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await invoke<Stats>('db_get_library_stats');
        setStats(data);
      } catch (e) {
        console.error('Stats load failed:', e);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const watchedPct = stats && stats.totalVideos > 0
    ? Math.round((stats.watchedCount / stats.totalVideos) * 100)
    : 0;

  const maxCatCount = Math.max(...(stats?.categoryStats.map((c) => c.count) ?? [1]), 1);
  const maxTagCount = Math.max(...(stats?.topTags.map((t) => t.count) ?? [1]), 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('stats.title')}</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {isLoading ? (
            <div className="text-center py-10 text-gray-400">{t('stats.loading')}</div>
          ) : !stats ? (
            <div className="text-center py-10 text-gray-400">{t('stats.error')}</div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* サマリーカード */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: t('stats.totalVideos'), value: `${stats.totalVideos}${t('stats.totalVideosUnit')}` },
                  { label: t('stats.totalDuration'), value: formatDuration(stats.totalDurationSec) },
                  { label: t('stats.watched'), value: `${stats.watchedCount}${t('stats.watchedUnit')} (${watchedPct}%)` },
                  { label: t('stats.avgRating'), value: stats.avgRating > 0 ? `★ ${stats.avgRating.toFixed(1)}` : '—' },
                ].map((card) => (
                  <div key={card.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <p className="text-xs text-gray-400 dark:text-gray-500">{card.label}</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{card.value}</p>
                  </div>
                ))}
              </div>

              {/* 視聴進捗バー */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('stats.watchProgress')}</span>
                  <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums">
                    {stats.watchedCount} / {stats.totalVideos}
                  </span>
                </div>
                <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${watchedPct}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {/* カテゴリ別 */}
                {stats.categoryStats.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">{t('stats.categoryStats')}</h3>
                    <BarChart
                      items={stats.categoryStats.map((c) => ({ label: c.name, value: c.count }))}
                      max={maxCatCount}
                    />
                  </div>
                )}

                {/* タグ使用数 */}
                {stats.topTags.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">{t('stats.topTags')}</h3>
                    <BarChart
                      items={stats.topTags.map((tag) => ({ label: tag.name, value: tag.count }))}
                      max={maxTagCount}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                {/* 高評価 Top5 */}
                {stats.topRated.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">{t('stats.topRated')}</h3>
                    <ol className="flex flex-col gap-1.5">
                      {stats.topRated.map((v, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400 w-4 shrink-0 tabular-nums">{i + 1}.</span>
                          <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">
                            {v.title ?? v.path.split('/').pop()}
                          </span>
                          <span className="text-xs text-yellow-500 shrink-0">{'★'.repeat(v.rating)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* 最近視聴 */}
                {stats.recentlyWatched.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">{t('stats.recentWatched')}</h3>
                    <ol className="flex flex-col gap-1.5">
                      {stats.recentlyWatched.map((v, i) => (
                        <li key={i} className="flex flex-col">
                          <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                            {v.title ?? v.path.split('/').pop()}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(v.watchedAt).toLocaleDateString('ja-JP')}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* 再生回数 Top5 */}
                {stats.topWatched.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">{t('stats.topPlayed')}</h3>
                    <ol className="flex flex-col gap-1.5">
                      {stats.topWatched.map((v, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400 w-4 shrink-0 tabular-nums">{i + 1}.</span>
                          <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">
                            {v.title ?? v.path.split('/').pop()}
                          </span>
                          <span className="text-xs text-gray-500 shrink-0 tabular-nums">{v.watchCount}{t('stats.playCountUnit')}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
