import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { Select } from "../common/Select";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useTagStore } from "../../store/useTagStore";
import { useLibraryViewStore } from "../../store/useLibraryViewStore";
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
                <button
                  type="button"
                  className="px-2 py-0.5 rounded-full text-xs font-semibold border transition-colors border-gray-400 dark:border-gray-500 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
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
                </button>
              )}
              <button
                type="button"
                className="px-2 py-0.5 rounded-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600"
                onClick={clearTagFilters}
              >
                {t("filters.tagClear")}
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Select
            variant="sm"
            value={filterSortBy}
            onChange={(e) =>
              setSort(e.target.value as SortBy, filterSortOrder)
            }
          >
            <option value="created_at">{t("filters.sortByCreatedAt")}</option>
            <option value="duration">{t("filters.sortByDuration")}</option>
            <option value="rating">{t("filters.sortByRating")}</option>
            <option value="file_size">{t("filters.sortByFileSize")}</option>
          </Select>
          <button
            type="button"
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-mono"
            title={
              filterSortOrder === "desc"
                ? t("filters.sortDescTitle")
                : t("filters.sortAscTitle")
            }
            onClick={() =>
              setSort(filterSortBy, filterSortOrder === "desc" ? "asc" : "desc")
            }
          >
            {filterSortOrder === "desc" ? "↓" : "↑"}
          </button>
          {totalCount > 0 && (
            <button
              type="button"
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:text-purple-700 dark:hover:text-purple-300 hover:border-purple-400 dark:hover:border-purple-600 transition-colors"
              title={t("app.shuffleAllTitle", {
                count: totalCount.toLocaleString(),
              })}
              onClick={playShuffleAll}
            >
              {t("app.shuffleAll")}
            </button>
          )}
          <button
            type="button"
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-700 dark:hover:text-amber-300 hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
            title={t("app.saveSmartPlaylistTitle")}
            onClick={openSmartPlaylist}
          >
            {t("app.saveSmartPlaylist")}
          </button>
        </div>
      </div>

      {/* Row 2: 追加フィルタ */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Select
          variant="sm"
          value={filterMinRating}
          onChange={(e) => setMinRating(Number(e.target.value))}
          title="評価フィルタ"
        >
          <option value={0}>{t("filters.ratingAll")}</option>
          <option value={-1}>{t("filters.ratingUnrated")}</option>
          <option value={1}>{t("filters.rating1")}</option>
          <option value={2}>{t("filters.rating2")}</option>
          <option value={3}>{t("filters.rating3")}</option>
          <option value={4}>{t("filters.rating4")}</option>
          <option value={5}>{t("filters.rating5")}</option>
        </Select>

        {filterMinRating > 0 && (
          <Select
            variant="sm"
            value={filterRatingMode}
            onChange={(e) => setRatingMode(e.target.value as RatingMode)}
            title="評価の比較方法"
          >
            <option value="gte">{t("filters.ratingModeGte")}</option>
            <option value="lte">{t("filters.ratingModeLte")}</option>
            <option value="eq">{t("filters.ratingModeEq")}</option>
          </Select>
        )}

        <Select
          variant="sm"
          value={filterHasAudio === null ? "" : String(filterHasAudio)}
          onChange={(e) => {
            const v = e.target.value;
            setHasAudio(v === "" ? null : Number(v));
          }}
          title="音声フィルタ"
        >
          <option value="">{t("filters.audioAll")}</option>
          <option value="1">{t("filters.audioYes")}</option>
          <option value="0">{t("filters.audioNo")}</option>
        </Select>

        <Select
          variant="sm"
          value={filterWatchedStatus}
          onChange={(e) => setWatchedStatus(e.target.value as WatchedStatus)}
          title="視聴状態フィルタ"
        >
          <option value="all">{t("filters.watchedAll")}</option>
          <option value="unwatched">{t("filters.unwatched")}</option>
          <option value="watched">{t("filters.watched")}</option>
        </Select>

        <Select
          variant="sm"
          value={filterMediaType}
          onChange={(e) => setMediaType(e.target.value as MediaTypeFilter)}
          title="メディアタイプフィルタ"
        >
          <option value="all">{t("filters.mediaAll")}</option>
          <option value="video">{t("filters.mediaVideo")}</option>
          <option value="audio">{t("filters.mediaAudio")}</option>
          <option value="image">{t("filters.mediaImage")}</option>
        </Select>

        <Select
          variant="sm"
          value={filterAv1}
          onChange={(e) => setAv1Filter(e.target.value as Av1Filter)}
          title="AV1 変換済みフィルタ"
        >
          <option value="all">{t("filters.av1All")}</option>
          <option value="only">{t("filters.av1Only")}</option>
          <option value="exclude">{t("filters.av1Exclude")}</option>
        </Select>

        <div className="flex items-center gap-1">
          <input
            type="number"
            className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500"
            value={durationInput}
            onChange={(e) => setDurationInput(e.target.value)}
            placeholder={t("filters.minDurationPlaceholder")}
            min={0}
            title="最小長さ (秒)"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            〜
          </span>
          <input
            type="number"
            className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500"
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
          <div className="flex gap-0.5 border border-gray-300 dark:border-gray-600 rounded p-0.5">
            <button
              type="button"
              className={`p-1 rounded transition-colors ${
                viewMode === "grid"
                  ? "bg-blue-500 text-white"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              onClick={() => setViewMode("grid")}
              title="グリッド表示"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5"
              >
                <rect x="1" y="1" width="6" height="6" rx="0.8" />
                <rect x="9" y="1" width="6" height="6" rx="0.8" />
                <rect x="1" y="9" width="6" height="6" rx="0.8" />
                <rect x="9" y="9" width="6" height="6" rx="0.8" />
              </svg>
            </button>
            <button
              type="button"
              className={`p-1 rounded transition-colors ${
                viewMode === "list"
                  ? "bg-blue-500 text-white"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              onClick={() => setViewMode("list")}
              title="リスト表示"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5"
              >
                <rect x="1" y="2" width="14" height="2.5" rx="0.8" />
                <rect x="1" y="6.75" width="14" height="2.5" rx="0.8" />
                <rect x="1" y="11.5" width="14" height="2.5" rx="0.8" />
              </svg>
            </button>
          </div>

          {viewMode === "grid" &&
            (
              [
                { label: "S", value: 120 },
                { label: "M", value: 180 },
                { label: "L", value: 240 },
                { label: "XL", value: 320 },
              ] as const
            ).map(({ label, value }) => (
              <button
                key={value}
                type="button"
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  gridItemMinWidth === value
                    ? "bg-blue-500 text-white"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                onClick={() => setGridItemMinWidth(value)}
                title={`カードサイズ: ${label}`}
              >
                {label}
              </button>
            ))}

          {viewMode === "list" &&
            (["S", "M", "L", "XL"] as const).map((size) => (
              <button
                key={size}
                type="button"
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  listItemSize === size
                    ? "bg-blue-500 text-white"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                onClick={() => setListItemSize(size)}
                title={`行サイズ: ${size}`}
              >
                {size}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
