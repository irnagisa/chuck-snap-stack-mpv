import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { buildCategoryTree, flattenCategoryTree, getCategoryDescendantIds, useTagStore } from "../../../store/useTagStore";
import { useLibraryStore } from "../../../store/useLibraryStore";
import { toast } from "../../../store/useToastStore";
import { Select } from "../../ui";
import { MediaIcon } from "../../../lib/mediaIcons";
import { TAXONOMY_COLORS as COLORS } from "../ColorSwatches";
import { tagColorStyle } from "../TagBadge";
import type { Category } from "../../../types";
import { AddButton, EditorField, EditorForm, MenuRow, SidebarSection, useConfirm } from "./parts";
import styles from "./Sidebar.module.css";

interface Props {
  search: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

/** 編集中のポップオーバー: 既存カテゴリの編集か、そのカテゴリの下への追加 */
type Editing = { kind: "edit" | "addChild"; id: number } | null;

export function CategorySection({ search, open, onOpenChange, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const categories = useTagStore((s) => s.categories);
  const createCategory = useTagStore((s) => s.createCategory);
  const updateCategory = useTagStore((s) => s.updateCategory);
  const deleteCategory = useTagStore((s) => s.deleteCategory);
  const fetchVideos = useLibraryStore((s) => s.fetchVideos);
  const { confirm, dialog } = useConfirm();

  const [editing, setEditing] = useState<Editing>(null);
  const [adding, setAdding] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const collapsedInitialized = useRef(false);

  // 初回は子を持つカテゴリを畳んでおく
  useEffect(() => {
    if (collapsedInitialized.current || categories.length === 0) return;
    collapsedInitialized.current = true;
    setCollapsedIds(new Set(categories.filter((cat) => categories.some((c) => c.parent_id === cat.id)).map((c) => c.id)));
  }, [categories]);

  const tree = useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories]);
  const parentIds = useMemo(() => new Set(categories.map((c) => c.parent_id).filter((id): id is number => id !== null)), [categories]);

  // 検索中は、名前が一致したカテゴリとその祖先だけを (畳み状態を無視して) 出す
  const matchedIds = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return null;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const matched = new Set<number>();
    for (const cat of categories) {
      if (!cat.name.toLowerCase().includes(q)) continue;
      for (let cur: Category | undefined = cat; cur && !matched.has(cur.id); cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id)) {
        matched.add(cur.id);
      }
    }
    return matched;
  }, [search, categories]);

  const toggleCollapsed = (id: number, collapse?: boolean) => setCollapsedIds((prev) => {
    const next = new Set(prev);
    if (collapse ?? !next.has(id)) next.add(id); else next.delete(id);
    return next;
  });

  const parentSelect = (value: number | null, onChange: (v: number | null) => void, excludeId?: number) => {
    const excluded = excludeId === undefined ? new Set<number>() : new Set(getCategoryDescendantIds(excludeId, categories));
    return (
      <EditorField label={t("category.parent")}>
        <Select
          fullWidth
          aria-label={t("category.parent")}
          value={value == null ? "" : String(value)}
          onValueChange={(v) => onChange(v === "" ? null : Number(v))}
          options={[
            { value: "", label: t("category.rootParent") },
            ...tree
              .filter(({ category }) => !excluded.has(category.id))
              .map(({ category, depth }) => ({ value: String(category.id), label: `${"　".repeat(depth)}${category.name}` })),
          ]}
        />
      </EditorField>
    );
  };

  const handleCreate = async (name: string, color: string, icon: string | null, parentId: number | null) => {
    try {
      await createCategory(name, color, parentId, icon);
      if (parentId !== null) toggleCollapsed(parentId, false);
      setAdding(false);
      setEditing(null);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const requestDelete = (cat: Category) => confirm({
    title: t("category.deleteConfirmTitle", { name: cat.name }),
    description: t("category.deleteConfirmDescription"),
    confirmLabel: t("category.delete"),
    onConfirm: async () => {
      if (selectedId === cat.id) onSelect(null);
      try {
        await deleteCategory(cat.id);
        await fetchVideos();
      } catch (e) {
        toast.error(String(e));
      }
    },
  });

  const rows: ReactNode[] = [];
  const hiddenIds = new Set<number>();
  for (const { category: cat, depth } of tree) {
    if (matchedIds) {
      if (!matchedIds.has(cat.id)) continue;
    } else if (cat.parent_id !== null && hiddenIds.has(cat.parent_id)) {
      hiddenIds.add(cat.id);
      continue;
    }
    const hasChildren = parentIds.has(cat.id);
    const isOpen = matchedIds !== null || !collapsedIds.has(cat.id);
    if (hasChildren && !isOpen) hiddenIds.add(cat.id);
    const selected = selectedId === cat.id;
    const isEditing = editing?.id === cat.id;

    rows.push(
      <MenuRow
        key={cat.id}
        style={{ paddingInlineStart: depth * 14 }}
        moreLabel={t("sidebar.moreActions", { name: cat.name })}
        actions={[
          { key: "add", label: t("category.addChild"), icon: <FolderPlus />, onSelect: () => setEditing({ kind: "addChild", id: cat.id }) },
          { key: "edit", label: t("category.edit"), icon: <Pencil />, onSelect: () => setEditing({ kind: "edit", id: cat.id }) },
          { key: "delete", label: t("category.delete"), icon: <Trash2 />, danger: true, separated: true, onSelect: () => requestDelete(cat) },
        ]}
        editor={{
          open: isEditing,
          onOpenChange: (o) => { if (!o) setEditing(null); },
          content: editing?.kind === "addChild" ? (
            <EditorForm
              title={t("category.addChildTitle", { name: cat.name })}
              placeholder={t("category.subnamePlaceholder")}
              initialColor={cat.color}
              initialIcon="folder"
              submitLabel={t("category.add")}
              onSubmit={({ name, color, icon }) => handleCreate(name, color, icon, cat.id)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <CategoryEditForm
              category={cat}
              parentSelect={parentSelect}
              onDone={() => setEditing(null)}
              onSave={async (name, color, icon, parentId) => {
                try {
                  await updateCategory(cat.id, name, color, parentId, icon);
                  await fetchVideos();
                  setEditing(null);
                } catch (e) {
                  toast.error(String(e));
                }
              }}
            />
          ),
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.toggle}
            data-open={isOpen || undefined}
            disabled={matchedIds !== null}
            onClick={() => toggleCollapsed(cat.id)}
            aria-label={isOpen ? t("category.collapse") : t("category.expand")}
            title={isOpen ? t("category.collapse") : t("category.expand")}
          >
            <ChevronRight aria-hidden />
          </button>
        ) : parentIds.size > 0 && (
          // 開閉ボタンのある行と名前の位置をそろえる (ツリーが平らなら空きは要らない)
          <span className={styles.toggleSpacer} data-child={depth > 0 || undefined} />
        )}
        <button
          type="button"
          className={styles.row}
          data-selected={selected || undefined}
          style={tagColorStyle(cat.color)}
          aria-current={selected || undefined}
          // 選択中をもう一度押すと解除
          onClick={() => onSelect(selected ? null : cat.id)}
        >
          <span className={styles.iconBadge}>
            <MediaIcon icon={cat.icon ?? "folder"} className={styles.badgeIcon} />
          </span>
          <span className={styles.rowText}>{cat.name}</span>
        </button>
      </MenuRow>,
    );
  }

  // 検索で 1 件も当たらなければセクションごと出さない
  const hidden = !!search && rows.length === 0;

  return (
    <>
    {!hidden && <SidebarSection
      title={t("category.title")}
      open={open || !!search}
      onOpenChange={onOpenChange}
      active={selectedId !== null && selectedId !== -1}
      action={
        <AddButton label={t("category.add")} open={adding} onOpenChange={setAdding}>
          <EditorForm
            title={t("category.add")}
            placeholder={t("category.namePlaceholder")}
            initialColor={COLORS[5]}
            initialIcon="folder"
            submitLabel={t("category.add")}
            onSubmit={({ name, color, icon }) => handleCreate(name, color, icon, null)}
            onCancel={() => setAdding(false)}
          />
        </AddButton>
      }
    >
      <div className={styles.list}>
        {rows.length > 0 ? rows : <span className={styles.empty}>{t("category.empty")}</span>}
      </div>
    </SidebarSection>}
    {dialog}
    </>
  );
}

/** 既存カテゴリの編集フォーム (親カテゴリの選択つき) */
function CategoryEditForm({ category, parentSelect, onSave, onDone }: {
  category: Category;
  parentSelect: (value: number | null, onChange: (v: number | null) => void, excludeId?: number) => ReactNode;
  onSave: (name: string, color: string, icon: string | null, parentId: number | null) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [parentId, setParentId] = useState<number | null>(category.parent_id);
  return (
    <EditorForm
      title={t("category.editTitle")}
      initialName={category.name}
      initialColor={category.color}
      initialIcon={category.icon ?? "folder"}
      extra={parentSelect(parentId, setParentId, category.id)}
      submitLabel={t("category.save")}
      onSubmit={({ name, color, icon }) => onSave(name, color, icon, parentId)}
      onCancel={onDone}
    />
  );
}
