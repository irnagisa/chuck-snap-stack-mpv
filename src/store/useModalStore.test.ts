import { describe, it, expect, beforeEach } from 'vitest';
import { useModalStore } from './useModalStore';
import type { Video } from '../types';

const INITIAL = useModalStore.getState();

beforeEach(() => {
  useModalStore.setState(INITIAL);
});

function makeVideo(id: number): Video {
  return {
    id,
    path: `/tmp/${id}.mp4`,
    title: `Video ${id}`,
    duration: null,
    thumbnail: null,
    watched_at: null,
    progress: 0,
    rating: 0,
    category_id: null,
    has_audio: null,
    watch_count: 0,
    created_at: '2024-01-01',
    media_type: 'video',
    source_url: null,
    status: null,
    source_type: null,
  };
}

// ---------------------------------------------------------------------------
// Boolean flag modals
// ---------------------------------------------------------------------------

describe('Settings modal', () => {
  it('openSettings sets showSettings true', () => {
    useModalStore.getState().openSettings();
    expect(useModalStore.getState().showSettings).toBe(true);
  });

  it('closeSettings sets showSettings false', () => {
    useModalStore.getState().openSettings();
    useModalStore.getState().closeSettings();
    expect(useModalStore.getState().showSettings).toBe(false);
  });
});

describe('Download modal', () => {
  it('openDownload / closeDownload toggles showDownload', () => {
    useModalStore.getState().openDownload();
    expect(useModalStore.getState().showDownload).toBe(true);
    useModalStore.getState().closeDownload();
    expect(useModalStore.getState().showDownload).toBe(false);
  });
});

describe('Duplicates modal', () => {
  it('openDuplicates / closeDuplicates toggles showDuplicates', () => {
    useModalStore.getState().openDuplicates();
    expect(useModalStore.getState().showDuplicates).toBe(true);
    useModalStore.getState().closeDuplicates();
    expect(useModalStore.getState().showDuplicates).toBe(false);
  });
});

describe('Stats modal', () => {
  it('openStats / closeStats toggles showStats', () => {
    useModalStore.getState().openStats();
    expect(useModalStore.getState().showStats).toBe(true);
    useModalStore.getState().closeStats();
    expect(useModalStore.getState().showStats).toBe(false);
  });
});

describe('Export modal', () => {
  it('openExport / closeExport toggles showExport', () => {
    useModalStore.getState().openExport();
    expect(useModalStore.getState().showExport).toBe(true);
    useModalStore.getState().closeExport();
    expect(useModalStore.getState().showExport).toBe(false);
  });
});

describe('SmartPlaylist modal', () => {
  it('openSmartPlaylist / closeSmartPlaylist toggles showSmartPlaylist', () => {
    useModalStore.getState().openSmartPlaylist();
    expect(useModalStore.getState().showSmartPlaylist).toBe(true);
    useModalStore.getState().closeSmartPlaylist();
    expect(useModalStore.getState().showSmartPlaylist).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Queue panel toggle
// ---------------------------------------------------------------------------

describe('Queue panel', () => {
  it('toggleQueuePanel flips showQueuePanel each call', () => {
    const before = useModalStore.getState().showQueuePanel;
    useModalStore.getState().toggleQueuePanel();
    expect(useModalStore.getState().showQueuePanel).toBe(!before);
    useModalStore.getState().toggleQueuePanel();
    expect(useModalStore.getState().showQueuePanel).toBe(before);
  });

  it('closeQueuePanel sets showQueuePanel to false', () => {
    useModalStore.getState().toggleQueuePanel(); // true
    useModalStore.getState().closeQueuePanel();
    expect(useModalStore.getState().showQueuePanel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Object-valued modals
// ---------------------------------------------------------------------------

describe('Detail video modal', () => {
  it('openDetailVideo sets detailVideo', () => {
    const v = makeVideo(1);
    useModalStore.getState().openDetailVideo(v);
    expect(useModalStore.getState().detailVideo).toEqual(v);
  });

  it('closeDetailVideo sets detailVideo to null', () => {
    useModalStore.getState().openDetailVideo(makeVideo(1));
    useModalStore.getState().closeDetailVideo();
    expect(useModalStore.getState().detailVideo).toBeNull();
  });
});

describe('Bulk modal', () => {
  it('openBulkModal sets bulkModal value', () => {
    useModalStore.getState().openBulkModal('delete');
    expect(useModalStore.getState().bulkModal).toBe('delete');
  });

  it('closeBulkModal sets bulkModal to null', () => {
    useModalStore.getState().openBulkModal('tag');
    useModalStore.getState().closeBulkModal();
    expect(useModalStore.getState().bulkModal).toBeNull();
  });
});

describe('DnD dest dir modal', () => {
  it('openDndDestDir stores pending files and callback', () => {
    const files = ['a.mp4', 'b.mp4'];
    const onSelect = () => {};
    useModalStore.getState().openDndDestDir(files, onSelect);
    expect(useModalStore.getState().dndPendingFiles).toEqual(files);
    expect(useModalStore.getState().dndOnSelect).toBe(onSelect);
  });

  it('closeDndDestDir clears pending files and callback', () => {
    useModalStore.getState().openDndDestDir(['x.mp4'], () => {});
    useModalStore.getState().closeDndDestDir();
    expect(useModalStore.getState().dndPendingFiles).toBeNull();
    expect(useModalStore.getState().dndOnSelect).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// closeAll
// ---------------------------------------------------------------------------

describe('closeAll', () => {
  it('resets every flag and object to initial falsy state', () => {
    useModalStore.getState().openSettings();
    useModalStore.getState().openDownload();
    useModalStore.getState().openStats();
    useModalStore.getState().openDetailVideo(makeVideo(1));
    useModalStore.getState().openBulkModal('rating');
    useModalStore.getState().openDndDestDir(['f.mp4'], () => {});

    useModalStore.getState().closeAll();

    const s = useModalStore.getState();
    expect(s.showSettings).toBe(false);
    expect(s.showDownload).toBe(false);
    expect(s.showStats).toBe(false);
    expect(s.showDuplicates).toBe(false);
    expect(s.showMissingFiles).toBe(false);
    expect(s.showQueuePanel).toBe(false);
    expect(s.showExport).toBe(false);
    expect(s.showSmartPlaylist).toBe(false);
    expect(s.detailVideo).toBeNull();
    expect(s.activePlaylist).toBeNull();
    expect(s.addToPlaylistVideo).toBeNull();
    expect(s.bulkModal).toBeNull();
    expect(s.dndPendingFiles).toBeNull();
    expect(s.dndOnSelect).toBeNull();
  });
});
