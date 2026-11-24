import type { ReactNode } from "react";
import { AlertDialog as RxAlertDialog } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "./Button";
import { fade, popIn, presenceProps, transitions } from "./motion";
import styles from "./Dialog.module.css";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  onConfirm: () => void;
  danger?: boolean;
}

/**
 * 確認ダイアログ (Radix AlertDialog)。
 * オーバーレイクリックでは閉じず、初期フォーカスはキャンセルボタンに当たる。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  danger = false,
}: ConfirmDialogProps) {
  return (
    <RxAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RxAlertDialog.Portal forceMount>
            <RxAlertDialog.Overlay asChild forceMount>
              <motion.div
                className={styles.overlay}
                variants={fade}
                transition={transitions.fast}
                {...presenceProps}
              />
            </RxAlertDialog.Overlay>
            <RxAlertDialog.Content
              asChild
              forceMount
              {...(description == null && { "aria-describedby": undefined })}
            >
              <motion.div
                className={styles.content}
                data-size="sm"
                variants={popIn}
                transition={transitions.normal}
                {...presenceProps}
              >
                <div className={styles.header}>
                  <div className={styles.heading}>
                    <RxAlertDialog.Title className={styles.title}>{title}</RxAlertDialog.Title>
                    {description != null && (
                      <RxAlertDialog.Description className={styles.description}>
                        {description}
                      </RxAlertDialog.Description>
                    )}
                  </div>
                </div>
                <div className={styles.footer} data-standalone="">
                  <RxAlertDialog.Cancel asChild>
                    <Button variant="secondary">{cancelLabel}</Button>
                  </RxAlertDialog.Cancel>
                  <RxAlertDialog.Action asChild>
                    <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
                      {confirmLabel}
                    </Button>
                  </RxAlertDialog.Action>
                </div>
              </motion.div>
            </RxAlertDialog.Content>
          </RxAlertDialog.Portal>
        )}
      </AnimatePresence>
    </RxAlertDialog.Root>
  );
}
