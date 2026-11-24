import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookmarkPlus, LayoutGrid, List, Shuffle, X } from "lucide-react";
import { Select, Button, SegmentedControl, Input } from "../ui";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useTagStore } from "../../store/useTagStore";
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
    filterMinDuration, filterMaxDuration, totalCount,
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

  return (
    <div className="flex flex-col gap-1.5 mb-3 shrink-0">
      {/* Row 1: 選択中タグ + ソート */}
      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {/* アクティブな非タグフィルターのチップ */}
          {filterMinRating !== 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              {filterMinRating === -1
                ? t('filters.ratingUnrated')
                : `★${filterMinRating}${filterRatingMode === 'lte' ? '-' : filterRatingMode === 'eq' ? '=' : '+'}`}
              <button type="button" onClick={() => setMinRating(0)} aria-label={t('filters.tagClear')} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
            </span>
          )}
          {filterHasAudio !== null && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              {filterHasAudio === 1 ? t('filters.audioYes') : t('filters.audioNo')}
              <button type="button" onClick={() => setHasAudio(null)} aria-label={t('filters.tagClear')} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
            </span>
          )}
          {filterWatchedStatus !== 'all' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              {filterWatchedStatus === 'watched' ? t('filters.watched') : t('filters.unwatched')}
              <button type="button" onClick={() => setWatchedStatus('all')} aria-label={t('filters.tagClear')} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
            </span>
          )}
          {filterMediaType !== 'all' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              {filterMediaType === 'video' ? t('filters.mediaVideo') : filterMediaType === 'audio' ? t('filters.mediaAudio') : t('filters.mediaImage')}
              <button type="button" onClick={() => setMediaType('all')} aria-label={t('filters.tagClear')} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
            </span>
          )}
          {filterAv1 !== 'all' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              {filterAv1 === 'only' ? t('filters.av1Only') : t('filters.av1Exclude')}
              <button type="button" onClick={() => setAv1Filter('all')} aria-label={t('filters.tagClear')} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
            </span>
          )}
          {filterMinDuration > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              {filterMinDuration}{t('filters.durationSuffix')}〜
              <button type="button" onClick={() => setDurationInput('')} aria-label={t('filters.tagClear')} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
            </span>
          )}
          {filterMaxDuration > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              〜{filterMaxDuration}{t('filters.durationSuffix')}
              <button type="button" onClick={() => setMaxDurationInput('')} aria-label={t('filters.tagClear')} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
            </span>
          )}
          {filterTagIds.length > 0 && (
            <>
              {tags
                .filter((tag) => filterTagIds.includes(tag.id))
                .map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="px-1.5 py-px rounded-full text-[10px] font-medium text-white ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-950 hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: tag.color }}
                    onClick={() => toggleTagFilter(tag.id)}
                    title={t("filters.tagClear")}
                  >
                    {tag.name}
                  </button>
                ))}
              {filterTagIds.length >= 2 && (
                <Button
                  variant="secondary"
                  size="xs"
                  title={
                    filterTagMode === "and"
                      ? t("filters.tagFilterAnd")
                      : t("filters.tagFilterOr")
                  }
                  onClick={() =>
                    setTagMode(filterTagMode === "and" ? "or" : "and")
                  }
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

        <div className="flex items-center gap-1 shrink-0">
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
          <Button
            variant="secondary"
            size="icon"
            title={
              filterSortOrder === "desc"
                ? t("filters.sortDescTitle")
                : t("filters.sortAscTitle")
            }
            aria-label={
              filterSortOrder === "desc"
                ? t("filters.sortDescTitle")
                : t("filters.sortAscTitle")
            }
            onClick={() =>
              setSort(filterSortBy, filterSortOrder === "desc" ? "asc" : "desc")
            }
          >
            {filterSortOrder === "desc" ? <ArrowDownWideNarrow aria-hidden /> : <ArrowUpNarrowWide aria-hidden />}
          </Button>
          {totalCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              title={t("app.shuffleAllTitle", {
                count: totalCount.toLocaleString(),
              })}
              onClick={playShuffleAll}
            >
              <Shuffle aria-hidden />
              {t("app.shuffleAll")}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            title={t("app.saveSmartPlaylistTitle")}
            onClick={openSmartPlaylist}
          >
            <BookmarkPlus aria-hidden />
            {t("app.saveSmartPlaylist")}
          </Button>
        </div>
      </div>

      {/* Row 2: 追加フィルタ */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Select
          value={String(filterMinRating)}
          onValueChange={(v) => setMinRating(Number(v))}
          title="評価フィルタ"
          options={[
            { value: "0", label: t("filters.ratingAll") },
            { value: "-1", label: t("filters.ratingUnrated") },
            { value: "1", label: t("filters.rating1") },
            { value: "2", label: t("filters.rating2") },
            { value: "3", label: t("filters.rating3") },
            { value: "4", label: t("filters.rating4") },
            { value: "5", label: t("filters.rating5") },
          ]}
        />

        {filterMinRating > 0 && (
          <Select<RatingMode>
            value={filterRatingMode}
            onValueChange={setRatingMode}
            title="評価の比較方法"
            options={[
              { value: "gte", label: t("filters.ratingModeGte") },
              { value: "lte", label: t("filters.ratingModeLte") },
              { value: "eq", label: t("filters.ratingModeEq") },
            ]}
          />
        )}

        <Select
          value={filterHasAudio === null ? "" : String(filterHasAudio)}
          onValueChange={(v) => setHasAudio(v === "" ? null : Number(v))}
          title="音声フィルタ"
          options={[
            { value: "", label: t("filters.audioAll") },
            { value: "1", label: t("filters.audioYes") },
            { value: "0", label: t("filters.audioNo") },
          ]}
        />

        <Select<WatchedStatus>
          value={filterWatchedStatus}
          onValueChange={setWatchedStatus}
          title="視聴状態フィルタ"
          options={[
            { value: "all", label: t("filters.watchedAll") },
            { value: "unwatched", label: t("filters.unwatched") },
            { value: "watched", label: t("filters.watched") },
          ]}
        />

        <Select<MediaTypeFilter>
          value={filterMediaType}
          onValueChange={setMediaType}
          title="メディアタイプフィルタ"
          options={[
            { value: "all", label: t("filters.mediaAll") },
            { value: "video", label: t("filters.mediaVideo") },
            { value: "audio", label: t("filters.mediaAudio") },
            { value: "image", label: t("filters.mediaImage") },
          ]}
        />

        <Select<Av1Filter>
          value={filterAv1}
          onValueChange={setAv1Filter}
          title="AV1 変換済みフィルタ"
          options={[
            { value: "all", label: t("filters.av1All") },
            { value: "only", label: t("filters.av1Only") },
            { value: "exclude", label: t("filters.av1Exclude") },
          ]}
        />

        <div className="flex items-center gap-1">
          <Input
            size="sm"
            className="w-20"
            type="number"
            value={durationInput}
            onChange={(e) => setDurationInput(e.target.value)}
            placeholder={t("filters.minDurationPlaceholder")}
            min={0}
            title="最小長さ (秒)"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            〜
          </span>
          <Input
            size="sm"
            className="w-20"
            type="number"
            value={maxDurationInput}
            onChange={(e) => setMaxDurationInput(e.target.value)}
            placeholder={t("filters.maxDurationPlaceholder")}
            min={0}
            title="最大長さ (秒)"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {t("filters.durationSuffix")}
          </span>
        </div>

        {/* 表示モード・グリッドサイズ */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
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

          {viewMode === "grid" && (
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
          )}

          {viewMode === "list" && (
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
    </div>
  );
}
