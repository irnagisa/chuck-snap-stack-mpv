import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookmarkPlus, Film, Image as ImageIcon, Layers, LayoutGrid, List, Music, RotateCcw, Shuffle, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { Select, Button, SegmentedControl, Input, Popover, Tooltip } from "../ui";
import styles from "./LibraryFilterBar.module.css";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useTagStore } from "../../store/useTagStore";
import { TagBadge } from "./TagBadge";
import { useLibraryViewStore, type ListItemSize, type ViewMode } from "../../store/useLibraryViewStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useModalStore } from "../../store/useModalStore";
import type {
  WatchedStatus,
  MediaTypeFilter,
  Av1Filter,
  SortBy,
  RatingMode,
} from "../../store/useLibraryStore";

export function LibraryFilterBar() {
  const { t } = useTranslation();

  const {
    filterTagIds, filterTagMode, filterSortBy, filterSortOrder,
    filterMinRating, filterRatingMode, filterHasAudio, filterWatchedStatus, filterMediaType, filterAv1,
    filterMinDuration, filterMaxDuration, totalCount, filterCollapseGroups, setCollapseGroups,
    filterNewOnly, setNewOnly,
    toggleTagFilter, clearTagFilters, setTagMode, setSort,
    setMinRating, setRatingMode, setHasAudio, setWatchedStatus, setMediaType, setAv1Filter,
    setMinDuration, setMaxDuration,
  } = useLibraryStore(useShallow((s) => ({
    filterTagIds: s.filterTagIds,
    filterTagMode: s.filterTagMode,
    filterSortBy: s.filterSortBy,
    filterSortOrder: s.filterSortOrder,
    filterMinRating: s.filterMinRating,
    filterRatingMode: s.filterRatingMode,
    filterHasAudio: s.filterHasAudio,
    filterWatchedStatus: s.filterWatchedStatus,
    filterMediaType: s.filterMediaType,
    filterAv1: s.filterAv1,
    filterMinDuration: s.filterMinDuration,
    filterMaxDuration: s.filterMaxDuration,
    totalCount: s.totalCount,
    filterCollapseGroups: s.filterCollapseGroups,
    filterNewOnly: s.filterNewOnly,
    setNewOnly: s.setNewOnly,
    setCollapseGroups: s.setCollapseGroups,
    toggleTagFilter: s.toggleTagFilter,
    clearTagFilters: s.clearTagFilters,
    setTagMode: s.setTagMode,
    setSort: s.setSort,
    setMinRating: s.setMinRating,
    setRatingMode: s.setRatingMode,
    setHasAudio: s.setHasAudio,
    setWatchedStatus: s.setWatchedStatus,
    setMediaType: s.setMediaType,
    setAv1Filter: s.setAv1Filter,
    setMinDuration: s.setMinDuration,
    setMaxDuration: s.setMaxDuration,
  })));

  const tags = useTagStore((s) => s.tags);

  const { viewMode, gridItemMinWidth, listItemSize, setViewMode, setGridItemMinWidth, setListItemSize } =
    useLibraryViewStore(useShallow((s) => ({
      viewMode: s.viewMode,
      gridItemMinWidth: s.gridItemMinWidth,
      listItemSize: s.listItemSize,
      setViewMode: s.setViewMode,
      setGridItemMinWidth: s.setGridItemMinWidth,
      setListItemSize: s.setListItemSize,
    })));

  const playShuffleAll = usePlayerStore((s) => s.playShuffleAll);
  const openSmartPlaylist = useModalStore((s) => s.openSmartPlaylist);

  // Duration フィルターのデバウンス用ローカル state
  const [durationInput, setDurationInput] = useState(
    filterMinDuration > 0 ? String(filterMinDuration) : ""
  );
  const [maxDurationInput, setMaxDurationInput] = useState(
    filterMaxDuration > 0 ? String(filterMaxDuration) : ""
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      const s = parseInt(durationInput, 10);
      setMinDuration(isNaN(s) || s <= 0 ? 0 : s);
    }, 500);
    return () => clearTimeout(timer);
  }, [durationInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const s = parseInt(maxDurationInput, 10);
      setMaxDuration(isNaN(s) || s <= 0 ? 0 : s);
    }, 500);
    return () => clearTimeout(timer);
  }, [maxDurationInput]);

  // 詳細フィルター (ポップオーバー内) のうち、既定値から変わっているものの数
  const activeFilterCount = [
    filterMinRating !== 0,
    filterHasAudio !== null,
    filterWatchedStatus !== "all",
    filterMediaType !== "all",
    filterAv1 !== "all",
    filterMinDuration > 0,
    filterMaxDuration > 0,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setMinRating(0);
    setRatingMode("gte");
    setHasAudio(null);
    setWatchedStatus("all");
    setMediaType("all");
    setAv1Filter("all");
    setDurationInput("");
    setMaxDurationInput("");
  };

  const ratingLabel =
    filterMinRating === -1
      ? t("filters.ratingUnrated")
      : `★${filterMinRating}${filterRatingMode === "lte" ? "-" : filterRatingMode === "eq" ? "=" : "+"}`;

  const sortOrderTitle = filterSortOrder === "desc" ? t("filters.sortDescTitle") : t("filters.sortAscTitle");

  return (
    // 幅が足りないときは右側のグループごと次の行へ回り込む (縮めて潰さない)
    <div className={styles.bar}>
      {/* 左: 絞り込みボタン + 適用中の条件 (チップは折り返して並ぶ) */}
      <div className={styles.filters}>
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant={activeFilterCount > 0 ? "soft" : "secondary"} title={t("filters.title")}>
              <SlidersHorizontal aria-hidden />
              {t("filters.title")}
              {activeFilterCount > 0 && (
                <span className={styles.count}>
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </Popover.Trigger>
          <Popover.Content align="start" className={styles.popover}>
            <div className={styles.popoverHead}>
              <h3 className={styles.popoverTitle}>{t("filters.title")}</h3>
              <Button variant="ghost" size="xs" disabled={activeFilterCount === 0} onClick={resetFilters}>
                <RotateCcw aria-hidden />
                {t("filters.reset")}
              </Button>
            </div>

            <div className={styles.fields}>
              <FilterField label={t("filters.rating")}>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  aria-label="評価フィルタ"
                  value={String(filterMinRating)}
                  onValueChange={(v) => setMinRating(Number(v))}
                  options={[
                    { value: "0", label: t("filters.all") },
                    { value: "-1", label: t("filters.unrated") },
                    ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `★${n}` })),
                  ]}
                />
                {filterMinRating > 0 && (
                  <SegmentedControl<RatingMode>
                    size="xs"
                    className={styles.ratingMode}
                    aria-label="評価の比較方法"
                    value={filterRatingMode}
                    onValueChange={setRatingMode}
                    options={[
                      { value: "gte", label: t("filters.ratingModeGte") },
                      { value: "lte", label: t("filters.ratingModeLte") },
                      { value: "eq", label: t("filters.ratingModeEq") },
                    ]}
                  />
                )}
              </FilterField>

              <FilterField label={t("filters.watchedStatus")}>
                <SegmentedControl<WatchedStatus>
                  size="xs"
                  fullWidth
                  aria-label="視聴状態フィルタ"
                  value={filterWatchedStatus}
                  onValueChange={setWatchedStatus}
                  options={[
                    { value: "all", label: t("filters.all") },
                    { value: "unwatched", label: t("filters.unwatched") },
                    { value: "watched", label: t("filters.watched") },
                  ]}
                />
              </FilterField>

              <FilterField label={t("filters.mediaType")}>
                <SegmentedControl<MediaTypeFilter>
                  size="xs"
                  fullWidth
                  aria-label="メディアタイプフィルタ"
                  value={filterMediaType}
                  onValueChange={setMediaType}
                  options={[
                    { value: "all", label: t("filters.all") },
                    { value: "video", label: <><Film aria-hidden />{t("filters.mediaVideo")}</> },
                    { value: "audio", label: <><Music aria-hidden />{t("filters.mediaAudio")}</> },
                    { value: "image", label: <><ImageIcon aria-hidden />{t("filters.mediaImage")}</> },
                  ]}
                />
              </FilterField>

              <div className={styles.fieldPair}>
                <FilterField label={t("filters.audio")}>
                  <SegmentedControl
                    size="xs"
                    fullWidth
                    aria-label="音声フィルタ"
                    value={filterHasAudio === null ? "all" : String(filterHasAudio)}
                    onValueChange={(v) => setHasAudio(v === "all" ? null : Number(v))}
                    options={[
                      { value: "all", label: t("filters.all") },
                      { value: "1", label: t("filters.audioYesShort") },
                      { value: "0", label: t("filters.audioNoShort") },
                      // 2: 無音の音声トラックがある (整理画面で調べたものだけ。db_videos.rs の FILTER_SILENT_AUDIO)
                      { value: "2", label: t("filters.audioSilentShort"), title: t("filters.audioSilentNote") },
                    ]}
                  />
                </FilterField>

                <FilterField label={t("filters.av1")}>
                  <SegmentedControl<Av1Filter>
                    size="xs"
                    fullWidth
                    aria-label="AV1 変換済みフィルタ"
                    value={filterAv1}
                    onValueChange={setAv1Filter}
                    options={[
                      { value: "all", label: t("filters.all") },
                      { value: "only", label: t("filters.av1OnlyShort") },
                      { value: "exclude", label: t("filters.av1ExcludeShort") },
                    ]}
                  />
                </FilterField>
              </div>

              <FilterField label={t("filters.duration")}>
                <div className={styles.range}>
                  <Input
                    size="sm"
                    className={styles.rangeInput}
                    type="number"
                    value={durationInput}
                    onChange={(e) => setDurationInput(e.target.value)}
                    placeholder={t("filters.minDurationPlaceholder")}
                    min={0}
                    title="最小長さ (秒)"
                  />
                  <span className={styles.rangeText}>〜</span>
                  <Input
                    size="sm"
                    className={styles.rangeInput}
                    type="number"
                    value={maxDurationInput}
                    onChange={(e) => setMaxDurationInput(e.target.value)}
                    placeholder={t("filters.maxDurationPlaceholder")}
                    min={0}
                    title="最大長さ (秒)"
                  />
                  <span className={styles.rangeText}>
                    {t("filters.durationSuffix")}
                  </span>
                </div>
              </FilterField>
            </div>
          </Popover.Content>
        </Popover.Root>

        <Tooltip content={t("filters.newOnlyTitle")} side="bottom">
          <Button
            variant={filterNewOnly ? "soft" : "ghost"}
            aria-pressed={filterNewOnly}
            onClick={() => setNewOnly(!filterNewOnly)}
          >
            <Sparkles aria-hidden />
            {t("filters.newOnly")}
          </Button>
        </Tooltip>

        {/* 適用中の条件 */}
        {filterMinRating !== 0 && (
          <FilterChip label={ratingLabel} clearLabel={t("filters.tagClear")} onClear={() => setMinRating(0)} />
        )}
        {filterHasAudio !== null && (
          <FilterChip
            label={
              filterHasAudio === 2
                ? t("filters.audioSilent")
                : filterHasAudio === 1
                  ? t("filters.audioYes")
                  : t("filters.audioNo")
            }
            clearLabel={t("filters.tagClear")}
            onClear={() => setHasAudio(null)}
          />
        )}
        {filterWatchedStatus !== "all" && (
          <FilterChip
            label={filterWatchedStatus === "watched" ? t("filters.watched") : t("filters.unwatched")}
            clearLabel={t("filters.tagClear")}
            onClear={() => setWatchedStatus("all")}
          />
        )}
        {filterMediaType !== "all" && (
          <FilterChip
            label={
              filterMediaType === "video"
                ? t("filters.mediaVideo")
                : filterMediaType === "audio"
                ? t("filters.mediaAudio")
                : t("filters.mediaImage")
            }
            clearLabel={t("filters.tagClear")}
            onClear={() => setMediaType("all")}
          />
        )}
        {filterAv1 !== "all" && (
          <FilterChip
            label={filterAv1 === "only" ? t("filters.av1Only") : t("filters.av1Exclude")}
            clearLabel={t("filters.tagClear")}
            onClear={() => setAv1Filter("all")}
          />
        )}
        {filterMinDuration > 0 && (
          <FilterChip
            label={`${filterMinDuration}${t("filters.durationSuffix")}〜`}
            clearLabel={t("filters.tagClear")}
            onClear={() => setDurationInput("")}
          />
        )}
        {filterMaxDuration > 0 && (
          <FilterChip
            label={`〜${filterMaxDuration}${t("filters.durationSuffix")}`}
            clearLabel={t("filters.tagClear")}
            onClear={() => setMaxDurationInput("")}
          />
        )}

        {filterTagIds.length > 0 && (
          <>
            {tags
              .filter((tag) => filterTagIds.includes(tag.id))
              .map((tag) => (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  showIcon
                  onRemove={() => toggleTagFilter(tag.id)}
                  removeLabel={`${tag.name} を${t("filters.tagClear")}`}
                />
              ))}
            {filterTagIds.length >= 2 && (
              <Button
                variant="secondary"
                size="xs"
                title={filterTagMode === "and" ? t("filters.tagFilterAnd") : t("filters.tagFilterOr")}
                onClick={() => setTagMode(filterTagMode === "and" ? "or" : "and")}
              >
                {filterTagMode === "and" ? "AND" : "OR"}
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={clearTagFilters}>
              <X aria-hidden />
              {t("filters.tagClear")}
            </Button>
          </>
        )}
      </div>

      {/* 右: 並び替え・再生・表示 */}
      <div className={styles.tools}>
        <Select<SortBy>
          value={filterSortBy}
          onValueChange={(v) => setSort(v, filterSortOrder)}
          title={t("filters.sortBy")}
          options={[
            { value: "created_at", label: t("filters.sortByCreatedAt") },
            { value: "duration", label: t("filters.sortByDuration") },
            { value: "rating", label: t("filters.sortByRating") },
            { value: "file_size", label: t("filters.sortByFileSize") },
          ]}
        />
        <Tooltip content={sortOrderTitle} side="bottom">
          <Button
            variant="secondary"
            size="icon"
            title={sortOrderTitle}
            aria-label={sortOrderTitle}
            onClick={() => setSort(filterSortBy, filterSortOrder === "desc" ? "asc" : "desc")}
          >
            {filterSortOrder === "desc" ? <ArrowDownWideNarrow aria-hidden /> : <ArrowUpNarrowWide aria-hidden />}
          </Button>
        </Tooltip>

        <span className={styles.divider} aria-hidden />

        <Tooltip
          content={filterCollapseGroups ? t("groups.collapseOnTitle") : t("groups.collapseOffTitle")}
          side="bottom"
        >
          <Button
            variant={filterCollapseGroups ? "soft" : "ghost"}
            size="icon"
            aria-label={t("groups.collapse")}
            aria-pressed={filterCollapseGroups}
            onClick={() => setCollapseGroups(!filterCollapseGroups)}
          >
            <Layers aria-hidden />
          </Button>
        </Tooltip>
        {totalCount > 0 && (
          <Tooltip content={t("app.shuffleAllTitle", { count: totalCount.toLocaleString() })} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("app.shuffleAll")}
              onClick={playShuffleAll}
            >
              <Shuffle aria-hidden />
            </Button>
          </Tooltip>
        )}
        <Tooltip content={t("app.saveSmartPlaylistTitle")} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("app.saveSmartPlaylist")}
            onClick={openSmartPlaylist}
          >
            <BookmarkPlus aria-hidden />
          </Button>
        </Tooltip>

        <span className={styles.divider} aria-hidden />

        <SegmentedControl<ViewMode>
          size="xs"
          aria-label="表示モード"
          value={viewMode}
          onValueChange={setViewMode}
          options={[
            { value: "grid", label: <LayoutGrid aria-hidden />, "aria-label": "グリッド表示", title: "グリッド表示", iconOnly: true },
            { value: "list", label: <List aria-hidden />, "aria-label": "リスト表示", title: "リスト表示", iconOnly: true },
          ]}
        />
        {viewMode === "grid" ? (
          <SegmentedControl
            size="xs"
            aria-label="カードサイズ"
            value={String(gridItemMinWidth)}
            onValueChange={(v) => setGridItemMinWidth(Number(v))}
            options={(
              [
                { label: "S", value: 120 },
                { label: "M", value: 180 },
                { label: "L", value: 240 },
                { label: "XL", value: 320 },
              ] as const
            ).map(({ label, value }) => ({ value: String(value), label, title: `カードサイズ: ${label}` }))}
          />
        ) : (
          <SegmentedControl<ListItemSize>
            size="xs"
            aria-label="行サイズ"
            value={listItemSize}
            onValueChange={setListItemSize}
            options={(["S", "M", "L", "XL"] as const).map((size) => ({ value: size, label: size, title: `行サイズ: ${size}` }))}
          />
        )}
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

/** 適用中の条件を表すチップ (× で解除) */
function FilterChip({ label, clearLabel, onClear }: { label: string; clearLabel: string; onClear: () => void }) {
  return (
    <span className={styles.chip}>
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`${label} を${clearLabel}`}
        className={styles.chipClear}
      >
        <X aria-hidden />
      </button>
    </span>
  );
}
