export type IconKey = 'folder' | 'tag' | 'film' | 'star' | 'music' | 'heart';

export const MEDIA_ICONS: IconKey[] = ['folder', 'tag', 'film', 'star', 'music', 'heart'];

export const ICON_LABELS: Record<IconKey, string> = {
  folder: 'フォルダ',
  tag: 'タグ',
  film: 'フィルム',
  star: 'スター',
  music: '音楽',
  heart: 'ハート',
};

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function MediaIcon({
  icon,
  className = 'w-3.5 h-3.5',
}: {
  icon: string | null | undefined;
  className?: string;
}) {
  switch (icon) {
    case 'folder':
      return (
        <svg className={className} {...svgProps}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'tag':
      return (
        <svg className={className} {...svgProps}>
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" strokeWidth={3} />
        </svg>
      );
    case 'film':
      return (
        <svg className={className} {...svgProps}>
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
          <line x1="7" y1="2" x2="7" y2="22" />
          <line x1="17" y1="2" x2="17" y2="22" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <line x1="2" y1="7" x2="7" y2="7" />
          <line x1="2" y1="17" x2="7" y2="17" />
          <line x1="17" y1="17" x2="22" y2="17" />
          <line x1="17" y1="7" x2="22" y2="7" />
        </svg>
      );
    case 'star':
      return (
        <svg className={className} {...svgProps}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case 'music':
      return (
        <svg className={className} {...svgProps}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case 'heart':
      return (
        <svg className={className} {...svgProps}>
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      );
    default:
      // null / undefined: フォルダをデフォルト表示
      return (
        <svg className={className} {...svgProps}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
  }
}

export function IconPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {MEDIA_ICONS.map((key) => (
        <button
          key={key}
          type="button"
          title={ICON_LABELS[key]}
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
            value === key
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400 ring-1 ring-blue-500'
              : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          onClick={() => onChange(key)}
        >
          <MediaIcon icon={key} className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
}
