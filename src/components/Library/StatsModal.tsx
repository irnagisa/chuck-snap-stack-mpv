import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { LoaderCircle, Star } from 'lucide-react';
import { Dialog, useDialogClose } from '../ui';
import styles from './StatsModal.module.css';

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

function formatDuration(sec: number, t: TFunction): string {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return hours > 0
    ? t('stats.durationHours', { hours, minutes })
    : t('stats.durationMinutes', { minutes });
}

function BarChart({ items, max }: { items: { label: string; value: number }[]; max: number }) {
  return (
    <div className={styles.bars}>
      {items.map((item) => (
        <div key={item.label} className={styles.barRow}>
          <span className={styles.barLabel} title={item.label}>{item.label}</span>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: max > 0 ? `${(item.value / max) * 100}%` : '0%' }} />
          </div>
          <span className={styles.barValue}>{item.value}</span>
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
  const dialog = useDialogClose(onClose);

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
    <Dialog {...dialog.props} size="lg" title={t('stats.title')} closeLabel={t('confirm.close')}>
      {isLoading ? (
        <div className={styles.status}>
          <LoaderCircle className={styles.spinner} aria-hidden />
          {t('stats.loading')}
        </div>
      ) : !stats ? (
        <div className={styles.status}>{t('stats.error')}</div>
      ) : (
        <div className={styles.root}>
          {/* サマリー */}
          <div className={styles.summary}>
            {[
              { label: t('stats.totalVideos'), value: `${stats.totalVideos}${t('stats.totalVideosUnit')}` },
              { label: t('stats.totalDuration'), value: formatDuration(stats.totalDurationSec, t) },
              { label: t('stats.watched'), value: `${stats.watchedCount}${t('stats.watchedUnit')} (${watchedPct}%)` },
              { label: t('stats.avgRating'), value: stats.avgRating > 0 ? `★ ${stats.avgRating.toFixed(1)}` : '—' },
            ].map((card) => (
              <div key={card.label} className={styles.tile}>
                <p className={styles.tileLabel}>{card.label}</p>
                <p className={styles.tileValue}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* 視聴進捗 */}
          <div>
            <div className={styles.progressHead}>
              <span>{t('stats.watchProgress')}</span>
              <span className={styles.num}>{stats.watchedCount} / {stats.totalVideos}</span>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${watchedPct}%` }} />
            </div>
          </div>

          <div className={styles.cols2}>
            {stats.categoryStats.length > 0 && (
              <section>
                <h3 className={styles.heading}>{t('stats.categoryStats')}</h3>
                <BarChart items={stats.categoryStats.map((c) => ({ label: c.name, value: c.count }))} max={maxCatCount} />
              </section>
            )}
            {stats.topTags.length > 0 && (
              <section>
                <h3 className={styles.heading}>{t('stats.topTags')}</h3>
                <BarChart items={stats.topTags.map((tag) => ({ label: tag.name, value: tag.count }))} max={maxTagCount} />
              </section>
            )}
          </div>

          <div className={styles.cols3}>
            {stats.topRated.length > 0 && (
              <section>
                <h3 className={styles.heading}>{t('stats.topRated')}</h3>
                <ol className={styles.rank}>
                  {stats.topRated.map((v, i) => (
                    <li key={i}>
                      <span className={styles.rankNo}>{i + 1}</span>
                      <span className={styles.rankTitle}>{v.title ?? v.path.split('/').pop()}</span>
                      <span className={styles.stars} aria-label={`★${v.rating}`}>
                        <Star aria-hidden fill="currentColor" />
                        {v.rating}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {stats.recentlyWatched.length > 0 && (
              <section>
                <h3 className={styles.heading}>{t('stats.recentWatched')}</h3>
                <ol className={styles.rank}>
                  {stats.recentlyWatched.map((v, i) => (
                    <li key={i} className={styles.rankStacked}>
                      <span className={styles.rankTitle}>{v.title ?? v.path.split('/').pop()}</span>
                      <span className={styles.rankSub}>{new Date(v.watchedAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {stats.topWatched.length > 0 && (
              <section>
                <h3 className={styles.heading}>{t('stats.topPlayed')}</h3>
                <ol className={styles.rank}>
                  {stats.topWatched.map((v, i) => (
                    <li key={i}>
                      <span className={styles.rankNo}>{i + 1}</span>
                      <span className={styles.rankTitle}>{v.title ?? v.path.split('/').pop()}</span>
                      <span className={styles.rankSub}>{v.watchCount}{t('stats.playCountUnit')}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
