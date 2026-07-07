import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../store/useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));
vi.mock('../store/useModalStore', () => ({
  useModalStore: vi.fn(),
}));

import { AppHeader } from './AppHeader';
import { useLibraryStore } from '../store/useLibraryStore';
import { useModalStore } from '../store/useModalStore';
import '../i18n';

const mockOpenSettings = vi.fn();
const mockOpenDownload = vi.fn();
const mockOpenStats = vi.fn();
const mockOpenExport = vi.fn();
const mockOpenDuplicates = vi.fn();
const mockOpenMissingFiles = vi.fn();

function setupLibraryStore(overrides: { isDbReady?: boolean; isScanning?: boolean; isThumbnailGenerating?: boolean } = {}) {
  const state = { isDbReady: true, isScanning: false, isThumbnailGenerating: false, ...overrides };
  (useLibraryStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: typeof state) => unknown) => selector(state)
  );
}

function defaultProps(overrides: Partial<Parameters<typeof AppHeader>[0]> = {}) {
  return {
    mainView: 'library' as const,
    inboxCount: 0,
    searchInput: '',
    useDirAsCategory: false,
    onMainViewChange: vi.fn(),
    onSearchChange: vi.fn(),
    onSearchClear: vi.fn(),
    onPickDir: vi.fn(),
    onUseDirAsCategoryChange: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setupLibraryStore();
  (useModalStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    openSettings: mockOpenSettings,
    openDownload: mockOpenDownload,
    openStats: mockOpenStats,
    openExport: mockOpenExport,
    openDuplicates: mockOpenDuplicates,
    openMissingFiles: mockOpenMissingFiles,
  });
});

describe('AppHeader', () => {
  it('renders the app title', () => {
    render(<AppHeader {...defaultProps()} />);
    expect(screen.getByText('Chuck Snap Stack')).toBeInTheDocument();
  });

  it('clicking "ライブラリ" tab calls onMainViewChange("library")', () => {
    const onMainViewChange = vi.fn();
    render(<AppHeader {...defaultProps({ mainView: 'inbox', onMainViewChange })} />);
    fireEvent.click(screen.getByText('ライブラリ'));
    expect(onMainViewChange).toHaveBeenCalledWith('library');
  });

  it('clicking "Inbox" tab calls onMainViewChange("inbox")', () => {
    const onMainViewChange = vi.fn();
    render(<AppHeader {...defaultProps({ onMainViewChange })} />);
    fireEvent.click(screen.getByText('Inbox'));
    expect(onMainViewChange).toHaveBeenCalledWith('inbox');
  });

  it('shows inbox badge when inboxCount > 0', () => {
    render(<AppHeader {...defaultProps({ inboxCount: 7 })} />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('inbox badge shows "999+" when count exceeds 999', () => {
    render(<AppHeader {...defaultProps({ inboxCount: 1000 })} />);
    expect(screen.getByText('999+')).toBeInTheDocument();
  });

  it('add folder button is disabled when isDbReady is false', () => {
    setupLibraryStore({ isDbReady: false });
    render(<AppHeader {...defaultProps()} />);
    expect(screen.getByText('+ フォルダ追加').closest('button')).toBeDisabled();
  });

  it('add folder button is disabled while scanning', () => {
    setupLibraryStore({ isScanning: true });
    render(<AppHeader {...defaultProps()} />);
    expect(screen.getByText('スキャン中...').closest('button')).toBeDisabled();
  });

  it('clicking add folder button calls onPickDir', () => {
    const onPickDir = vi.fn();
    render(<AppHeader {...defaultProps({ onPickDir })} />);
    fireEvent.click(screen.getByText('+ フォルダ追加'));
    expect(onPickDir).toHaveBeenCalledOnce();
  });

  it('search input calls onSearchChange on change', () => {
    const onSearchChange = vi.fn();
    render(<AppHeader {...defaultProps({ onSearchChange })} />);
    const input = screen.getByPlaceholderText('ファイルを検索...');
    fireEvent.change(input, { target: { value: 'cat' } });
    expect(onSearchChange).toHaveBeenCalledWith('cat');
  });

  it('clear button appears when searchInput is non-empty and calls onSearchClear', () => {
    const onSearchClear = vi.fn();
    render(<AppHeader {...defaultProps({ searchInput: 'dog', onSearchClear })} />);
    const clearBtn = screen.getByLabelText('クリア');
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(onSearchClear).toHaveBeenCalledOnce();
  });

  it('clear button is absent when searchInput is empty', () => {
    render(<AppHeader {...defaultProps({ searchInput: '' })} />);
    expect(screen.queryByLabelText('クリア')).not.toBeInTheDocument();
  });

  it('useDirAsCategory checkbox reflects prop and calls onUseDirAsCategoryChange on change', () => {
    const onUseDirAsCategoryChange = vi.fn();
    render(
      <AppHeader
        {...defaultProps({ useDirAsCategory: false, onUseDirAsCategoryChange })}
      />
    );
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onUseDirAsCategoryChange).toHaveBeenCalledWith(true);
  });

  it('clicking the settings button calls openSettings', () => {
    render(<AppHeader {...defaultProps()} />);
    fireEvent.click(screen.getByTitle('設定'));
    expect(mockOpenSettings).toHaveBeenCalledOnce();
  });

  it('clicking the stats button calls openStats', () => {
    render(<AppHeader {...defaultProps()} />);
    fireEvent.click(screen.getByTitle('統計ダッシュボード'));
    expect(mockOpenStats).toHaveBeenCalledOnce();
  });

  it('clicking the download button calls openDownload', () => {
    render(<AppHeader {...defaultProps()} />);
    fireEvent.click(screen.getByText('↓ URL'));
    expect(mockOpenDownload).toHaveBeenCalledOnce();
  });

  it('clicking the duplicates button calls openDuplicates', () => {
    render(<AppHeader {...defaultProps()} />);
    fireEvent.click(screen.getByTitle('重複動画を検出'));
    expect(mockOpenDuplicates).toHaveBeenCalledOnce();
  });
});
