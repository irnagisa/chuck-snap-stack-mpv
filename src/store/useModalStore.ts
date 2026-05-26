import { create } from 'zustand';
import type { Video, Playlist } from '../types';

type BulkModal = 'delete' | 'tag' | 'category' | null;

interface ModalStore {
  showSettings: boolean;
  showDownload: boolean;
  showDuplicates: boolean;
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
    detailVideo: null,
    activePlaylist: null,
    addToPlaylistVideo: null,
    bulkModal: null,
  }),
}));
