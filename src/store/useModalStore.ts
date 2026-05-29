import { create } from 'zustand';
import type { Video, Playlist } from '../types';

type BulkModal = 'delete' | 'tag' | 'category' | 'rename' | null;

interface ModalStore {
  showSettings: boolean;
  showDownload: boolean;
  showDuplicates: boolean;
  showStats: boolean;
  showQueuePanel: boolean;
  showExport: boolean;
  showSmartPlaylist: boolean;
  detailVideo: Video | null;
  activePlaylist: Playlist | null;
  addToPlaylistVideo: Video | null;
  bulkModal: BulkModal;

  openSettings: () => void;
  closeSettings: () => void;
  openDownload: () => void;
  closeDownload: () => void;
  openDuplicates: () => void;
  closeDuplicates: () => void;
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
  closeAll: () => void;
}

export const useModalStore = create<ModalStore>((set) => ({
  showSettings: false,
  showDownload: false,
  showDuplicates: false,
  showStats: false,
  showQueuePanel: false,
  showExport: false,
  showSmartPlaylist: false,
  detailVideo: null,
  activePlaylist: null,
  addToPlaylistVideo: null,
  bulkModal: null,

  openSettings: () => set({ showSettings: true }),
  closeSettings: () => set({ showSettings: false }),
  openDownload: () => set({ showDownload: true }),
  closeDownload: () => set({ showDownload: false }),
  openDuplicates: () => set({ showDuplicates: true }),
  closeDuplicates: () => set({ showDuplicates: false }),
  openStats: () => set({ showStats: true }),
  closeStats: () => set({ showStats: false }),
  toggleQueuePanel: () => set((s) => ({ showQueuePanel: !s.showQueuePanel })),
  closeQueuePanel: () => set({ showQueuePanel: false }),
  openExport: () => set({ showExport: true }),
  closeExport: () => set({ showExport: false }),
  openSmartPlaylist: () => set({ showSmartPlaylist: true }),
  closeSmartPlaylist: () => set({ showSmartPlaylist: false }),
  openDetailVideo: (video) => set({ detailVideo: video }),
  closeDetailVideo: () => set({ detailVideo: null }),
  openPlaylist: (playlist) => set({ activePlaylist: playlist }),
  closePlaylist: () => set({ activePlaylist: null }),
  openAddToPlaylist: (video) => set({ addToPlaylistVideo: video }),
  closeAddToPlaylist: () => set({ addToPlaylistVideo: null }),
  openBulkModal: (modal) => set({ bulkModal: modal }),
  closeBulkModal: () => set({ bulkModal: null }),
  closeAll: () => set({
    showSettings: false,
    showDownload: false,
    showDuplicates: false,
    showStats: false,
    showQueuePanel: false,
    showExport: false,
    showSmartPlaylist: false,
    detailVideo: null,
    activePlaylist: null,
    addToPlaylistVideo: null,
    bulkModal: null,
  }),
}));
