import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as RxDialog } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { fade, popIn, presenceProps, transitions } from "./motion";
import styles from "./Dialog.module.css";

export type DialogSize = "sm" | "md" | "lg" | "xl";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** フッター (ボタン列など)。右寄せで並ぶ */
  footer?: ReactNode;
  size?: DialogSize;
  /** 閉じるボタン (×) を出すか */
  showClose?: boolean;
  closeLabel?: string;
  /** 退場アニメーションが終わったとき (useDialogClose と組み合わせる) */
  onExitComplete?: () => void;
  /** ヘッダー右側 (× の左) に置く操作 */
  headerActions?: ReactNode;
  /** 本文の内側余白をなくす (一覧を端まで広げるとき) */
  flush?: boolean;
}

/**
 * Radix Dialog + Motion の enter/exit アニメーション付きモーダル。
 * 退場アニメーションのため open は必ず制御 (controlled) で渡す。
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  showClose = true,
  closeLabel = "Close",
  onExitComplete,
  headerActions,
  flush = false,
}: DialogProps) {
  return (
    <RxDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence onExitComplete={onExitComplete}>
        {open && (
          <RxDialog.Portal forceMount>
            <RxDialog.Overlay asChild forceMount>
              <motion.div
                className={styles.overlay}
                variants={fade}
                transition={transitions.fast}
                {...presenceProps}
              />
            </RxDialog.Overlay>
            <RxDialog.Content
              asChild
              forceMount
              {...(description == null && { "aria-describedby": undefined })}
            >
              <motion.div
                className={styles.content}
                data-size={size}
                variants={popIn}
                transition={transitions.normal}
                {...presenceProps}
              >
                <div className={styles.header}>
                  <div className={styles.heading}>
                    <RxDialog.Title className={styles.title}>{title}</RxDialog.Title>
                    {description != null && (
                      <RxDialog.Description className={styles.description}>{description}</RxDialog.Description>
                    )}
                  </div>
                  {headerActions}
                  {showClose && (
                    <RxDialog.Close asChild>
                      <Button variant="ghost" size="icon" aria-label={closeLabel}>
                        <X />
                      </Button>
                    </RxDialog.Close>
                  )}
                </div>
                {children != null && (
                  <div className={styles.body} data-flush={flush || undefined}>
                    {children}
                  </div>
                )}
                {footer != null && <div className={styles.footer}>{footer}</div>}
              </motion.div>
            </RxDialog.Content>
          </RxDialog.Portal>
        )}
      </AnimatePresence>
    </RxDialog.Root>
  );
}

/**
 * 親が `{x && <Modal onClose={...} />}` のように条件付きでマウントするモーダル用。
 * 閉じるときはまず open=false にして退場アニメーションを再生し、終わってから
 * onClosed (または close に渡したコールバック) を呼んで親にアンマウントさせる。
 *
 * ```tsx
 * const dialog = useDialogClose(onClose);
 * <Dialog {...dialog.props} title="…">…<Button onClick={() => dialog.close(onDone)} /></Dialog>
 * ```
 */
export function useDialogClose(onClosed: () => void, options: { locked?: boolean } = {}) {
  const { locked = false } = options;
  const [open, setOpen] = useState(true);
  const after = useRef<(() => void) | null>(null);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  const close = useCallback((then?: () => void) => {
    after.current = then ?? null;
    setOpen(false);
  }, []);

  const props = {
    open,
    // locked の間 (処理中など) は Esc・背景クリック・× で閉じない
    onOpenChange: (next: boolean) => {
      if (!next && !locked) close();
    },
    onExitComplete: () => {
      (after.current ?? onClosedRef.current)();
    },
  };

  return { open, close, props };
}
