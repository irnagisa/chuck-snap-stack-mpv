import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, buildCategoryTree, flattenCategoryTree, getCategoryPath, type CategoryNode } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ChevronRight, Search } from "lucide-react";
import { toast } from '../../store/useToastStore';
import { Button, Dialog, Input, RadioGroup, RadioGroupItem, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

interface Props {
  videoIds: number[];
  onClose: () => void;
  onDone: () => void;
}

function findWatchDir(filePath: string, watchDirs: string[]): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const dir of watchDirs) {
    const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.startsWith(d + '/')) return d;
  }
  return null;
}

interface TreeNodeProps {
  node: CategoryNode;
  depth: number;
  collapsedIds: Set<number>;
  onToggleCollapse: (id: number) => void;
}

function TreeNode({ node, depth, collapsedIds, onToggleCollapse }: TreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedIds.has(node.id);

  return (
    <>
      <div className={styles.option} style={{ paddingInlineStart: `${4 + depth * 14}px` }}>
        <button
          type="button"
          className={styles.treeToggle}
          data-open={!isCollapsed || undefined}
          data-hidden={!hasChildren || undefined}
          onClick={() => onToggleCollapse(node.id)}
          tabIndex={-1}
          aria-hidden
        >
          <ChevronRight />
        </button>
        <label className={styles.optionLabel}>
          <RadioGroupItem value={String(node.id)} />
          <span className={styles.dot} style={{ backgroundColor: node.color }} />
          <span className={styles.optionText}>{node.name}</span>
        </label>
      </div>
      {!isCollapsed && node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </>
  );
}

export function BulkCategoryModal({ videoIds, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { categories, setCategoryMultiple } = useTagStore();
  const { fetchVideos, watchDirs, videos, moveVideoFile } = useLibraryStore();
  const { categoryMode } = useSettingsStore();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null | 'unset'>('unset');
  const [search, setSearch] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  // Sync モード: 常に移動 / Virtual モード: 移動しない
  const moveFiles = categoryMode === 'sync';
  const [loading, setLoading] = useState(false);
  const dialog = useDialogClose(onClose, { locked: loading });

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const flatAll = useMemo(() => flattenCategoryTree(tree), [tree]);

  const filteredFlat = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    return flatAll.filter(({ category }) => category.name.toLowerCase().includes(q));
  }, [flatAll, search]);

  const toggleCollapse = (id: number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    if (selectedCategoryId === 'unset') return;
    setLoading(true);
    try {
      await setCategoryMultiple(videoIds, selectedCategoryId);

      if (moveFiles) {
        const catPath = typeof selectedCategoryId === 'number'
          ? getCategoryPath(selectedCategoryId, categories)
          : null;
        let failCount = 0;
        for (const videoId of videoIds) {
          const video = videos.find((v) => v.id === videoId);
          if (!video) continue;
          const watchDir = findWatchDir(video.path, watchDirs);
          if (!watchDir) continue;
          const destDir = catPath ? `${watchDir}/${catPath}` : `${watchDir}/Unsorted`;
          const result = await moveVideoFile(videoId, destDir);
          if (result === null) failCount++;
        }
        if (failCount > 0) {
          toast.error(t('syncMode.moveFilesFailed', { count: failCount }));
        }
      }

      await fetchVideos();
      dialog.close(onDone);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('bulkCategory.title')}
      description={t('bulkCategory.desc', { count: videoIds.length })}
      showClose={false}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={() => dialog.close()}>
            {t('bulkCategory.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={loading || selectedCategoryId === 'unset'}
            onClick={handleApply}
          >
            {loading ? t('bulkCategory.applying') : t('bulkCategory.apply')}
          </Button>
        </>
      }
    >
      <div className={styles.stackTight}>
        {categories.length > 0 && (
          <Input
            size="sm"
            className={styles.fullWidth}
            icon={<Search />}
            placeholder={t('detail.categorySearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
        )}

        <RadioGroup
          className={styles.optionList}
          aria-label={t('bulkCategory.title')}
          value={selectedCategoryId === 'unset' ? '' : selectedCategoryId === null ? 'none' : String(selectedCategoryId)}
          onValueChange={(v) => setSelectedCategoryId(v === 'none' ? null : Number(v))}
        >
          <label className={styles.option} style={{ paddingInlineStart: 'calc(4px + 1.5rem)' }}>
            <RadioGroupItem value="none" />
            <span className={`${styles.optionText} ${styles.optionMuted}`}>{t('bulkCategory.none')}</span>
          </label>

          {filteredFlat ? (
            filteredFlat.length === 0 ? (
              <p className={styles.note}>{t('detail.noCategoryOptions')}</p>
            ) : (
              filteredFlat.map(({ category: cat, depth }) => (
                <label
                  key={cat.id}
                  className={styles.option}
                  style={{ paddingInlineStart: `calc(${4 + depth * 14}px + 1.5rem)` }}
                >
                  <RadioGroupItem value={String(cat.id)} />
                  <span className={styles.dot} style={{ backgroundColor: cat.color }} />
                  <span className={styles.optionText}>{cat.name}</span>
                </label>
              ))
            )
          ) : (
            tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                collapsedIds={collapsedIds}
                onToggleCollapse={toggleCollapse}
              />
            ))
          )}
        </RadioGroup>

        {categories.length === 0 && <p className={styles.note}>{t('bulkCategory.empty')}</p>}

        <p className={styles.note}>
          {categoryMode === 'sync'
            ? t('bulkCategory.syncModeNote')
            : t('bulkCategory.virtualModeNote')}
        </p>
      </div>
    </Dialog>
  );
}
