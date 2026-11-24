import { AnimatePresence, motion } from 'motion/react';
import { useToastStore } from '../../store/useToastStore';
import { X } from 'lucide-react';
import { Button, motionPresets } from '../ui';

const { floatUp, presenceProps, transitions } = motionPresets;

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  // aria-live 領域は空でも常に置いておく (後から挿入された領域は読み上げられないことがあるため)
  return (
    <div
      className="fixed bottom-24 right-4 flex flex-col gap-2 z-[200] pointer-events-none"
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
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium max-w-xs pointer-events-auto
              ${toast.type === 'success'
                ? 'bg-green-600 text-white'
                : toast.type === 'error'
                ? 'bg-red-600 text-white'
                : 'bg-gray-800 text-gray-100 dark:bg-gray-700'
              }`}
          >
            <span className="shrink-0">
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
            </span>
            <span className="flex-1">{toast.message}</span>
            <Button size="icon-sm" variant="inherit" aria-label="閉じる" onClick={() => removeToast(toast.id)}>
              <X aria-hidden />
            </Button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
