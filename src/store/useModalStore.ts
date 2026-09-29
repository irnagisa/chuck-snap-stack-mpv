import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Video, Playlist } from '../types';

type BulkModal = 'delete' | 'tag' | 'category' | 'rename' | 'rating' | 'moveDir' | null;

interface ModalStore {
  showSettings: boolean;
  showDownload: boolean;
  showDuplicates: boolean;
  showMissingFiles: boolean;
  showStats: boolean;
  showQueuePanel: boolean;
  showExport: boolean;
  showSmartPlaylist: boolean;
  detailVideo: Video | null;
  activePlaylist: Playlist | null;
  addToPlaylistVideo: Video | null;
  bulkModal: BulkModal;
  dndPendingFiles: string[] | null;
  dndOnSelect: ((dir: string | null) => void) | null;

  openSettings: () => void;
  closeSettings: () => void;
  openDownload: () => void;
  closeDownload: () => void;
  openDuplicates: () => void;
  closeDuplicates: () => void;
  openMissingFiles: () => void;
  closeMissingFiles: () => void;
  openStats: () => void;
  closeStats: () => void;
  toggleQueuePanel: () => void;
  closeQueuePanel: () => void;
  openExport: () => void;
  closeExport: () => void;
  openSmartPlaylist: () => void;
  closeSmartPlaylist: () => void;
  openDetailVideo: (video: Video) => void;
  closeDetailVideo: () => void;
  openPlaylist: (playlist: Playlist) => void;
  closePlaylist: () => void;
  openAddToPlaylist: (video: Video) => void;
  closeAddToPlaylist: () => void;
  openBulkModal: (modal: Exclude<BulkModal, null>) => void;
  closeBulkModal: () => void;
  openDndDestDir: (files: string[], onSelect: (dir: string | null) => void) => void;
  closeDndDestDir: () => void;
  closeAll: () => void;
}

export const useModalStore = create<ModalStore>((set) => ({
  showSettings: false,
  showDownload: false,
  showDuplicates: false,
  showMissingFiles: false,
  showStats: false,
  showQueuePanel: false,
  showExport: false,
  showSmartPlaylist: false,
  detailVideo: null,
  activePlaylist: null,
  addToPlaylistVideo: null,
  bulkModal: null,
  dndPendingFiles: null,
  dndOnSelect: null,

  openSettings: () => set({ showSettings: true }),
  closeSettings: () => set({ showSettings: false }),
  openDownload: () => set({ showDownload: true }),
  closeDownload: () => set({ showDownload: false }),
  openDuplicates: () => set({ showDuplicates: true }),
  closeDuplicates: () => set({ showDuplicates: false }),
  openMissingFiles: () => set({ showMissingFiles: true }),
  closeMissingFiles: () => set({ showMissingFiles: false }),
  openStats: () => set({ showStats: true }),
  closeStats: () => set({ showStats: false }),
  toggleQueuePanel: () => set((s) => ({ showQueuePanel: !s.showQueuePanel })),
  closeQueuePanel: () => set({ showQueuePanel: false }),
  openExport: () => set({ showExport: true }),
  closeExport: () => set({ showExport: false }),
  openSmartPlaylist: () => set({ showSmartPlaylist: true }),
  closeSmartPlaylist: () => set({ showSmartPlaylist: false }),
  openDetailVideo: (video) => {
    set({ detailVideo: video });
    invoke('db_update_last_viewed', { videoId: video.id }).catch((e: unknown) => {
      console.error('[useModalStore] db_update_last_viewed error:', e);
    });
  },
  closeDetailVideo: () => set({ detailVideo: null }),
  openPlaylist: (playlist) => set({ activePlaylist: playlist }),
  closePlaylist: () => set({ activePlaylist: null }),
  openAddToPlaylist: (video) => set({ addToPlaylistVideo: video }),
  closeAddToPlaylist: () => set({ addToPlaylistVideo: null }),
  openBulkModal: (modal) => set({ bulkModal: modal }),
  closeBulkModal: () => set({ bulkModal: null }),
  openDndDestDir: (files, onSelect) => set({ dndPendingFiles: files, dndOnSelect: onSelect }),
  closeDndDestDir: () => set({ dndPendingFiles: null, dndOnSelect: null }),
  closeAll: () => set({
    showSettings: false,
    showDownload: false,
    showDuplicates: false,
    showMissingFiles: false,
    showStats: false,
    showQueuePanel: false,
    showExport: false,
    showSmartPlaylist: false,
    detailVideo: null,
    activePlaylist: null,
    addToPlaylistVideo: null,
    bulkModal: null,
    dndPendingFiles: null,
    dndOnSelect: null,
  }),
}));
