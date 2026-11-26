import { useModalStore } from '../store/useModalStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { SettingsPanel } from './Settings/SettingsPanel';
import { DownloadModal } from './Library/DownloadModal';
import { PlaylistModal } from './Library/PlaylistModal';
import { AddToPlaylistModal } from './Library/AddToPlaylistModal';
import { BulkDeleteModal } from './Library/BulkDeleteModal';
import { BulkTagModal } from './Library/BulkTagModal';
import { BulkCategoryModal } from './Library/BulkCategoryModal';
import { BulkRenameModal } from './Library/BulkRenameModal';
import { BulkRatingModal } from './Library/BulkRatingModal';
import { BulkMoveDirModal } from './Library/BulkMoveDirModal';
import { DuplicatesModal } from './Library/DuplicatesModal';
import { BulkGroupModal } from './Library/BulkGroupModal';
import { GroupSuggestionsModal } from './Library/GroupSuggestionsModal';
import { MissingFilesModal } from './Library/MissingFilesModal';
import { StatsModal } from './Library/StatsModal';
import { StorageModal } from './Library/StorageModal';
import { ExportModal } from './Library/ExportModal';
import { SmartPlaylistModal } from './Library/SmartPlaylistModal';
import { DndDestDirModal } from './Library/DndDestDirModal';
import { QueuePanel } from './Player/QueuePanel';
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
    showGroupSuggestions, closeGroupSuggestions,
    showMissingFiles, closeMissingFiles,
    showStats, closeStats,
    showStorage, closeStorage,
    showExport, closeExport,
    showSmartPlaylist, closeSmartPlaylist,
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

      {showGroupSuggestions && <GroupSuggestionsModal onClose={closeGroupSuggestions} />}

      {showMissingFiles && <MissingFilesModal onClose={closeMissingFiles} />}

      {showStats && <StatsModal onClose={closeStats} />}

      {showStorage && <StorageModal onClose={closeStorage} />}

      {showExport && <ExportModal onClose={closeExport} />}

      {showSmartPlaylist && <SmartPlaylistModal onClose={closeSmartPlaylist} />}

      <DndDestDirModal />

      <QueuePanel />

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

      {bulkModal === 'rename' && selectedVideos.length > 0 && (
        <BulkRenameModal
          videos={selectedVideos}
          onClose={closeBulkModal}
          onDone={() => {
            closeBulkModal();
            onClearSelection();
          }}
        />
      )}

      {bulkModal === 'rating' && (
        <BulkRatingModal
          videoIds={Array.from(selectedVideoIds)}
          onClose={closeBulkModal}
          onDone={() => {
            closeBulkModal();
            onClearSelection();
          }}
        />
      )}

      {bulkModal === 'group' && selectedVideoIds.size > 0 && (
        <BulkGroupModal
          videoIds={Array.from(selectedVideoIds)}
          videos={selectedVideos}
          onClose={closeBulkModal}
          onDone={() => {
            closeBulkModal();
            onClearSelection();
          }}
        />
      )}

      {bulkModal === 'moveDir' && (
        <BulkMoveDirModal
          videoIds={Array.from(selectedVideoIds)}
          onClose={closeBulkModal}
          onDone={() => {
            closeBulkModal();
            onClearSelection();
          }}
        />
      )}
    </>
  );
}
