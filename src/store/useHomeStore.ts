import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { Video } from '../types';
import { useInboxStore } from './useInboxStore';
import { toast } from './useToastStore';

export interface HomeLibraryStats {
  totalVideos: number;
  imageCount: number;
  videoCount: number;
}

interface HomeState {
  recentVideos: Video[];
  libraryStats: HomeLibraryStats | null;
  isLoading: boolean;
}

interface HomeActions {
  fetchHomeData: () => Promise<void>;
}

export const useHomeStore = create<HomeState & HomeActions>((set) => ({
  recentVideos: [],
  libraryStats: null,
  isLoading: false,

  fetchHomeData: async () => {
    set({ isLoading: true });
    try {
      const [recentVideos, libraryStats] = await Promise.all([
        invoke<Video[]>('db_get_recent_videos', { limit: 20 }),
        invoke<HomeLibraryStats>('db_get_library_stats'),
        useInboxStore.getState().fetchInbox(),
      ]);
      set({ recentVideos, libraryStats, isLoading: false });
    } catch (e) {
      console.error('[useHomeStore] fetchHomeData error:', e);
      toast.error(`ホーム画面の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      set({ isLoading: false });
    }
  },
}));
