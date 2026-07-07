import { useTranslation } from "react-i18next";
import { Select } from "../common/Select";
import type { Tag } from "../../types";
import type {
  WatchedStatus,
  MediaTypeFilter,
  SortBy,
  SortOrder,
} from "../../store/useLibraryStore";

interface Props {
  tags: Tag[];
  filterTagIds: number[];
  filterTagMode: "and" | "or";
  filterSortBy: SortBy;
  filterSortOrder: SortOrder;
  filterMinRating: number;
  filterHasAudio: number | null;
  filterWatchedStatus: WatchedStatus;
  filterMediaType: MediaTypeFilter;
  filterMinDuration: number;
  filterMaxDuration: number;
  durationInput: string;
  maxDurationInput: string;
  totalCount: number;
  viewMode: "grid" | "list";
  gridItemMinWidth: number;
  listItemSize: "S" | "M" | "L" | "XL";
  onToggleTag: (id: number) => void;
  onClearTags: () => void;
  onSetTagMode: (mode: "and" | "or") => void;
  onSetSort: (by: SortBy, order: SortOrder) => void;
  onSetMinRating: (v: number) => void;
  onSetHasAudio: (v: number | null) => void;
  onSetWatchedStatus: (v: WatchedStatus) => void;
  onSetMediaType: (v: MediaTypeFilter) => void;
  onDurationInputChange: (v: string) => void;
  onMaxDurationInputChange: (v: string) => void;
  onShuffleAll: () => void;
  onSaveSmartPlaylist: () => void;
  onSetViewMode: (mode: "grid" | "list") => void;
  onSetGridItemMinWidth: (v: number) => void;
  onSetListItemSize: (v: "S" | "M" | "L" | "XL") => void;
}

export function LibraryFilterBar({
  tags,
  filterTagIds,
  filterTagMode,
  filterSortBy,
  filterSortOrder,
  filterMinRating,
  filterHasAudio,
  filterWatchedStatus,
  filterMediaType,
  durationInput,
  maxDurationInput,
  totalCount,
  viewMode,
  gridItemMinWidth,
  listItemSize,
  onToggleTag,
  onClearTags,
  onSetTagMode,
  onSetSort,
  onSetMinRating,
  onSetHasAudio,
  onSetWatchedStatus,
  onSetMediaType,
  onDurationInputChange,
  onMaxDurationInputChange,
  onShuffleAll,
  onSaveSmartPlaylist,
  onSetViewMode,
  onSetGridItemMinWidth,
  onSetListItemSize,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1.5 mb-3 shrink-0">
      {/* Row 1: タグ + ソート */}
      <div className="flex items-start gap-2">
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {tags.length > 0 && (
            <>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className={`px-1.5 py-px rounded-full text-[10px] font-medium text-white transition-opacity ${
                    filterTagIds.includes(tag.id)
                      ? "opacity-100 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-950"
                      : "opacity-40 hover:opacity-70"
                  }`}
                  style={{ backgroundColor: tag.color }}
                  onClick={() => onToggleTag(tag.id)}
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
                    onSetTagMode(filterTagMode === "and" ? "or" : "and")
                  }
                >
                  {filterTagMode === "and" ? "AND" : "OR"}
                </button>
              )}
              {filterTagIds.length > 0 && (
                <button
                  type="button"
                  className="px-2 py-0.5 rounded-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600"
                  onClick={onClearTags}
                >
                  {t("filters.tagClear")}
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Select
            variant="sm"
            value={filterSortBy}
            onChange={(e) =>
              onSetSort(e.target.value as SortBy, filterSortOrder)
            }
          >
            <option value="created_at">{t("filters.sortByCreatedAt")}</option>
            <option value="duration">{t("filters.sortByDuration")}</option>
            <option value="rating">{t("filters.sortByRating")}</option>
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
              onSetSort(filterSortBy, filterSortOrder === "desc" ? "asc" : "desc")
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
              onClick={onShuffleAll}
            >
              {t("app.shuffleAll")}
            </button>
          )}
          <button
            type="button"
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-700 dark:hover:text-amber-300 hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
            title={t("app.saveSmartPlaylistTitle")}
            onClick={onSaveSmartPlaylist}
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
          onChange={(e) => onSetMinRating(Number(e.target.value))}
          title="評価フィルタ"
        >
          <option value={0}>{t("filters.ratingAll")}</option>
          <option value={-1}>{t("filters.ratingUnrated")}</option>
          <option value={1}>{t("filters.ratingAbove1")}</option>
          <option value={2}>{t("filters.ratingAbove2")}</option>
          <option value={3}>{t("filters.ratingAbove3")}</option>
          <option value={4}>{t("filters.ratingAbove4")}</option>
          <option value={5}>{t("filters.ratingOnly5")}</option>
        </Select>

        <Select
          variant="sm"
          value={filterHasAudio === null ? "" : String(filterHasAudio)}
          onChange={(e) => {
            const v = e.target.value;
            onSetHasAudio(v === "" ? null : Number(v));
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
          onChange={(e) => onSetWatchedStatus(e.target.value as WatchedStatus)}
          title="視聴状態フィルタ"
        >
          <option value="all">{t("filters.watchedAll")}</option>
          <option value="unwatched">{t("filters.unwatched")}</option>
          <option value="watched">{t("filters.watched")}</option>
        </Select>

        <Select
          variant="sm"
          value={filterMediaType}
          onChange={(e) => onSetMediaType(e.target.value as MediaTypeFilter)}
          title="メディアタイプフィルタ"
        >
          <option value="all">{t("filters.mediaAll")}</option>
          <option value="video">{t("filters.mediaVideo")}</option>
          <option value="audio">{t("filters.mediaAudio")}</option>
          <option value="image">{t("filters.mediaImage")}</option>
        </Select>

        <div className="flex items-center gap-1">
          <input
            type="number"
            className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500"
            value={durationInput}
            onChange={(e) => onDurationInputChange(e.target.value)}
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
            onChange={(e) => onMaxDurationInputChange(e.target.value)}
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
              onClick={() => onSetViewMode("grid")}
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
              onClick={() => onSetViewMode("list")}
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
                onClick={() => onSetGridItemMinWidth(value)}
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
                onClick={() => onSetListItemSize(size)}
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
