import type { Tag } from '../../types';

interface Props {
  tag: Tag;
  onRemove?: () => void;
}

export function TagBadge({ tag, onRemove }: Props) {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1 py-px rounded-full text-[10px] font-medium text-white shrink-0"
      style={{ backgroundColor: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          className="hover:opacity-75 leading-none"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          ×
        </button>
      )}
    </span>
  );
}
