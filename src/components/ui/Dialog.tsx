import type { ReactNode } from "react";
import { Dialog as RxDialog } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { fade, popIn, presenceProps, transitions } from "./motion";
import styles from "./Dialog.module.css";

export type DialogSize = "sm" | "md" | "lg";

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
}: DialogProps) {
  return (
    <RxDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
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
                  {showClose && (
                    <RxDialog.Close asChild>
                      <Button variant="ghost" size="icon" aria-label={closeLabel}>
                        <X />
                      </Button>
                    </RxDialog.Close>
                  )}
                </div>
                {children != null && <div className={styles.body}>{children}</div>}
                {footer != null && <div className={styles.footer}>{footer}</div>}
              </motion.div>
            </RxDialog.Content>
          </RxDialog.Portal>
        )}
      </AnimatePresence>
    </RxDialog.Root>
  );
}
