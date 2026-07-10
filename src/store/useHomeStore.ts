import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { Video } from '../types';
import { useInboxStore } from './useInboxStore';
import { toast } from './useToastStore';

export interface HomeLibraryStats {
  totalVideos: number;
  imageCount: number;
  videoCount: number;
  watchedCount: number;
  todayAdded: number;
  todayWatched: number;
}

export interface DiskInfo {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
}

export interface LastViewedItem {
  video: Video;
  lastViewedAt: string;
}

export interface RecentFolderEntry {
  path: string;
  openedAt: string;
}

export const RECENT_FOLDERS_SETTING_KEY = 'recent_folders';
const RECENT_FOLDERS_MAX = 8;

interface HomeState {
  recentVideos: Video[];
  libraryStats: HomeLibraryStats | null;
  diskInfo: DiskInfo | null;
  watchingPaths: string[];
  lastViewed: LastViewedItem | null;
  recentFolders: RecentFolderEntry[];
  isLoading: boolean;
}

interface HomeActions {
  fetchHomeData: () => Promise<void>;
}

export const useHomeStore = create<HomeState & HomeActions>((set) => ({
  recentVideos: [],
  libraryStats: null,
  diskInfo: null,
  watchingPaths: [],
  lastViewed: null,
  recentFolders: [],
  isLoading: false,

  fetchHomeData: async () => {
    set({ isLoading: true });
    try {
      const [recentVideos, libraryStats, lastViewed, recentFoldersRaw, diskInfo, watchingPaths] = await Promise.all([
        invoke<Video[]>('db_get_recent_videos', { limit: 20 }),
        invoke<HomeLibraryStats>('db_get_library_stats'),
        invoke<LastViewedItem | null>('db_get_last_viewed_video'),
        invoke<string | null>('db_get_setting', { key: RECENT_FOLDERS_SETTING_KEY }),
        invoke<DiskInfo>('get_disk_info').catch(() => null),
        invoke<string[]>('get_watching_paths').catch(() => []),
        useInboxStore.getState().fetchInbox(),
      ]);
      let recentFolders: RecentFolderEntry[] = [];
      if (recentFoldersRaw) {
        try {
          recentFolders = JSON.parse(recentFoldersRaw);
        } catch {
          recentFolders = [];
        }
      }
      set({ recentVideos, libraryStats, diskInfo, watchingPaths, lastViewed, recentFolders: recentFolders.slice(0, RECENT_FOLDERS_MAX), isLoading: false });
    } catch (e) {
      console.error('[useHomeStore] fetchHomeData error:', e);
      toast.error(`ホーム画面の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      set({ isLoading: false });
    }
  },
}));
