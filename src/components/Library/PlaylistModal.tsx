import { useState, useEffect } from 'react';
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Playlist, Video } from '../../types';
import { usePlaylistStore } from '../../store/usePlaylistStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { GripVertical, Play, X } from "lucide-react";
import { Button, Dialog, useDialogClose } from "../ui";
import { ThumbImage } from "./MediaThumb";
import { formatTime } from "../../utils/time";
import styles from "./LibraryModal.module.css";

interface SortableItemProps {
  video: Video;
  index: number;
  onPlay: (index: number) => void;
  onRemove: (videoId: number) => void;
}

function SortableItem({ video, index, onPlay, onRemove }: SortableItemProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: video.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const title = video.title ?? video.path.split('/').pop();

  return (
    <div ref={setNodeRef} style={style} className={styles.sortRow} data-dragging={isDragging || undefined}>
      {/* ドラッグハンドル */}
      <button
        type="button"
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
        title={t('playlist.dragToReorder')}
        aria-label={t('playlist.dragToReorder')}
      >
        <GripVertical aria-hidden />
      </button>

      <span className={styles.sortIndex}>{index + 1}</span>

      {/* サムネイルとタイトルはクリックでここから再生 */}
      <button type="button" className={styles.sortMain} onClick={() => onPlay(index)} title={title}>
        <span className={`${styles.miniThumb} ${styles.thumbBox}`}>
          {video.thumbnail && <ThumbImage src={video.thumbnail} alt="" />}
        </span>
        <span className={styles.sortTitle}>{title}</span>
      </button>

      {video.duration != null && (
        <span className={styles.sortMeta}>{formatTime(video.duration)}</span>
      )}

      <Button
        variant="danger-soft"
        size="icon-sm"
        className={styles.sortRemove}
        aria-label={t('playlist.removeFromPlaylist')}
        onClick={() => onRemove(video.id)}
        title={t('playlist.removeFromPlaylist')}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

interface Props {
  playlist: Playlist;
  onClose: () => void;
}

export function PlaylistModal({ playlist, onClose }: Props) {
  const { t } = useTranslation();
  const { fetchPlaylistVideos, removeVideoFromPlaylist, reorderPlaylistItems } = usePlaylistStore();
  const { playWithQueue } = usePlayerStore();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const dialog = useDialogClose(onClose);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const loadVideos = async () => {
    setLoading(true);
    const result = await fetchPlaylistVideos(playlist.id);
    setVideos(result);
    setLoading(false);
  };

  useEffect(() => {
    loadVideos();
  }, [playlist.id]);

  const handlePlayAll = async () => {
    if (videos.length === 0) return;
    await playWithQueue(videos, 0);
    dialog.close();
  };

  const handlePlayOne = async (_video: Video, index: number) => {
    await playWithQueue(videos, index);
    dialog.close();
  };

  const handleRemove = async (videoId: number) => {
    await removeVideoFromPlaylist(playlist.id, videoId);
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = videos.findIndex((v) => v.id === active.id);
    const newIndex = videos.findIndex((v) => v.id === over.id);
    const reordered = arrayMove(videos, oldIndex, newIndex);
    setVideos(reordered);
    await reorderPlaylistItems(playlist.id, reordered.map((v) => v.id));
  };

  return (
    <Dialog
      {...dialog.props}
      size="md"
      title={playlist.name}
      closeLabel={t('confirm.close')}
      flush
      headerActions={
        <Button variant="primary" size="sm" disabled={videos.length === 0} onClick={handlePlayAll}>
          <Play aria-hidden fill="currentColor" />
          {t('playlist.playAll')}
        </Button>
      }
      footer={
        !loading ? (
          <span className={`${styles.note} ${styles.footerLead}`}>
            {videos.length} {t('playlist.countSuffix')}
          </span>
        ) : undefined
      }
    >
      {loading && <p className={styles.flushNote}>{t('playlist.loading')}</p>}
      {!loading && videos.length === 0 && <p className={styles.flushNote}>{t('playlist.noVideos')}</p>}
      {!loading && videos.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={videos.map((v) => v.id)} strategy={verticalListSortingStrategy}>
            {videos.map((v, idx) => (
              <SortableItem
                key={v.id}
                video={v}
                index={idx}
                onPlay={(index) => handlePlayOne(v, index)}
                onRemove={handleRemove}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </Dialog>
  );
}
