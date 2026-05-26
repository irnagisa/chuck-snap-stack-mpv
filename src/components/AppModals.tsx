import { useModalStore } from '../store/useModalStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { SettingsPanel } from './Settings/SettingsPanel';
import { DownloadModal } from './Library/DownloadModal';
import { VideoDetailModal } from './Library/VideoDetailModal';
import { PlaylistModal } from './Library/PlaylistModal';
import { AddToPlaylistModal } from './Library/AddToPlaylistModal';
import { BulkDeleteModal } from './Library/BulkDeleteModal';
import { BulkTagModal } from './Library/BulkTagModal';
import { BulkCategoryModal } from './Library/BulkCategoryModal';
import { DuplicatesModal } from './Library/DuplicatesModal';
import type { Video } from '../types';

interface AppModalsProps {
  selectedVideoIds: Set<number>;
  selectedVideos: Video[];
  onClearSelection: () => void;
}

export function AppModals({ selectedVideoIds, selectedVideos, onClearSelection }: AppModalsProps) {
  const {
    showSettings, closeSettings,
    showDownload, closeDownload,
    showDuplicates, closeDuplicates,
    detailVideo, closeDetailVideo,
    activePlaylist, closePlaylist,
    addToPlaylistVideo, closeAddToPlaylist,
    bulkModal, closeBulkModal,
  } = useModalStore();
  const { fetchVideos } = useLibraryStore();

  return (
    <>
      {showSettings && <SettingsPanel onClose={closeSettings} />}

      {showDownload && <DownloadModal onClose={closeDownload} />}

      {showDuplicates && <DuplicatesModal onClose={closeDuplicates} />}

      {detailVideo && (
        <VideoDetailModal
          key={detailVideo.id}
          video={detailVideo}
          onClose={() => {
            closeDetailVideo();
            fetchVideos();
          }}
        />
      )}

      {activePlaylist && (
        <PlaylistModal
          playlist={activePlaylist}
          onClose={closePlaylist}
        />
      )}

      {addToPlaylistVideo && (
        <AddToPlaylistModal
          video={addToPlaylistVideo}
          onClose={closeAddToPlaylist}
        />
      )}

      {bulkModal === 'delete' && selectedVideos.length > 0 && (
        <BulkDeleteModal
          videos={selectedVideos}
          onClose={closeBulkModal}
          onDone={() => {
            closeBulkModal();
            onClearSelection();
          }}
        />
      )}

      {bulkModal === 'tag' && (
        <BulkTagModal
          videoIds={Array.from(selectedVideoIds)}
          onClose={closeBulkModal}
          onDone={() => {
            closeBulkModal();
            onClearSelection();
            fetchVideos();
          }}
        />
      )}

      {bulkModal === 'category' && (
        <BulkCategoryModal
          videoIds={Array.from(selectedVideoIds)}
          onClose={closeBulkModal}
          onDone={() => {
            closeBulkModal();
            onClearSelection();
            fetchVideos();
          }}
        />
      )}
    </>
  );
}
