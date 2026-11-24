import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowLeftRight,
  ChartColumn,
  Copy,
  Download,
  FileQuestionMark,
  FolderPlus,
  House,
  Inbox,
  Layers,
  Library,
  LoaderCircle,
  Search,
  Settings,
} from "lucide-react";
import { useModalStore } from "../store/useModalStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { useShallow } from "zustand/shallow";
import { Button, Checkbox, Input, Tooltip, motionPresets } from "./ui";
import styles from "./AppHeader.module.css";

type MainView = "home" | "library" | "inbox";

interface Props {
  mainView: MainView;
  inboxCount: number;
  searchInput: string;
  useDirAsCategory: boolean;
  onMainViewChange: (view: MainView) => void;
  onSearchChange: (v: string) => void;
  onSearchClear: () => void;
  onPickDir: () => void;
  onUseDirAsCategoryChange: (v: boolean) => void;
}

const NAV_ITEMS: { view: MainView; label: string; icon: ReactNode }[] = [
  { view: "home", label: "ホーム", icon: <House aria-hidden /> },
  { view: "library", label: "ライブラリ", icon: <Library aria-hidden /> },
  { view: "inbox", label: "Inbox", icon: <Inbox aria-hidden /> },
];

export function AppHeader({
  mainView,
  inboxCount,
  searchInput,
  useDirAsCategory,
  onMainViewChange,
  onSearchChange,
  onSearchClear,
  onPickDir,
  onUseDirAsCategoryChange,
}: Props) {
  const { t } = useTranslation();
  const indicatorId = useId();
  const checkboxId = useId();
  const { isDbReady, isScanning, isThumbnailGenerating } = useLibraryStore(
    useShallow((s) => ({
      isDbReady: s.isDbReady,
      isScanning: s.isScanning,
      isThumbnailGenerating: s.isThumbnailGenerating,
    }))
  );
  const {
    openSettings,
    openDownload,
    openStats,
    openExport,
    openDuplicates,
    openMissingFiles,
  } = useModalStore();

  const isBusy = isScanning || isThumbnailGenerating;

  const tools: { label: string; icon: ReactNode; onClick: () => void; needsDb: boolean }[] = [
    { label: t("app.statsTitle"), icon: <ChartColumn />, onClick: openStats, needsDb: true },
    { label: t("app.exportTitle"), icon: <ArrowLeftRight />, onClick: openExport, needsDb: true },
    { label: t("app.duplicatesTitle"), icon: <Copy />, onClick: openDuplicates, needsDb: true },
    { label: t("app.missingTitle"), icon: <FileQuestionMark />, onClick: openMissingFiles, needsDb: true },
    { label: t("app.settingsTitle"), icon: <Settings />, onClick: openSettings, needsDb: false },
  ];

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden>
          <Layers strokeWidth={2.25} />
        </span>
        <h1 className={styles.title}>Chuck Snap Stack</h1>
      </div>

      {/* メインビュー切替 */}
      <nav className={styles.nav} aria-label="メインビュー">
        {NAV_ITEMS.map(({ view, label, icon }) => {
          const active = mainView === view;
          return (
            <button
              key={view}
              type="button"
              className={styles.navItem}
              aria-current={active ? "page" : undefined}
              onClick={() => onMainViewChange(view)}
            >
              {active && (
                <motion.span
                  layoutId={indicatorId}
                  className={styles.navIndicator}
                  transition={motionPresets.transitions.spring}
                />
              )}
              <span className={styles.navLabel}>
                {icon}
                {label}
                {view === "inbox" && inboxCount > 0 && (
                  <span className={styles.badge}>{inboxCount > 999 ? "999+" : inboxCount}</span>
                )}
              </span>
            </button>
          );
        })}
      </nav>

      <Input
        size="md"
        className={styles.search}
        icon={<Search />}
        value={searchInput}
        onChange={(e) => onSearchChange(e.target.value)}
        onClear={onSearchClear}
        placeholder={t("app.searchPlaceholder")}
        disabled={!isDbReady}
      />

      <div className={styles.actions}>
        <Button variant="primary" disabled={!isDbReady || isBusy} onClick={onPickDir}>
          {isBusy ? <LoaderCircle className="animate-spin" aria-hidden /> : <FolderPlus aria-hidden />}
          {isBusy ? t("app.scanning") : t("app.addFolder")}
        </Button>

        <label className={styles.checkLabel} htmlFor={checkboxId} title={t("app.useDirAsCategory")}>
          <Checkbox
            id={checkboxId}
            checked={useDirAsCategory}
            onCheckedChange={(v) => onUseDirAsCategoryChange(v === true)}
          />
          <span className={styles.srOnlyNarrow}>{t("app.useDirAsCategory")}</span>
        </label>

        <Button variant="soft" disabled={!isDbReady} onClick={openDownload}>
          <Download aria-hidden />
          {t("app.downloadUrl")}
        </Button>
      </div>

      <div className={styles.tools}>
        {tools.map(({ label, icon, onClick, needsDb }) => (
          <Tooltip key={label} content={label} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              disabled={needsDb && !isDbReady}
              onClick={onClick}
            >
              {icon}
            </Button>
          </Tooltip>
        ))}
      </div>
    </header>
  );
}
