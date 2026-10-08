import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryFilterBar } from './LibraryFilterBar';
import type { Tag } from '../../types';
import '../../i18n';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryViewStore } from '../../store/useLibraryViewStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useModalStore } from '../../store/useModalStore';

vi.mock('../../store/useLibraryStore', () => ({ useLibraryStore: vi.fn() }));
vi.mock('../../store/useTagStore', () => ({ useTagStore: vi.fn() }));
vi.mock('../../store/useLibraryViewStore', () => ({ useLibraryViewStore: vi.fn() }));
vi.mock('../../store/usePlayerStore', () => ({ usePlayerStore: vi.fn() }));
vi.mock('../../store/useModalStore', () => ({ useModalStore: vi.fn() }));

function makeTag(id: number, name: string): Tag {
  return { id, name, color: '#aabbcc', icon: null, tag_category_id: null, created_at: '2024-01-01' };
}

const defaultLibraryState = {
  filterTagIds: [] as number[],
  filterTagMode: 'and' as 'and' | 'or',
  filterSortBy: 'created_at' as 'created_at' | 'duration' | 'rating',
  filterSortOrder: 'desc' as 'asc' | 'desc',
  filterMinRating: 0,
  filterRatingMode: 'gte' as 'gte' | 'lte' | 'eq',
  filterHasAudio: null as null | number,
  filterWatchedStatus: 'all' as 'all' | 'watched' | 'unwatched',
  filterMediaType: 'all' as 'all' | 'video' | 'audio' | 'image',
  filterMinDuration: 0,
  filterMaxDuration: 0,
  totalCount: 0,
  toggleTagFilter: vi.fn(),
  clearTagFilters: vi.fn(),
  setTagMode: vi.fn(),
  setSort: vi.fn(),
  setMinRating: vi.fn(),
  setRatingMode: vi.fn(),
  setHasAudio: vi.fn(),
  setWatchedStatus: vi.fn(),
  setMediaType: vi.fn(),
  setMinDuration: vi.fn(),
  setMaxDuration: vi.fn(),
};

const defaultViewState = {
  viewMode: 'grid' as 'grid' | 'list',
  gridItemMinWidth: 180,
  listItemSize: 'M' as 'S' | 'M' | 'L' | 'XL',
  setViewMode: vi.fn(),
  setGridItemMinWidth: vi.fn(),
  setListItemSize: vi.fn(),
};

function setupMocks(
  libraryOverrides: Partial<typeof defaultLibraryState> = {},
  viewOverrides: Partial<typeof defaultViewState> = {},
  tags: Tag[] = [],
) {
  vi.mocked(useLibraryStore).mockReturnValue({ ...defaultLibraryState, ...libraryOverrides } as any);
  vi.mocked(useTagStore).mockReturnValue(tags as any);
  vi.mocked(useLibraryViewStore).mockReturnValue({ ...defaultViewState, ...viewOverrides } as any);
  vi.mocked(usePlayerStore).mockReturnValue(vi.fn() as any);
  vi.mocked(useModalStore).mockReturnValue(vi.fn() as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
});

describe('LibraryFilterBar — タグ', () => {
  it('renders selected tag chips', () => {
    const tags = [makeTag(1, 'Action'), makeTag(2, 'Drama')];
    setupMocks({ filterTagIds: [1, 2] }, {}, tags);
    render(<LibraryFilterBar />);
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Drama')).toBeInTheDocument();
  });

  it('unselected tags are not shown in the filter bar', () => {
    const tags = [makeTag(1, 'Action'), makeTag(2, 'Drama')];
    setupMocks({ filterTagIds: [] }, {}, tags);
    render(<LibraryFilterBar />);
    expect(screen.queryByText('Action')).not.toBeInTheDocument();
    expect(screen.queryByText('Drama')).not.toBeInTheDocument();
  });

  it('clicking a selected tag chip calls toggleTagFilter with its id', () => {
    const toggleTagFilter = vi.fn();
    const tags = [makeTag(42, 'Sci-Fi')];
    setupMocks({ filterTagIds: [42], toggleTagFilter }, {}, tags);
    render(<LibraryFilterBar />);
    fireEvent.click(screen.getByText('Sci-Fi'));
    expect(toggleTagFilter).toHaveBeenCalledWith(42);
  });

  it('shows AND/OR toggle when 2+ tags are selected', () => {
    const tags = [makeTag(1, 'A'), makeTag(2, 'B')];
    setupMocks({ filterTagIds: [1, 2], filterTagMode: 'and' }, {}, tags);
    render(<LibraryFilterBar />);
    expect(screen.getByText('AND')).toBeInTheDocument();
  });

  it('clicking AND/OR toggle calls setTagMode with opposite mode', () => {
    const setTagMode = vi.fn();
    const tags = [makeTag(1, 'A'), makeTag(2, 'B')];
    setupMocks({ filterTagIds: [1, 2], filterTagMode: 'and', setTagMode }, {}, tags);
    render(<LibraryFilterBar />);
    fireEvent.click(screen.getByText('AND'));
    expect(setTagMode).toHaveBeenCalledWith('or');
  });

  it('shows clear button when tags are selected and clicking calls clearTagFilters', () => {
    const clearTagFilters = vi.fn();
    const tags = [makeTag(1, 'A')];
    setupMocks({ filterTagIds: [1], clearTagFilters }, {}, tags);
    render(<LibraryFilterBar />);
    fireEvent.click(screen.getByText('クリア'));
    expect(clearTagFilters).toHaveBeenCalledOnce();
  });
});

describe('LibraryFilterBar — シャッフル', () => {
  it('shuffle button is shown when totalCount > 0 and calls playShuffleAll', () => {
    const playShuffleAll = vi.fn();
    setupMocks({ totalCount: 10 });
    vi.mocked(usePlayerStore).mockReturnValue(playShuffleAll as any);
    render(<LibraryFilterBar />);
    fireEvent.click(screen.getByText('⇄ 全件'));
    expect(playShuffleAll).toHaveBeenCalledOnce();
  });

  it('shuffle button is NOT shown when totalCount is 0', () => {
    setupMocks({ totalCount: 0 });
    render(<LibraryFilterBar />);
    expect(screen.queryByText('⇄ 全件')).not.toBeInTheDocument();
  });
});

describe('LibraryFilterBar — ソート', () => {
  it('clicking sort order toggle switches asc↔desc', () => {
    const setSort = vi.fn();
    setupMocks({ filterSortBy: 'created_at', filterSortOrder: 'desc', setSort });
    render(<LibraryFilterBar />);
    fireEvent.click(screen.getByText('↓'));
    expect(setSort).toHaveBeenCalledWith('created_at', 'asc');
  });

  it('shows ascending arrow when filterSortOrder is "asc"', () => {
    setupMocks({ filterSortOrder: 'asc' });
    render(<LibraryFilterBar />);
    expect(screen.getByText('↑')).toBeInTheDocument();
  });
});

describe('LibraryFilterBar — 視聴状態フィルター', () => {
  it('calls setWatchedStatus when selection changes', () => {
    const setWatchedStatus = vi.fn();
    setupMocks({ filterWatchedStatus: 'all', setWatchedStatus });
    render(<LibraryFilterBar />);
    const select = screen.getByTitle('視聴状態フィルタ');
    fireEvent.change(select, { target: { value: 'watched' } });
    expect(setWatchedStatus).toHaveBeenCalledWith('watched');
  });
});

describe('LibraryFilterBar — メディアタイプフィルター', () => {
  it('calls setMediaType when selection changes', () => {
    const setMediaType = vi.fn();
    setupMocks({ filterMediaType: 'all', setMediaType });
    render(<LibraryFilterBar />);
    const select = screen.getByTitle('メディアタイプフィルタ');
    fireEvent.change(select, { target: { value: 'audio' } });
    expect(setMediaType).toHaveBeenCalledWith('audio');
  });
});

describe('LibraryFilterBar — 長さフィルター', () => {
  it('min duration input updates its value when changed', () => {
    render(<LibraryFilterBar />);
    const input = screen.getByTitle('最小長さ (秒)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60' } });
    expect(input.value).toBe('60');
  });

  it('max duration input updates its value when changed', () => {
    render(<LibraryFilterBar />);
    const input = screen.getByTitle('最大長さ (秒)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '300' } });
    expect(input.value).toBe('300');
  });
});

describe('LibraryFilterBar — 表示モード', () => {
  it('grid size buttons are shown in grid view mode', () => {
    setupMocks({}, { viewMode: 'grid', gridItemMinWidth: 180 });
    render(<LibraryFilterBar />);
    expect(screen.getByTitle('カードサイズ: S')).toBeInTheDocument();
    expect(screen.getByTitle('カードサイズ: M')).toBeInTheDocument();
    expect(screen.getByTitle('カードサイズ: L')).toBeInTheDocument();
    expect(screen.getByTitle('カードサイズ: XL')).toBeInTheDocument();
  });

  it('list size buttons are shown in list view mode', () => {
    setupMocks({}, { viewMode: 'list', listItemSize: 'M' });
    render(<LibraryFilterBar />);
    expect(screen.queryByTitle('カードサイズ: S')).not.toBeInTheDocument();
    expect(screen.getByTitle('行サイズ: S')).toBeInTheDocument();
  });

  it('clicking grid size button calls setGridItemMinWidth', () => {
    const setGridItemMinWidth = vi.fn();
    setupMocks({}, { viewMode: 'grid', setGridItemMinWidth });
    render(<LibraryFilterBar />);
    fireEvent.click(screen.getByTitle('カードサイズ: L'));
    expect(setGridItemMinWidth).toHaveBeenCalledWith(240);
  });

  it('clicking list size button calls setListItemSize', () => {
    const setListItemSize = vi.fn();
    setupMocks({}, { viewMode: 'list', setListItemSize });
    render(<LibraryFilterBar />);
    fireEvent.click(screen.getByTitle('行サイズ: XL'));
    expect(setListItemSize).toHaveBeenCalledWith('XL');
  });
});
