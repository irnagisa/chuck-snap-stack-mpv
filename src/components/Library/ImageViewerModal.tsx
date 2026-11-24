import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Dialog as RxDialog } from 'radix-ui';
import { AnimatePresence, motion } from 'motion/react';
import type { Video } from '../../types';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button, motionPresets, useDialogClose } from '../ui';
import styles from './ImageViewerModal.module.css';

interface Props {
  video: Video;
  allImages: Video[];
  onClose: () => void;
  onNavigate: (video: Video) => void;
}

const { fade, presenceProps, transitions } = motionPresets;

/** 画像の全画面ビューワー。← → で前後の画像、Esc で閉じる */
export function ImageViewerModal({ video, allImages, onClose, onNavigate }: Props) {
  const { t } = useTranslation();
  const dialog = useDialogClose(onClose);
  const idx = allImages.findIndex((v) => v.id === video.id);
  const title = video.title ?? video.path.split('/').pop() ?? '';

  const goPrev = useCallback(() => {
    if (idx > 0) onNavigate(allImages[idx - 1]);
  }, [idx, allImages, onNavigate]);

  const goNext = useCallback(() => {
    if (idx < allImages.length - 1) onNavigate(allImages[idx + 1]);
  }, [idx, allImages, onNavigate]);

  // Esc は Radix が処理する。左右キーだけここで拾う
  useEffect(() => {
    if (!dialog.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dialog.open, goPrev, goNext]);

  return (
    <RxDialog.Root open={dialog.open} onOpenChange={dialog.props.onOpenChange}>
      <AnimatePresence onExitComplete={dialog.props.onExitComplete}>
        {dialog.open && (
          <RxDialog.Portal forceMount>
            <RxDialog.Overlay asChild forceMount>
              <motion.div className={styles.overlay} variants={fade} transition={transitions.normal} {...presenceProps} />
            </RxDialog.Overlay>
            <RxDialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className={styles.content}
                variants={fade}
                transition={transitions.normal}
                {...presenceProps}
                // 画像の外側 (余白) をクリックしたら閉じる
                onClick={(e) => {
                  if (e.target === e.currentTarget) dialog.close();
                }}
              >
                <RxDialog.Title className={styles.srOnly}>{title}</RxDialog.Title>

                <figure className={styles.figure}>
                  {/* 画像を切り替えるたびに軽くズームしながら出す */}
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.img
                      key={video.id}
                      src={convertFileSrc(video.path)}
                      alt={title}
                      className={styles.image}
                      draggable={false}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, transition: transitions.exit }}
                      transition={transitions.normal}
                    />
                  </AnimatePresence>
                  <figcaption className={styles.caption}>
                    <span className={styles.captionTitle}>{title}</span>
                    {allImages.length > 1 && (
                      <span className={styles.counter}>
                        {t('imageViewer.counter', { current: idx + 1, total: allImages.length })}
                      </span>
                    )}
                  </figcaption>
                </figure>

                {idx > 0 && (
                  <Button
                    variant="inherit"
                    size="icon"
                    className={styles.navButton}
                    data-side="prev"
                    onClick={goPrev}
                    title={t('imageViewer.prev')}
                    aria-label={t('imageViewer.prev')}
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                )}
                {idx < allImages.length - 1 && (
                  <Button
                    variant="inherit"
                    size="icon"
                    className={styles.navButton}
                    data-side="next"
                    onClick={goNext}
                    title={t('imageViewer.next')}
                    aria-label={t('imageViewer.next')}
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                )}

                <RxDialog.Close asChild>
                  <Button
                    variant="inherit"
                    size="icon"
                    className={styles.closeButton}
                    title={t('imageViewer.close')}
                    aria-label={t('imageViewer.close')}
                  >
                    <X aria-hidden />
                  </Button>
                </RxDialog.Close>
              </motion.div>
            </RxDialog.Content>
          </RxDialog.Portal>
        )}
      </AnimatePresence>
    </RxDialog.Root>
  );
}
