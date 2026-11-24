import { useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { useTagStore } from "../../../store/useTagStore";
import { toast } from "../../../store/useToastStore";
import { Button, Select } from "../../ui";
import { MediaIcon } from "../../../lib/mediaIcons";
import { tagColorStyle } from "../TagBadge";
import type { Tag, TagCategory } from "../../../types";
import { AddButton, EditorField, EditorForm, MenuRow, SidebarSection, useConfirm } from "./parts";
import styles from "./Sidebar.module.css";

interface Props {
  search: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: number[];
  onToggle: (id: number) => void;
}

type Editing = { kind: "tag" | "group"; id: number } | null;

export function TagSection({ search, open, onOpenChange, selectedIds, onToggle }: Props) {
  const { t } = useTranslation();
  const tags = useTagStore((s) => s.tags);
  const tagCategories = useTagStore((s) => s.tagCategories);
  const updateTag = useTagStore((s) => s.updateTag);
  const deleteTag = useTagStore((s) => s.deleteTag);
  const createTagCategory = useTagStore((s) => s.createTagCategory);
  const updateTagCategory = useTagStore((s) => s.updateTagCategory);
  const deleteTagCategory = useTagStore((s) => s.deleteTagCategory);
  const { confirm, dialog } = useConfirm();

  const [editing, setEditing] = useState<Editing>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  /** 編集モード: チップを押すと絞り込みではなく編集になり、× で削除できる */
  const [editMode, setEditMode] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<number>>(new Set());

  // グループごとに分け、検索中はグループ名かタグ名が一致したものだけ残す
  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const list: { group: TagCategory | null; tags: Tag[] }[] = [
      ...tagCategories.map((tc) => ({ group: tc, tags: tags.filter((tag) => tag.tag_category_id === tc.id) })),
      { group: null, tags: tags.filter((tag) => tag.tag_category_id === null) },
    ];
    if (!q) return list.filter((g) => g.group !== null || g.tags.length > 0);
    return list
      .map((g) => (g.group?.name.toLowerCase().includes(q) ? g : { ...g, tags: g.tags.filter((tag) => tag.name.toLowerCase().includes(q)) }))
      .filter((g) => g.tags.length > 0);
  }, [search, tags, tagCategories]);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setEditing(null);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const requestDeleteTag = (tag: Tag) => confirm({
    title: t("category.deleteTagConfirmTitle", { name: tag.name }),
    description: t("category.deleteTagConfirmDescription"),
    confirmLabel: t("category.delete"),
    onConfirm: () => run(() => deleteTag(tag.id)),
  });

  /** チップのキー操作: F2 で編集、Delete / Backspace で削除 (Enter / Space はクリックと同じ) */
  const handleChipKeyDown = (tag: Tag) => (e: KeyboardEvent) => {
    if (e.key === "F2") {
      e.preventDefault();
      setEditing({ kind: "tag", id: tag.id });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      requestDeleteTag(tag);
    }
  };

  const renderChip = (tag: Tag) => {
    const selected = selectedIds.includes(tag.id);
    const content = (
      <>
        <MediaIcon icon={tag.icon ?? "tag"} />
        <span className={styles.chipText}>{tag.name}</span>
      </>
    );
    return (
      <MenuRow
        key={tag.id}
        className={styles.chipWrap}
        contextOnly
        moreLabel={t("sidebar.moreActions", { name: tag.name })}
        actions={[
          { key: "edit", label: t("category.edit"), icon: <Pencil />, shortcut: "F2", onSelect: () => setEditing({ kind: "tag", id: tag.id }) },
          { key: "delete", label: t("category.delete"), icon: <Trash2 />, danger: true, separated: true, onSelect: () => requestDeleteTag(tag) },
        ]}
        editor={{
          open: editing?.kind === "tag" && editing.id === tag.id,
          onOpenChange: (o) => { if (!o) setEditing(null); },
          content: (
            <TagEditForm
              tag={tag}
              groups={tagCategories}
              onCancel={() => setEditing(null)}
              onSave={(name, color, icon, groupId) => run(() => updateTag(tag.id, name, color, groupId, icon))}
            />
          ),
        }}
      >
        {editMode ? (
          // 編集モード: 本体を押すと編集、× で削除 (どちらもボタンの見た目ではないクリック要素)
          <span className={styles.chip} data-editing="" style={tagColorStyle(tag.color)}>
            <button
              type="button"
              className={styles.chipMain}
              data-focus-return=""
              aria-label={t("category.editNamed", { name: tag.name })}
              onClick={() => setEditing({ kind: "tag", id: tag.id })}
              onKeyDown={handleChipKeyDown(tag)}
            >
              {content}
            </button>
            <button
              type="button"
              className={styles.chipRemove}
              aria-label={t("category.deleteNamed", { name: tag.name })}
              title={t("category.deleteNamed", { name: tag.name })}
              onClick={() => requestDeleteTag(tag)}
            >
              <X aria-hidden />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={styles.chip}
            data-selected={selected || undefined}
            data-focus-return=""
            style={tagColorStyle(tag.color)}
            aria-pressed={selected}
            title={t("sidebar.tagHint")}
            onClick={() => onToggle(tag.id)}
            onKeyDown={handleChipKeyDown(tag)}
          >
            {content}
          </button>
        )}
      </MenuRow>
    );
  };

  const hidden = (!!search && groups.length === 0) || (tags.length === 0 && tagCategories.length === 0 && !addingGroup);
  const hasGroups = tagCategories.length > 0;

  return (
    <>
      {!hidden && (
        <SidebarSection
          title={t("category.tagsTitle")}
          open={open || !!search}
          onOpenChange={onOpenChange}
          active={selectedIds.length > 0}
          action={
            <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={editMode}
              aria-label={editMode ? t("category.finishEditingTags") : t("category.editTags")}
              title={editMode ? t("category.finishEditingTags") : t("category.editTags")}
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? <Check aria-hidden /> : <Pencil aria-hidden />}
            </Button>
            <AddButton label={t("category.addGroupLong")} open={addingGroup} onOpenChange={setAddingGroup}>
              <EditorForm
                title={t("category.addGroupLong")}
                placeholder={t("category.groupNamePlaceholder")}
                submitLabel={t("category.add")}
                onSubmit={async ({ name }) => {
                  try {
                    await createTagCategory(name);
                    setAddingGroup(false);
                  } catch (e) {
                    toast.error(String(e));
                  }
                }}
                onCancel={() => setAddingGroup(false)}
              />
            </AddButton>
            </>
          }
        >
          {editMode && <p className={styles.editHint}>{t("category.editTagsHint")}</p>}
          {groups.map(({ group, tags: groupTags }) => {
            // グループが 1 つも無ければ見出しは出さず、チップだけ並べる
            if (!group) {
              return (
                <div key="ungrouped" className={styles.tagGroup} data-grouped={hasGroups || undefined}>
                  {hasGroups && (
                    <div className={styles.groupHead}>
                      <span className={styles.groupToggle} data-static="">
                        <span className={styles.groupName}>{t("category.others")}</span>
                        <span className={styles.groupCount}>{groupTags.length}</span>
                      </span>
                    </div>
                  )}
                  {/* グループがあるときは「その他」も他のグループと同じ位置まで字下げする */}
                  <div className={hasGroups ? styles.groupBody : undefined}>
                    <div className={styles.chips}>{groupTags.map(renderChip)}</div>
                  </div>
                </div>
              );
            }
            const groupOpen = !!search || !collapsedGroupIds.has(group.id);
            return (
              <div key={group.id} className={styles.tagGroup} data-grouped="">
                <MenuRow
                  className={styles.groupHead}
                  // グループの「…」は編集モードの間だけ出す (右クリックはいつでも使える)
                  contextOnly={!editMode}
                  moreLabel={t("sidebar.moreActions", { name: group.name })}
                  actions={[
                    { key: "edit", label: t("category.editGroup"), icon: <Pencil />, onSelect: () => setEditing({ kind: "group", id: group.id }) },
                    {
                      key: "delete", label: t("category.deleteGroup"), icon: <Trash2 />, danger: true, separated: true,
                      onSelect: () => confirm({
                        title: t("category.deleteGroupConfirmTitle", { name: group.name }),
                        description: t("category.deleteGroupConfirmDescription"),
                        confirmLabel: t("category.delete"),
                        onConfirm: () => run(() => deleteTagCategory(group.id)),
                      }),
                    },
                  ]}
                  editor={{
                    open: editing?.kind === "group" && editing.id === group.id,
                    onOpenChange: (o) => { if (!o) setEditing(null); },
                    content: (
                      <EditorForm
                        title={t("category.editGroup")}
                        initialName={group.name}
                        placeholder={t("category.groupNamePlaceholder")}
                        submitLabel={t("category.save")}
                        onSubmit={({ name }) => run(() => updateTagCategory(group.id, name))}
                        onCancel={() => setEditing(null)}
                      />
                    ),
                  }}
                >
                  <button
                    type="button"
                    className={styles.groupToggle}
                    data-open={groupOpen || undefined}
                    aria-expanded={groupOpen}
                    disabled={!!search}
                    onClick={() => setCollapsedGroupIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                      return next;
                    })}
                  >
                    <ChevronRight aria-hidden />
                    <span className={styles.groupName}>{group.name}</span>
                    <span className={styles.groupCount}>{groupTags.length}</span>
                  </button>
                </MenuRow>
                {groupOpen && (
                  <div className={styles.groupBody}>
                    {groupTags.length === 0
                      ? <span className={styles.empty}>{t("category.noTags")}</span>
                      : <div className={styles.chips}>{groupTags.map(renderChip)}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </SidebarSection>
      )}
      {dialog}
    </>
  );
}

/** タグの編集フォーム (グループの選択つき) */
function TagEditForm({ tag, groups, onSave, onCancel }: {
  tag: Tag;
  groups: TagCategory[];
  onSave: (name: string, color: string, icon: string | null, groupId: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = useState<number | null>(tag.tag_category_id);
  return (
    <EditorForm
      title={t("category.editTagTitle")}
      initialName={tag.name}
      initialColor={tag.color}
      initialIcon={tag.icon ?? "tag"}
      extra={
        <EditorField label={t("category.group")}>
          <Select
            fullWidth
            aria-label={t("category.group")}
            value={groupId == null ? "" : String(groupId)}
            onValueChange={(v) => setGroupId(v === "" ? null : Number(v))}
            options={[
              { value: "", label: t("category.none") },
              ...groups.map((g) => ({ value: String(g.id), label: g.name })),
            ]}
          />
        </EditorField>
      }
      submitLabel={t("category.save")}
      onSubmit={({ name, color, icon }) => onSave(name, color, icon, groupId)}
      onCancel={onCancel}
    />
  );
}
