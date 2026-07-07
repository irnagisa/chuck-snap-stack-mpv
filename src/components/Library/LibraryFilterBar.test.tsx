import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryFilterBar } from './LibraryFilterBar';
import type { Tag } from '../../types';
import '../../i18n';

function makeTag(id: number, name: string): Tag {
  return { id, name, color: '#aabbcc', icon: null, tag_category_id: null, created_at: '2024-01-01' };
}

const noopFn = vi.fn();

function makeProps(overrides: Partial<Parameters<typeof LibraryFilterBar>[0]> = {}) {
  return {
    tags: [],
    filterTagIds: [],
    filterTagMode: 'and' as const,
    filterSortBy: 'created_at' as const,
    filterSortOrder: 'desc' as const,
    filterMinRating: 0,
    filterHasAudio: null,
    filterWatchedStatus: 'all' as const,
    filterMediaType: 'all' as const,
    filterMinDuration: 0,
    filterMaxDuration: 0,
    durationInput: '',
    maxDurationInput: '',
    totalCount: 0,
    viewMode: 'grid' as const,
    gridItemMinWidth: 180,
    listItemSize: 'M' as const,
    onToggleTag: noopFn,
    onClearTags: noopFn,
    onSetTagMode: noopFn,
    onSetSort: noopFn,
    onSetMinRating: noopFn,
    onSetHasAudio: noopFn,
    onSetWatchedStatus: noopFn,
    onSetMediaType: noopFn,
    onDurationInputChange: noopFn,
    onMaxDurationInputChange: noopFn,
    onShuffleAll: noopFn,
    onSaveSmartPlaylist: noopFn,
    onSetViewMode: noopFn,
    onSetGridItemMinWidth: noopFn,
    onSetListItemSize: noopFn,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LibraryFilterBar — タグ', () => {
  it('renders tag chips for each tag', () => {
    render(<LibraryFilterBar {...makeProps({ tags: [makeTag(1, 'Action'), makeTag(2, 'Drama')] })} />);
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Drama')).toBeInTheDocument();
  });

  it('clicking a tag chip calls onToggleTag with its id', () => {
    const onToggleTag = vi.fn();
    render(
      <LibraryFilterBar
        {...makeProps({ tags: [makeTag(42, 'Sci-Fi')], onToggleTag })}
      />
    );
    fireEvent.click(screen.getByText('Sci-Fi'));
    expect(onToggleTag).toHaveBeenCalledWith(42);
  });

  it('shows AND/OR toggle when 2+ tags are selected', () => {
    render(
      <LibraryFilterBar
        {...makeProps({
          tags: [makeTag(1, 'A'), makeTag(2, 'B')],
          filterTagIds: [1, 2],
          filterTagMode: 'and',
        })}
      />
    );
    expect(screen.getByText('AND')).toBeInTheDocument();
  });

  it('clicking AND/OR toggle switches mode', () => {
    const onSetTagMode = vi.fn();
    render(
      <LibraryFilterBar
        {...makeProps({
          tags: [makeTag(1, 'A'), makeTag(2, 'B')],
          filterTagIds: [1, 2],
          filterTagMode: 'and',
          onSetTagMode,
        })}
      />
    );
    fireEvent.click(screen.getByText('AND'));
    expect(onSetTagMode).toHaveBeenCalledWith('or');
  });

  it('shows clear button when tags are selected and clicking calls onClearTags', () => {
    const onClearTags = vi.fn();
    render(
      <LibraryFilterBar
        {...makeProps({
          tags: [makeTag(1, 'A')],
          filterTagIds: [1],
          onClearTags,
        })}
      />
    );
    fireEvent.click(screen.getByText('クリア'));
    expect(onClearTags).toHaveBeenCalledOnce();
  });
});

describe('LibraryFilterBar — シャッフル', () => {
  it('shuffle button is shown when totalCount > 0 and calls onShuffleAll', () => {
    const onShuffleAll = vi.fn();
    render(<LibraryFilterBar {...makeProps({ totalCount: 10, onShuffleAll })} />);
    fireEvent.click(screen.getByText('⇄ 全件'));
    expect(onShuffleAll).toHaveBeenCalledOnce();
  });

  it('shuffle button is NOT shown when totalCount is 0', () => {
    render(<LibraryFilterBar {...makeProps({ totalCount: 0 })} />);
    expect(screen.queryByText('⇄ 全件')).not.toBeInTheDocument();
  });
});

describe('LibraryFilterBar — ソート', () => {
  it('clicking sort order toggle switches asc↔desc', () => {
    const onSetSort = vi.fn();
    render(
      <LibraryFilterBar
        {...makeProps({ filterSortBy: 'created_at', filterSortOrder: 'desc', onSetSort })}
      />
    );
    fireEvent.click(screen.getByText('↓'));
    expect(onSetSort).toHaveBeenCalledWith('created_at', 'asc');
  });

  it('shows ascending arrow when filterSortOrder is "asc"', () => {
    render(<LibraryFilterBar {...makeProps({ filterSortOrder: 'asc' })} />);
    expect(screen.getByText('↑')).toBeInTheDocument();
  });
});

describe('LibraryFilterBar — 視聴状態フィルター', () => {
  it('calls onSetWatchedStatus when selection changes', () => {
    const onSetWatchedStatus = vi.fn();
    render(<LibraryFilterBar {...makeProps({ filterWatchedStatus: 'all', onSetWatchedStatus })} />);
    const select = screen.getByTitle('視聴状態フィルタ');
    fireEvent.change(select, { target: { value: 'watched' } });
    expect(onSetWatchedStatus).toHaveBeenCalledWith('watched');
  });
});

describe('LibraryFilterBar — メディアタイプフィルター', () => {
  it('calls onSetMediaType when selection changes', () => {
    const onSetMediaType = vi.fn();
    render(<LibraryFilterBar {...makeProps({ filterMediaType: 'all', onSetMediaType })} />);
    const select = screen.getByTitle('メディアタイプフィルタ');
    fireEvent.change(select, { target: { value: 'audio' } });
    expect(onSetMediaType).toHaveBeenCalledWith('audio');
  });
});

describe('LibraryFilterBar — 長さフィルター', () => {
  it('calls onDurationInputChange when min duration input changes', () => {
    const onDurationInputChange = vi.fn();
    render(<LibraryFilterBar {...makeProps({ durationInput: '', onDurationInputChange })} />);
    const input = screen.getByTitle('最小長さ (秒)');
    fireEvent.change(input, { target: { value: '60' } });
    expect(onDurationInputChange).toHaveBeenCalledWith('60');
  });

  it('calls onMaxDurationInputChange when max duration input changes', () => {
    const onMaxDurationInputChange = vi.fn();
    render(<LibraryFilterBar {...makeProps({ maxDurationInput: '', onMaxDurationInputChange })} />);
    const input = screen.getByTitle('最大長さ (秒)');
    fireEvent.change(input, { target: { value: '300' } });
    expect(onMaxDurationInputChange).toHaveBeenCalledWith('300');
  });
});

describe('LibraryFilterBar — 表示モード', () => {
  it('grid size buttons are shown in grid view mode', () => {
    render(<LibraryFilterBar {...makeProps({ viewMode: 'grid', gridItemMinWidth: 180 })} />);
    expect(screen.getByTitle('カードサイズ: S')).toBeInTheDocument();
    expect(screen.getByTitle('カードサイズ: M')).toBeInTheDocument();
    expect(screen.getByTitle('カードサイズ: L')).toBeInTheDocument();
    expect(screen.getByTitle('カードサイズ: XL')).toBeInTheDocument();
  });

  it('list size buttons are shown in list view mode', () => {
    render(<LibraryFilterBar {...makeProps({ viewMode: 'list', listItemSize: 'M' })} />);
    expect(screen.queryByTitle('カードサイズ: S')).not.toBeInTheDocument();
    expect(screen.getByTitle('行サイズ: S')).toBeInTheDocument();
  });

  it('clicking grid size button calls onSetGridItemMinWidth', () => {
    const onSetGridItemMinWidth = vi.fn();
    render(<LibraryFilterBar {...makeProps({ viewMode: 'grid', onSetGridItemMinWidth })} />);
    fireEvent.click(screen.getByTitle('カードサイズ: L'));
    expect(onSetGridItemMinWidth).toHaveBeenCalledWith(240);
  });

  it('clicking list size button calls onSetListItemSize', () => {
    const onSetListItemSize = vi.fn();
    render(<LibraryFilterBar {...makeProps({ viewMode: 'list', onSetListItemSize })} />);
    fireEvent.click(screen.getByTitle('行サイズ: XL'));
    expect(onSetListItemSize).toHaveBeenCalledWith('XL');
  });
});
