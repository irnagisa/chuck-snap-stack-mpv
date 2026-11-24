import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LibrarySidebar } from './LibrarySidebar';
import type { Category, Tag, TagCategory } from '../../types';
import '../../i18n';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { usePlaylistStore } from '../../store/usePlaylistStore';
import { useModalStore } from '../../store/useModalStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../store/useLibraryStore', () => ({ useLibraryStore: vi.fn() }));
vi.mock('../../store/useTagStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/useTagStore')>()),
  useTagStore: vi.fn(),
}));
vi.mock('../../store/usePlaylistStore', () => ({ usePlaylistStore: vi.fn() }));
vi.mock('../../store/useModalStore', () => ({ useModalStore: vi.fn() }));

const category = (id: number, name: string, parent_id: number | null = null): Category =>
  ({ id, name, color: '#6366f1', parent_id, icon: null, created_at: '' }) as Category;
const tag = (id: number, name: string, tag_category_id: number | null = null): Tag =>
  ({ id, name, color: '#aabbcc', icon: null, tag_category_id, created_at: '' }) as Tag;

let library: Record<string, unknown>;
let tags: Record<string, unknown>;

/** セレクタを受け取るモックストアを用意する */
function mockStore(hook: unknown, getState: () => Record<string, unknown>) {
  vi.mocked(hook as (s?: unknown) => unknown).mockImplementation(
    (selector?: unknown) => (typeof selector === 'function' ? selector(getState()) : getState()),
  );
}

beforeEach(() => {
  library = {
    filterCategoryId: null,
    filterTagIds: [],
    filterWatchDir: null,
    watchDirs: ['/media/Movies', '/media/Music'],
    isScanning: false,
    isThumbnailGenerating: false,
    setCategoryFilter: vi.fn(),
    toggleTagFilter: vi.fn(),
    setWatchDirFilter: vi.fn(),
    clearSidebarFilters: vi.fn(),
    removeWatchDir: vi.fn(),
    rescanAllDirs: vi.fn(),
    fetchVideos: vi.fn(),
  };
  tags = {
    categories: [category(1, '映画'), category(2, 'アニメ', 1), category(3, '音楽')],
    tags: [tag(10, '風景', 100), tag(11, '猫')],
    tagCategories: [{ id: 100, name: '被写体', created_at: '' } as TagCategory],
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    createTagCategory: vi.fn(),
    updateTagCategory: vi.fn(),
    deleteTagCategory: vi.fn(),
  };
  mockStore(useLibraryStore, () => library);
  mockStore(useTagStore, () => tags);
  mockStore(usePlaylistStore, () => ({
    playlists: [{ id: 5, name: '作業用', created_at: '' }],
    createPlaylist: vi.fn(),
    deletePlaylist: vi.fn(),
  }));
  mockStore(useModalStore, () => ({ openPlaylist: vi.fn() }));
});

const section = (name: string) => screen.getByRole('region', { name });

describe('LibrarySidebar', () => {
  it('タブを使わず、各セクションを 1 本のリストに並べる', () => {
    render(<LibrarySidebar />);
    expect(section('プレイリスト')).toBeInTheDocument();
    expect(section('カテゴリ')).toBeInTheDocument();
    expect(section('フォルダ')).toBeInTheDocument();
    expect(section('タグ')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'サイドバー' })).not.toBeInTheDocument();
  });

  it('「すべて」はカテゴリ・フォルダ・タグの絞り込みをまとめて解除する', () => {
    library.filterWatchDir = '/media/Movies';
    render(<LibrarySidebar />);
    const all = screen.getByRole('button', { name: 'すべて' });
    expect(all).not.toHaveAttribute('aria-current');
    fireEvent.click(all);
    expect(library.clearSidebarFilters).toHaveBeenCalled();
  });

  it('カテゴリとフォルダの選択が同時に見える', () => {
    library.filterCategoryId = 3;
    library.filterWatchDir = '/media/Music';
    render(<LibrarySidebar />);
    expect(within(section('カテゴリ')).getByRole('button', { name: '音楽' })).toHaveAttribute('aria-current', 'true');
    expect(within(section('フォルダ')).getByRole('button', { name: 'Music' })).toHaveAttribute('aria-current', 'true');
  });

  it('選択中のカテゴリをもう一度押すと解除する', () => {
    library.filterCategoryId = 3;
    render(<LibrarySidebar />);
    fireEvent.click(within(section('カテゴリ')).getByRole('button', { name: '音楽' }));
    expect(library.setCategoryFilter).toHaveBeenCalledWith(null);
  });

  it('タグはチップで複数選択できる', () => {
    library.filterTagIds = [11];
    render(<LibrarySidebar />);
    const tagSection = section('タグ');
    expect(within(tagSection).getByRole('button', { name: '猫' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(tagSection).getByRole('button', { name: '風景' }));
    expect(library.toggleTagFilter).toHaveBeenCalledWith(10);
  });

  it('タググループは初期状態で開いていて、見出しで開閉できる', () => {
    render(<LibrarySidebar />);
    const head = within(section('タグ')).getByRole('button', { name: /^被写体/, expanded: true });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(within(section('タグ')).getByRole('button', { name: '風景' })).toBeInTheDocument();
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(within(section('タグ')).queryByRole('button', { name: '風景' })).not.toBeInTheDocument();
  });

  it('セクションを畳んでも、絞り込み中であることは見出しで分かる', () => {
    library.filterWatchDir = '/media/Movies';
    render(<LibrarySidebar />);
    const head = within(section('フォルダ')).getByRole('button', { expanded: true });
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(within(head).getByTitle('このセクションで絞り込み中')).toBeInTheDocument();
  });

  it('検索すると畳まれた子カテゴリも含めて一致したものだけ出す', () => {
    render(<LibrarySidebar />);
    // 子を持つ「映画」は初期状態で畳まれている
    expect(screen.queryByRole('button', { name: 'アニメ' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '絞り込み...' }), { target: { value: 'アニ' } });
    expect(screen.getByRole('button', { name: 'アニメ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '音楽' })).not.toBeInTheDocument();
    // 何も当たらないセクションは出さない
    expect(screen.queryByRole('region', { name: 'フォルダ' })).not.toBeInTheDocument();
  });

  it('カテゴリの削除は確認してから行う', async () => {
    render(<LibrarySidebar />);
    const more = within(section('カテゴリ')).getByRole('button', { name: '音楽 の操作' });
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '削除' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('カテゴリ「音楽」を削除しますか？')).toBeInTheDocument();
    expect(tags.deleteCategory).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }));
    expect(tags.deleteCategory).toHaveBeenCalledWith(3);
  });

  describe('タグの編集', () => {
    const tagSection = () => section('タグ');

    it('編集モードでは、チップを押すと絞り込みではなく編集ポップオーバーが開く', async () => {
      render(<LibrarySidebar />);
      const toggle = within(tagSection()).getByRole('button', { name: 'タグを編集' });
      fireEvent.click(toggle);
      expect(within(tagSection()).getByRole('button', { name: '編集を終了' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(within(tagSection()).getByRole('button', { name: '猫 を編集' }));
      expect(library.toggleTagFilter).not.toHaveBeenCalled();
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('textbox', { name: '名前' })).toHaveValue('猫');
    });

    it('編集モードの × は確認してから削除する', async () => {
      render(<LibrarySidebar />);
      fireEvent.click(within(tagSection()).getByRole('button', { name: 'タグを編集' }));
      fireEvent.click(within(tagSection()).getByRole('button', { name: '猫 を削除' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(tags.deleteTag).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: '削除' }));
      expect(tags.deleteTag).toHaveBeenCalledWith(11);
    });

    it('編集を終了すると、チップは絞り込みに戻る', () => {
      render(<LibrarySidebar />);
      fireEvent.click(within(tagSection()).getByRole('button', { name: 'タグを編集' }));
      fireEvent.click(within(tagSection()).getByRole('button', { name: '編集を終了' }));
      fireEvent.click(within(tagSection()).getByRole('button', { name: '猫' }));
      expect(library.toggleTagFilter).toHaveBeenCalledWith(11);
    });

    it('チップにフォーカスして F2 で編集できる', async () => {
      render(<LibrarySidebar />);
      fireEvent.keyDown(within(tagSection()).getByRole('button', { name: '猫' }), { key: 'F2' });
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('textbox', { name: '名前' })).toHaveValue('猫');
    });

    it('チップにフォーカスして Delete で削除の確認が出る', async () => {
      render(<LibrarySidebar />);
      fireEvent.keyDown(within(tagSection()).getByRole('button', { name: '風景' }), { key: 'Delete' });
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('タグ「風景」を削除しますか？')).toBeInTheDocument();
    });

    it('グループの「…」は編集モードの間だけ出る', () => {
      render(<LibrarySidebar />);
      expect(within(tagSection()).queryByRole('button', { name: '被写体 の操作' })).not.toBeInTheDocument();
      fireEvent.click(within(tagSection()).getByRole('button', { name: 'タグを編集' }));
      expect(within(tagSection()).getByRole('button', { name: '被写体 の操作' })).toBeInTheDocument();
    });
  });
});
