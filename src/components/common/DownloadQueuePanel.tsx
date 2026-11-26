import { useTranslation } from "react-i18next";
import { X } from 'lucide-react';
import { Button, cx } from '../ui';
import styles from './Notice.module.css';
import { useDownloadStore, type DownloadJob } from '../../store/useDownloadStore';

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function JobCard({ job, onCancel, onDismiss }: {
  job: DownloadJob;
  onCancel: () => void;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const label = job.title || (job.useYtdlp ? job.url : job.filename) || job.url;
  const shortLabel = label.length > 40 ? `${label.slice(0, 37)}...` : label;

  return (
    <div
      className={cx(styles.card, styles.job)}
      data-tone={job.phase === 'error' ? 'error' : job.phase === 'done' ? 'success' : undefined}
    >
      <div className={styles.jobHead}>
        <span className={styles.icon} aria-hidden>
          {job.phase === 'done' ? '✓' :
           job.phase === 'error' ? '✕' :
           job.phase === 'queued' ? '…' : '↓'}
        </span>
        <span className={styles.jobTitle} title={label}>{shortLabel}</span>
        {(job.phase === 'done' || job.phase === 'error' || job.phase === 'cancelled') && (
          <Button size="icon-sm" variant="inherit" aria-label="閉じる" onClick={() => onDismiss(job.id)}>
            <X aria-hidden />
          </Button>
        )}
        {job.phase === 'downloading' && (
          <Button size="xs" variant="inherit" className={styles.cancel} onClick={onCancel}>
            {t('downloadQueue.cancel')}
          </Button>
        )}
      </div>

      {job.phase === 'downloading' && (
        <>
          <div className={styles.track}>
            <div
              className={styles.bar}
              data-indeterminate={job.progress.percent > 0 ? undefined : true}
              style={job.progress.percent > 0 ? { width: `${job.progress.percent}%` } : undefined}
            />
          </div>
          <div className={styles.jobMeta}>
            <span>
              {!job.useYtdlp && job.progress.total > 0
                ? `${formatBytes(job.progress.downloaded)} / ${formatBytes(job.progress.total)}`
                : job.useYtdlp
                ? t('downloadQueue.downloading')
                : formatBytes(job.progress.downloaded)}
            </span>
            {job.progress.percent > 0 && (
              <span>{job.progress.percent.toFixed(1)}%</span>
            )}
          </div>
        </>
      )}

      {job.phase === 'queued' && (
        <span className={styles.jobNote}>{t('downloadQueue.queued')}</span>
      )}

      {job.phase === 'error' && (
        <span className={styles.jobError}>{job.errorMsg}</span>
      )}
    </div>
  );
}

export function DownloadQueuePanel() {
  const { jobs, cancelActive, dismissJob } = useDownloadStore();

  if (jobs.length === 0) return null;

  return (
    <div
      className={cx(styles.stack, styles.downloadStack)}
      aria-live="polite"
    >
      {jobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          onCancel={cancelActive}
          onDismiss={dismissJob}
        />
      ))}
    </div>
  );
}
