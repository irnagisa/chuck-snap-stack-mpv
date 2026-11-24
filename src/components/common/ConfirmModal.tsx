import { useTranslation } from "react-i18next";
import { Button } from '../ui';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  confirmDanger?: boolean;
}

export function ConfirmModal({ message, onConfirm, onCancel, confirmLabel = 'OK', confirmDanger = false }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl px-6 py-5 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-gray-800 dark:text-gray-100 mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('confirm.cancel')}
          </Button>
          <Button variant={confirmDanger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
