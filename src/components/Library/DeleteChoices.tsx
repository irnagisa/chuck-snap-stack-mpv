import { FileX, ListX, Trash2 } from "lucide-react";
import { Button, type ButtonVariant } from "../ui";
import styles from "./LibraryModal.module.css";

interface Choice {
  label: string;
  description: string;
  onSelect: () => void;
}

interface Props {
  removeOnly: Choice;
  moveToTrash: Choice;
  deleteFile: Choice;
  disabled: boolean;
}

/** 削除方法の 3 択 (ライブラリから外す / ゴミ箱へ / 完全に削除)。単体・一括の削除モーダルで共通 */
export function DeleteChoices({ removeOnly, moveToTrash, deleteFile, disabled }: Props) {
  const items: { choice: Choice; variant: ButtonVariant; icon: React.ReactNode }[] = [
    { choice: removeOnly, variant: "secondary", icon: <ListX aria-hidden /> },
    { choice: moveToTrash, variant: "soft", icon: <Trash2 aria-hidden /> },
    { choice: deleteFile, variant: "danger-soft", icon: <FileX aria-hidden /> },
  ];

  return (
    <div className={styles.choices}>
      {items.map(({ choice, variant, icon }) => (
        <Button
          key={choice.label}
          variant={variant}
          size="md"
          fullWidth
          className={styles.choice}
          disabled={disabled}
          onClick={choice.onSelect}
        >
          {icon}
          <span className={styles.choiceText}>
            {choice.label}
            <span className={styles.choiceDesc}>{choice.description}</span>
          </span>
        </Button>
      ))}
    </div>
  );
}
