import { useTranslation } from "react-i18next";
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
    <div className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-lg shadow-lg text-xs pointer-events-auto
      ${job.phase === 'error'
        ? 'bg-red-600 text-white'
        : job.phase === 'done'
        ? 'bg-green-600 text-white'
        : 'bg-gray-800 dark:bg-gray-700 text-gray-100'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0">
          {job.phase === 'done' ? '✓' :
           job.phase === 'error' ? '✕' :
           job.phase === 'queued' ? '…' : '↓'}
        </span>
        <span className="flex-1 truncate font-medium" title={label}>{shortLabel}</span>
        {(job.phase === 'done' || job.phase === 'error' || job.phase === 'cancelled') && (
          <button
            type="button"
            className="shrink-0 opacity-70 hover:opacity-100"
            onClick={() => onDismiss(job.id)}
          >
            ✕
          </button>
        )}
        {job.phase === 'downloading' && (
          <button
            type="button"
            className="shrink-0 text-red-300 hover:text-red-100"
            onClick={onCancel}
          >
            {t('downloadQueue.cancel')}
          </button>
        )}
      </div>

      {job.phase === 'downloading' && (
        <>
          <div className="w-full h-1.5 bg-gray-600 dark:bg-gray-500 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-200 ${
                job.progress.percent > 0 ? 'bg-blue-400' : 'bg-blue-400 animate-pulse w-full'
              }`}
              style={job.progress.percent > 0 ? { width: `${job.progress.percent}%` } : undefined}
            />
          </div>
          <div className="flex justify-between text-gray-300">
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
        <span className="text-gray-400">{t('downloadQueue.queued')}</span>
      )}

      {job.phase === 'error' && (
        <span className="text-red-200 break-all">{job.errorMsg}</span>
      )}
    </div>
  );
}

export function DownloadQueuePanel() {
  const { jobs, cancelActive, dismissJob } = useDownloadStore();

  if (jobs.length === 0) return null;

  return (
    <div
      className="fixed bottom-24 right-4 flex flex-col gap-2 z-[150] pointer-events-none w-72"
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
