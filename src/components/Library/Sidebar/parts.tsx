import { Fragment, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { Button, Collapse, ConfirmDialog, ContextMenu, DropdownMenu, Input, Popover } from "../../ui";
import { ColorSwatches } from "../ColorSwatches";
import { IconPicker } from "../../../lib/mediaIcons";
import styles from "./Sidebar.module.css";

/* ------------------------------------------------------------------ */
/* セクション                                                           */
/* ------------------------------------------------------------------ */

interface SectionProps {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** このセクションで絞り込み中なら、見出しに印を出す (折りたたみ中に見落とさないため) */
  active?: boolean;
  /** 見出しの右端に置く操作 (追加ボタンなど) */
  action?: ReactNode;
  children: ReactNode;
}

/** 見出しをクリックで開閉できるサイドバーのセクション */
export function SidebarSection({ title, open, onOpenChange, active, action, children }: SectionProps) {
  const { t } = useTranslation();
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        <button
          type="button"
          className={styles.sectionToggle}
          data-open={open || undefined}
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronRight aria-hidden />
          <span className={styles.sectionTitle}>{title}</span>
          {active && <span className={styles.activeDot} title={t("sidebar.filtering")} />}
        </button>
        {action}
      </div>
      <Collapse show={open}>
        <div className={styles.sectionBody}>{children}</div>
      </Collapse>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 行の操作メニュー (右クリック と hover の「…」で同じ項目を出す)          */
/* ------------------------------------------------------------------ */

export interface RowAction {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 右端に添えるキーの表示 (例: "F2") */
  shortcut?: string;
  /** この項目の前に区切り線を入れる */
  separated?: boolean;
}

/**
 * メニューを閉じたあと、トリガーへフォーカスを戻さないようにする。
 * 項目を選んで開いたポップオーバーやダイアログからフォーカスが奪われて、すぐ閉じてしまうのを防ぐ。
 */
function useKeepFocusAfterSelect() {
  const selected = useRef(false);
  return {
    markSelected: () => { selected.current = true; },
    onCloseAutoFocus: (e: Event) => {
      if (selected.current) e.preventDefault();
      selected.current = false;
    },
  };
}

function renderItems<T extends typeof ContextMenu | typeof DropdownMenu>(
  Menu: T,
  actions: RowAction[],
  markSelected: () => void,
) {
  return actions.map((a) => (
    <Fragment key={a.key}>
      {a.separated && <Menu.Separator />}
      <Menu.Item
        icon={a.icon}
        danger={a.danger}
        disabled={a.disabled}
        shortcut={a.shortcut}
        onSelect={() => { markSelected(); a.onSelect(); }}
      >
        {a.label}
      </Menu.Item>
    </Fragment>
  ));
}

interface MenuRowProps {
  actions: RowAction[];
  /** 「…」ボタンの読み上げ名 (行の名前を含める) */
  moreLabel: string;
  /** 行に添えて開く編集ポップオーバー */
  editor?: { open: boolean; onOpenChange: (open: boolean) => void; content: ReactNode };
  className?: string;
  style?: CSSProperties;
  /** 「…」を出さず、右クリックだけにする (チップなど小さい要素向け) */
  contextOnly?: boolean;
  children: ReactNode;
}

/** 右クリックと hover の「…」で操作メニューを出す行。編集ポップオーバーはこの行に添えて開く */
export function MenuRow({ actions, moreLabel, editor, className = styles.rowWrap, style, contextOnly, children }: MenuRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ctx = useKeepFocusAfterSelect();
  const dropdown = useKeepFocusAfterSelect();
  const hasMenu = actions.length > 0;
  const rowRef = useRef<HTMLDivElement>(null);

  // 編集ポップオーバーを閉じたら、行の要素 (data-focus-return) へフォーカスを戻す。
  // ただし閉じる間に別の要素をクリックしていたら、そちらのフォーカスを奪わない
  const returnFocus = (e: Event) => {
    e.preventDefault();
    const active = document.activeElement;
    if (active && active !== document.body) return;
    rowRef.current?.querySelector<HTMLElement>("[data-focus-return]")?.focus();
  };

  return (
    <ContextMenu.Root>
      <Popover.Root open={editor?.open ?? false} onOpenChange={editor?.onOpenChange}>
        <ContextMenu.Trigger asChild disabled={!hasMenu}>
          <Popover.Anchor asChild>
            <div
              ref={rowRef}
              className={className}
              style={style}
              data-has-menu={(hasMenu && !contextOnly) || undefined}
              data-menu-open={menuOpen || undefined}
            >
              {children}
              {hasMenu && !contextOnly && (
                <div className={styles.rowMore}>
                  <DropdownMenu.Root onOpenChange={setMenuOpen}>
                    <DropdownMenu.Trigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={moreLabel} title={moreLabel}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="start" side="right" onCloseAutoFocus={dropdown.onCloseAutoFocus}>
                      {renderItems(DropdownMenu, actions, dropdown.markSelected)}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              )}
            </div>
          </Popover.Anchor>
        </ContextMenu.Trigger>
        {editor && (
          <Popover.Content side="right" align="start" sideOffset={10} onCloseAutoFocus={returnFocus}>
            {editor.content}
          </Popover.Content>
        )}
      </Popover.Root>
      {hasMenu && (
        <ContextMenu.Content onCloseAutoFocus={ctx.onCloseAutoFocus}>
          {renderItems(ContextMenu, actions, ctx.markSelected)}
        </ContextMenu.Content>
      )}
    </ContextMenu.Root>
  );
}

/** 見出しの「＋」ボタン。押すと追加用のポップオーバーを開く */
export function AddButton({ label, open, onOpenChange, children }: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <Plus aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Content side="right" align="start" sideOffset={10}>
        {children}
      </Popover.Content>
    </Popover.Root>
  );
}

/* ------------------------------------------------------------------ */
/* 追加・編集フォーム                                                    */
/* ------------------------------------------------------------------ */

interface EditorFormProps {
  title: string;
  initialName?: string;
  placeholder?: string;
  /** 指定すると色を選べる */
  initialColor?: string;
  /** 指定すると (null でも) アイコンを選べる */
  initialIcon?: string | null;
  /** 名前・色・アイコン以外の入力 (親カテゴリ・グループの選択など) */
  extra?: ReactNode;
  submitLabel: string;
  onSubmit: (v: { name: string; color: string; icon: string | null }) => void | Promise<void>;
  onCancel: () => void;
}

/** 名前・色・アイコンを編集する小さなフォーム。ポップオーバーの中身として使う */
export function EditorForm({
  title, initialName = "", placeholder, initialColor, initialIcon, extra, submitLabel, onSubmit, onCancel,
}: EditorFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor ?? "");
  const [icon, setIcon] = useState<string | null>(initialIcon ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), color, icon });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.editor}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <h3 className={styles.editorTitle}>{title}</h3>
      <Input
        size="sm"
        className={styles.fullWidth}
        autoFocus
        aria-label={t("category.name")}
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {initialColor !== undefined && (
        <div className={styles.editorField}>
          <span className={styles.editorLabel}>{t("category.color")}</span>
          <ColorSwatches value={color} onChange={setColor} />
        </div>
      )}
      {initialIcon !== undefined && (
        <div className={styles.editorField}>
          <span className={styles.editorLabel}>{t("category.icon")}</span>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
      )}
      {extra}
      <div className={styles.editorActions}>
        <Button variant="ghost" size="xs" onClick={onCancel}>{t("category.cancel")}</Button>
        <Button type="submit" variant="primary" size="xs" disabled={!name.trim() || busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}

/** ラベル付きの入力欄 (EditorForm の extra 用) */
export function EditorField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.editorField}>
      <span className={styles.editorLabel}>{label}</span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 削除の確認                                                            */
/* ------------------------------------------------------------------ */

interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

/** 削除前の確認ダイアログ。`confirm({...})` で開き、`dialog` を描画しておく */
export function useConfirm() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 閉じるアニメーション中も文言を保つため、閉じても request は消さない
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = (req: ConfirmRequest) => {
    setRequest(req);
    setOpen(true);
  };

  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={request?.title ?? ""}
      description={request?.description}
      confirmLabel={request?.confirmLabel ?? ""}
      cancelLabel={t("category.cancel")}
      onConfirm={() => { void request?.onConfirm(); }}
      danger
    />
  );

  return { confirm, dialog };
}
