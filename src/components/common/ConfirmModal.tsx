import { useTranslation } from "react-i18next";

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
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            onClick={onCancel}
          >
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-xs rounded text-white ${
              confirmDanger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
