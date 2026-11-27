import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

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
import { TooltipProvider } from './ui';

// ヘッダーのアイコンボタンは Tooltip を使うので Provider で包んで描画する
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

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
    render(<AppHeader {...defaultProps({ mainView: 'home', onMainViewChange })} />);
    fireEvent.click(screen.getByText('ライブラリ'));
    expect(onMainViewChange).toHaveBeenCalledWith('library');
  });

  it('has no Inbox tab (new items are shown in the library)', () => {
    render(<AppHeader {...defaultProps()} />);
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
  });

  it('add folder button is disabled when isDbReady is false', () => {
    setupLibraryStore({ isDbReady: false });
    render(<AppHeader {...defaultProps()} />);
    expect(screen.getByText('フォルダ追加').closest('button')).toBeDisabled();
  });

  it('add folder button is disabled while scanning', () => {
    setupLibraryStore({ isScanning: true });
    render(<AppHeader {...defaultProps()} />);
    expect(screen.getByText('スキャン中...').closest('button')).toBeDisabled();
  });

  it('clicking add folder button calls onPickDir', () => {
    const onPickDir = vi.fn();
    render(<AppHeader {...defaultProps({ onPickDir })} />);
    fireEvent.click(screen.getByText('フォルダ追加'));
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
    const checkbox = screen.getByRole('checkbox', { name: 'フォルダ名をカテゴリに' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(checkbox);
    expect(onUseDirAsCategoryChange).toHaveBeenCalledWith(true);
  });

  it('clicking the settings button calls openSettings', () => {
    render(<AppHeader {...defaultProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '設定' }));
    expect(mockOpenSettings).toHaveBeenCalledOnce();
  });

  it('clicking the stats button calls openStats', () => {
    render(<AppHeader {...defaultProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '統計ダッシュボード' }));
    expect(mockOpenStats).toHaveBeenCalledOnce();
  });

  it('clicking the download button calls openDownload', () => {
    render(<AppHeader {...defaultProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'URL' }));
    expect(mockOpenDownload).toHaveBeenCalledOnce();
  });

  it('clicking the duplicates button calls openDuplicates', () => {
    render(<AppHeader {...defaultProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '重複動画を検出' }));
    expect(mockOpenDuplicates).toHaveBeenCalledOnce();
  });
});
