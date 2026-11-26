import { AnimatePresence, motion } from 'motion/react';
import { useToastStore } from '../../store/useToastStore';
import { X } from 'lucide-react';
import { Button, cx, motionPresets } from '../ui';
import styles from './Notice.module.css';

const { floatUp, presenceProps, transitions } = motionPresets;

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  // aria-live 領域は空でも常に置いておく (後から挿入された領域は読み上げられないことがあるため)
  return (
    <div
      className={cx(styles.stack, styles.toastStack)}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            variants={floatUp}
            {...presenceProps}
            transition={{ layout: transitions.spring }}
            className={cx(styles.card, styles.toast)}
            data-tone={toast.type}
          >
            <span className={styles.icon} aria-hidden>
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
            </span>
            <span className={styles.message}>{toast.message}</span>
            <Button size="icon-sm" variant="inherit" aria-label="閉じる" onClick={() => removeToast(toast.id)}>
              <X aria-hidden />
            </Button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
