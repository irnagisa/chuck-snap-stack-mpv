import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

export type ViewMode = 'grid' | 'list';
export type ListItemSize = 'S' | 'M' | 'L' | 'XL';
export type SidebarTab = 'category' | 'playlist' | 'folder';

const GRID_SIZE_PRESETS = [120, 180, 240, 320] as const;

function snapToPreset(n: number): number {
  return GRID_SIZE_PRESETS.reduce((prev, cur) =>
    Math.abs(cur - n) < Math.abs(prev - n) ? cur : prev
  );
}

interface LibraryViewState {
  viewMode: ViewMode;
  gridItemMinWidth: number;
  listItemSize: ListItemSize;
  sidebarTab: SidebarTab;
  setViewMode: (mode: ViewMode) => void;
  setGridItemMinWidth: (width: number) => void;
  setListItemSize: (size: ListItemSize) => void;
  setSidebarTab: (tab: SidebarTab) => void;
}

export const useLibraryViewStore = create<LibraryViewState>((set) => ({
  viewMode: (localStorage.getItem('viewMode') as ViewMode) ?? 'grid',
  gridItemMinWidth: snapToPreset(Number(localStorage.getItem('gridItemMinWidth') ?? '180')),
  listItemSize: (localStorage.getItem('listItemSize') as ListItemSize) ?? 'M',
  sidebarTab: 'category',

  setViewMode: (mode) => {
    localStorage.setItem('viewMode', mode);
    set({ viewMode: mode });
  },
  setGridItemMinWidth: (width) => {
    localStorage.setItem('gridItemMinWidth', String(width));
    set({ gridItemMinWidth: width });
  },
  setListItemSize: (size) => {
    localStorage.setItem('listItemSize', size);
    set({ listItemSize: size });
  },
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
}));

export { useShallow };
