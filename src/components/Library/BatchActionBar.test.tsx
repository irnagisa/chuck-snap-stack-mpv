import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../store/useModalStore', () => ({
  useModalStore: vi.fn(),
}));
vi.mock('../../store/useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));

import { BatchActionBar } from './BatchActionBar';
import { useModalStore } from '../../store/useModalStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import '../../i18n';

const mockOpenBulkModal = vi.fn();
const mockAssignCategoryFromPath = vi.fn(() => Promise.resolve());
const mockRescanMultiple = vi.fn(() => Promise.resolve());

beforeEach(() => {
  vi.clearAllMocks();
  (useModalStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    openBulkModal: mockOpenBulkModal,
  });
  (useLibraryStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: object) => unknown) =>
      selector({ assignCategoryFromPath: mockAssignCategoryFromPath, rescanMultiple: mockRescanMultiple })
  );
});

describe('BatchActionBar', () => {
  it('renders nothing when selectedVideoIds is empty', () => {
    const { container } = render(
      <BatchActionBar
        selectedVideoIds={new Set()}
        isThumbnailGenerating={false}
        onClearSelection={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows selected count', () => {
    render(
      <BatchActionBar
        selectedVideoIds={new Set([1, 2, 3])}
        isThumbnailGenerating={false}
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByText('3 件選択中')).toBeInTheDocument();
  });

  it('clicking "タグ設定" calls openBulkModal("tag")', () => {
    render(
      <BatchActionBar
        selectedVideoIds={new Set([1])}
        isThumbnailGenerating={false}
        onClearSelection={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('タグ設定'));
    expect(mockOpenBulkModal).toHaveBeenCalledWith('tag');
  });

  it('clicking "カテゴリ設定" calls openBulkModal("category")', () => {
    render(
      <BatchActionBar
        selectedVideoIds={new Set([1])}
        isThumbnailGenerating={false}
        onClearSelection={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('カテゴリ設定'));
    expect(mockOpenBulkModal).toHaveBeenCalledWith('category');
  });

  it('clicking "フォルダ名をカテゴリに" calls assignCategoryFromPath and onClearSelection', async () => {
    const onClearSelection = vi.fn();
    render(
      <BatchActionBar
        selectedVideoIds={new Set([1, 2])}
        isThumbnailGenerating={false}
        onClearSelection={onClearSelection}
      />
    );
    fireEvent.click(screen.getByText('フォルダ名をカテゴリに'));
    await vi.waitFor(() => expect(onClearSelection).toHaveBeenCalledOnce());
    expect(mockAssignCategoryFromPath).toHaveBeenCalledWith([1, 2]);
  });

  it('rescan button is disabled while thumbnail generation is in progress', () => {
    render(
      <BatchActionBar
        selectedVideoIds={new Set([1])}
        isThumbnailGenerating={true}
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByText('再スキャン').closest('button')).toBeDisabled();
  });

  it('clicking "再スキャン" calls rescanMultiple with selected IDs and then onClearSelection', async () => {
    const onClearSelection = vi.fn();
    render(
      <BatchActionBar
        selectedVideoIds={new Set([3, 4])}
        isThumbnailGenerating={false}
        onClearSelection={onClearSelection}
      />
    );
    fireEvent.click(screen.getByText('再スキャン'));
    await vi.waitFor(() => expect(onClearSelection).toHaveBeenCalledOnce());
    expect(mockRescanMultiple).toHaveBeenCalledWith([3, 4]);
  });

  it('clicking "選択解除" calls onClearSelection', () => {
    const onClearSelection = vi.fn();
    render(
      <BatchActionBar
        selectedVideoIds={new Set([1])}
        isThumbnailGenerating={false}
        onClearSelection={onClearSelection}
      />
    );
    fireEvent.click(screen.getByText('選択解除'));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });
});
