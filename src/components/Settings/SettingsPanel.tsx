import { useState, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  useSettingsStore, type AppSettings, type KeyAction, type Theme, type CategoryMode,
  type AiModelType, KEY_ACTION_KEYS, DEFAULT_KEYBINDINGS,
} from "../../store/useSettingsStore";
import { useLibraryStore } from "../../store/useLibraryStore";
import { LANGUAGE_LABELS, type Language } from "../../i18n";
import { CategoryMigrationModal } from "../Library/CategoryMigrationModal";
import { FolderPlus, Keyboard, Moon, RotateCw, Sun, SunMoon, X } from "lucide-react";
import { Button, ConfirmDialog, Dialog, Input, RadioGroup, RadioGroupItem, SegmentedControl, Switch, useDialogClose } from "../ui";
import styles from "./SettingsPanel.module.css";

interface Props {
  onClose: () => void;
}

function formatKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'Escape') return 'Esc';
  return key;
}

/** 見出し付きのまとまり */
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** 左に名前と説明、右に操作 (スイッチなど) を置く行 */
function SettingRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingText}>
        <p className={styles.settingTitle}>{title}</p>
        {description && <p className={styles.help}>{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** 名前 + 入力欄 (+ 補足) */
function Field({ label, htmlFor, help, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>{label}</label>
      {children}
      {help && <p className={styles.help}>{help}</p>}
    </div>
  );
}

const KEY_ACTION_ORDER: KeyAction[] = [
  'pause', 'seekForward', 'seekBackward', 'volumeUp', 'volumeDown',
  'fullscreen', 'next', 'prev', 'escape',
];

export function SettingsPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const { mpvPath, ffmpegPath, ffprobePath, ytdlpPath, downloadDir, screenshotDir, keybindings, theme, autoPlayNext, hoverPreviewEnabled, language, categoryMode, aiEnabled, aiModelType, saveSettings, saveKeybindings, setCategoryMode, setAiModelType } = useSettingsStore();
  const { watchDirs, scanAndImport, removeWatchDir, isScanning, isThumbnailGenerating } = useLibraryStore();

  const [local, setLocal] = useState<AppSettings>({ mpvPath, ffmpegPath, ffprobePath, ytdlpPath, downloadDir, screenshotDir, keybindings, theme, autoPlayNext, hoverPreviewEnabled, language, categoryMode, aiEnabled, aiModelType });
  const [isSaving, setIsSaving] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [capturingAction, setCapturingAction] = useState<KeyAction | null>(null);
  // キー割り当ての入力待ちの間は Esc などで設定画面を閉じない (Esc 自体も割り当てられるように)
  const dialog = useDialogClose(onClose, { locked: capturingAction !== null });

  // カテゴリモード変更
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [showVirtualConfirm, setShowVirtualConfirm] = useState(false);

  const handleCategoryModeSelect = (mode: CategoryMode) => {
    if (mode === categoryMode) return;
    if (mode === 'sync') {
      setShowMigrationModal(true);
    } else {
      setShowVirtualConfirm(true);
    }
  };

  const handleMigrationDone = async () => {
    await setCategoryMode('sync');
    setShowMigrationModal(false);
  };

  const handleVirtualConfirm = async () => {
    await setCategoryMode('virtual');
    setShowVirtualConfirm(false);
  };

  // アプリバージョン
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  // ウェブサーバー
  const [wsPort, setWsPort] = useState(7777);
  const [wsRunning, setWsRunning] = useState(false);
  const [wsLoading, setWsLoading] = useState(false);
  const [localIp, setLocalIp] = useState<string | null>(null);

  // AIモデル状態
  const [aiModelDownloaded, setAiModelDownloaded] = useState(false);
  const [aiModelDownloading, setAiModelDownloading] = useState(false);
  const [aiModelProgress, setAiModelProgress] = useState(0);
  const [aiModelUninstalling, setAiModelUninstalling] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  useEffect(() => {
    invoke<number | null>('get_web_server_port').then((port) => {
      if (port != null) {
        setWsRunning(true);
        setWsPort(port);
      }
    });
    invoke<string | null>('get_local_ip').then(setLocalIp);
  }, []);

  // AIモデル状態を取得（選択中のモデルが変わるたびに再取得）
  useEffect(() => {
    invoke<{ downloaded: boolean; downloading: boolean; progress: number }>(
      'check_ai_model_status',
      { modelType: aiModelType }
    ).then((s) => {
      setAiModelDownloaded(s.downloaded);
      setAiModelDownloading(s.downloading);
      setAiModelProgress(s.progress);
    }).catch(console.error);
  }, [aiModelType]);

  // ダウンロード進捗イベントをリッスン
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<number>('ai://download-progress', (e) => {
      setAiModelProgress(e.payload);
      if (e.payload >= 1.0) {
        setAiModelDownloading(false);
        setAiModelDownloaded(true);
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handleInstallModel = async () => {
    try {
      setAiModelDownloading(true);
      setAiModelProgress(0);
      await invoke('download_ai_model', { modelType: aiModelType });
      setAiModelDownloaded(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setAiModelDownloading(false);
    }
  };

  const handleUninstallModel = async () => {
    setConfirmUninstall(false);
    setAiModelUninstalling(true);
    try {
      await invoke('uninstall_ai_model', { modelType: aiModelType });
      setAiModelDownloaded(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setAiModelUninstalling(false);
    }
  };

  const handleStartWs = async () => {
    setWsLoading(true);
    try {
      const actualPort = await invoke<number>('start_web_server', { port: wsPort });
      setWsPort(actualPort);
      setWsRunning(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setWsLoading(false);
    }
  };

  const handleStopWs = async () => {
    setWsLoading(true);
    try {
      await invoke('stop_web_server');
      setWsRunning(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setWsLoading(false);
    }
  };

  useEffect(() => {
    if (!capturingAction) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      setLocal((prev) => ({
        ...prev,
        keybindings: { ...prev.keybindings, [capturingAction]: e.key },
      }));
      setCapturingAction(null);
    };
    window.addEventListener('keydown', handler, { once: true });
    return () => window.removeEventListener('keydown', handler);
  }, [capturingAction]);

  const handlePickYtdlp = async () => {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, ytdlpPath: selected }));
    }
  };

  const handleDetectYtdlp = async () => {
    try {
      const detected = await invoke<string>("detect_ytdlp_path");
      setLocal((prev) => ({ ...prev, ytdlpPath: detected }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePickMpv = async () => {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, mpvPath: selected }));
    }
  };

  const handlePickDownloadDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, downloadDir: selected }));
    }
  };

  const handlePickScreenshotDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, screenshotDir: selected }));
    }
  };

  const handleAddScanPath = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await scanAndImport(selected);
    }
  };

  const handleRemoveScanPath = async (path: string) => {
    setRemovingPath(path);
    try {
      await removeWatchDir(path);
    } finally {
      setRemovingPath(null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveSettings(local);
      await saveKeybindings(local.keybindings);
      dialog.close();
    } finally {
      setIsSaving(false);
    }
  };

  const setPath = (key: 'mpvPath' | 'ffmpegPath' | 'ffprobePath' | 'ytdlpPath') =>
    (e: React.ChangeEvent<HTMLInputElement>) => setLocal((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <>
      {showMigrationModal && (
        <CategoryMigrationModal
          onDone={handleMigrationDone}
          onCancel={() => setShowMigrationModal(false)}
        />
      )}

      <ConfirmDialog
        open={confirmUninstall}
        onOpenChange={setConfirmUninstall}
        title={t('settings.aiModelUninstallConfirmTitle')}
        description={t('settings.aiModelUninstallConfirmDesc')}
        confirmLabel={t('settings.aiModelUninstallConfirm')}
        cancelLabel={t('confirm.cancel')}
        onConfirm={handleUninstallModel}
        danger
      />

      <ConfirmDialog
        open={showVirtualConfirm}
        onOpenChange={setShowVirtualConfirm}
        title={t('categoryModeChange.toVirtualTitle')}
        description={t('categoryModeChange.toVirtualDesc')}
        confirmLabel={t('categoryModeChange.toVirtualConfirm')}
        cancelLabel={t('categoryModeChange.cancel')}
        onConfirm={handleVirtualConfirm}
      />

      <Dialog
        {...dialog.props}
        size="md"
        title={t('settings.title')}
        closeLabel={t('confirm.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => dialog.close()}>
              {t('confirm.cancel')}
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? t('smartPlaylist.saving') : t('smartPlaylist.save')}
            </Button>
          </>
        }
      >
        <div className={styles.root}>
          {/* 外観 */}
          <Section title={t('settings.sectionAppearance')}>
            <Field label={t('settings.theme')}>
              <SegmentedControl<Theme>
                size="md"
                aria-label={t('settings.theme')}
                value={local.theme}
                onValueChange={(v) => setLocal((prev) => ({ ...prev, theme: v }))}
                options={[
                  { value: 'light', label: <><Sun aria-hidden />{t('settings.themeLight')}</> },
                  { value: 'dark', label: <><Moon aria-hidden />{t('settings.themeDark')}</> },
                  { value: 'auto', label: <><SunMoon aria-hidden />{t('settings.themeAuto')}</> },
                ]}
              />
            </Field>
            <Field label={t('settings.language')}>
              <SegmentedControl<Language>
                size="md"
                aria-label={t('settings.language')}
                value={local.language}
                onValueChange={(v) => setLocal((prev) => ({ ...prev, language: v }))}
                options={(Object.entries(LANGUAGE_LABELS) as [Language, string][]).map(([value, label]) => ({ value, label }))}
              />
            </Field>
          </Section>

          {/* 再生 */}
          <Section title={t('settings.sectionPlayback')}>
            <SettingRow title={t('settings.autoPlayNext')} description={t('settings.autoPlayNextDesc')}>
              <Switch
                checked={local.autoPlayNext}
                onCheckedChange={(v) => setLocal((prev) => ({ ...prev, autoPlayNext: v }))}
                aria-label={t('settings.autoPlayNext')}
              />
            </SettingRow>
            <SettingRow title={t('settings.hoverPreview')} description={t('settings.hoverPreviewDesc')}>
              <Switch
                checked={local.hoverPreviewEnabled}
                onCheckedChange={(v) => setLocal((prev) => ({ ...prev, hoverPreviewEnabled: v }))}
                aria-label={t('settings.hoverPreview')}
              />
            </SettingRow>
          </Section>

          {/* カテゴリモード */}
          <Section title={t('settings.sectionCategoryMode')}>
            <RadioGroup
              className={styles.choiceList}
              aria-label={t('settings.sectionCategoryMode')}
              value={categoryMode}
              onValueChange={(v) => handleCategoryModeSelect(v as CategoryMode)}
            >
              {(['virtual', 'sync'] as CategoryMode[]).map((mode) => {
                const key = `settings.categoryMode${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
                return (
                  <label key={mode} className={styles.choice} data-selected={categoryMode === mode || undefined}>
                    <RadioGroupItem value={mode} className={styles.choiceRadio} />
                    <div className={styles.settingText}>
                      <p className={styles.settingTitle}>{t(key)}</p>
                      <p className={styles.help}>{t(`${key}Desc`)}</p>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </Section>

          {/* AI 機能 */}
          <Section title={t('settings.sectionAi')}>
            <SettingRow title={t('settings.aiEnabled')} description={t('settings.aiEnabledDesc')}>
              <Switch
                checked={local.aiEnabled}
                onCheckedChange={(v) => setLocal((prev) => ({ ...prev, aiEnabled: v }))}
                aria-label={t('settings.aiEnabled')}
              />
            </SettingRow>
            <p className={styles.warning}>{t('settings.aiNsfwWarning')}</p>

            <Field label={t('settings.aiModelType')}>
              <RadioGroup
                className={styles.choiceList}
                aria-label={t('settings.aiModelType')}
                value={aiModelType}
                onValueChange={(v) => setAiModelType(v as AiModelType)}
              >
                {([
                  ['wd-tagger', t('settings.aiModelWdTagger'), t('settings.aiModelWdTaggerDesc')],
                  ['joytag', t('settings.aiModelJoyTag'), t('settings.aiModelJoyTagDesc')],
                ] as [AiModelType, string, string][]).map(([value, label, desc]) => {
                  const selected = aiModelType === value;
                  return (
                    <label key={value} className={styles.choice} data-selected={selected || undefined}>
                      <RadioGroupItem value={value} className={styles.choiceRadio} />
                      <div className={styles.settingText}>
                        <p className={styles.settingTitle}>{label}</p>
                        <p className={styles.help}>{desc}</p>
                        {selected && aiModelDownloading && (
                          <div className={styles.download}>
                            <div className={styles.meter}>
                              <div className={styles.meterBar} style={{ width: `${Math.round(aiModelProgress * 100)}%` }} />
                            </div>
                            <p className={styles.help}>
                              {t('settings.aiModelDownloading')} {Math.round(aiModelProgress * 100)}%
                            </p>
                          </div>
                        )}
                      </div>
                      {selected && (
                        <div className={styles.choiceActions}>
                          {aiModelDownloaded && !aiModelDownloading ? (
                            <>
                              <span className={styles.installed}>{t('settings.aiModelInstalled')}</span>
                              <Button
                                variant="danger-soft"
                                size="xs"
                                disabled={aiModelUninstalling}
                                onClick={(e) => { e.preventDefault(); setConfirmUninstall(true); }}
                              >
                                {aiModelUninstalling ? t('settings.aiModelUninstalling') : t('settings.aiModelUninstall')}
                              </Button>
                            </>
                          ) : !aiModelDownloading ? (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={(e) => { e.preventDefault(); handleInstallModel(); }}
                            >
                              {t('settings.aiModelInstall')}
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </label>
                  );
                })}
              </RadioGroup>
            </Field>
          </Section>

          {/* 実行ファイル */}
          <Section title={t('settings.sectionExecutable')}>
            <Field label={t('settings.mpvPath')} htmlFor="settings-mpv">
              <div className={styles.inputRow}>
                <Input
                  id="settings-mpv"
                  size="md"
                  className={styles.grow}
                  inputClassName={styles.mono}
                  value={local.mpvPath}
                  onChange={setPath('mpvPath')}
                  placeholder={t('settings.mpvPathPlaceholder')}
                />
                <Button variant="secondary" size="md" onClick={handlePickMpv}>
                  {t('settings.browse')}
                </Button>
              </div>
            </Field>
            <Field label={t('settings.ffmpegPath')} htmlFor="settings-ffmpeg" help={t('settings.ffmpegHelp')}>
              <Input
                id="settings-ffmpeg"
                size="md"
                className={styles.fullWidth}
                inputClassName={styles.mono}
                value={local.ffmpegPath}
                onChange={setPath('ffmpegPath')}
                placeholder={t('settings.ffmpegPlaceholder')}
              />
            </Field>
            <Field label={t('settings.ffprobePath')} htmlFor="settings-ffprobe">
              <Input
                id="settings-ffprobe"
                size="md"
                className={styles.fullWidth}
                inputClassName={styles.mono}
                value={local.ffprobePath}
                onChange={setPath('ffprobePath')}
                placeholder={t('settings.ffprobePlaceholder')}
              />
            </Field>
            <Field label={t('settings.ytdlpPath')} htmlFor="settings-ytdlp" help={t('settings.ytdlpHelp')}>
              <div className={styles.inputRow}>
                <Input
                  id="settings-ytdlp"
                  size="md"
                  className={styles.grow}
                  inputClassName={styles.mono}
                  value={local.ytdlpPath}
                  onChange={setPath('ytdlpPath')}
                  placeholder={t('settings.ytdlpPlaceholder')}
                />
                <Button variant="secondary" size="md" onClick={handlePickYtdlp}>
                  {t('settings.browse')}
                </Button>
                <Button variant="secondary" size="md" onClick={handleDetectYtdlp}>
                  {t('settings.autoDetect')}
                </Button>
              </div>
            </Field>
          </Section>

          {/* ダウンロード / スクリーンショット */}
          <Section title={t('settings.sectionDownload')}>
            {([
              ['downloadDir', t('settings.downloadDir'), t('settings.downloadDirPlaceholder'), handlePickDownloadDir],
              ['screenshotDir', t('settings.screenshotDir'), t('settings.screenshotDirPlaceholder'), handlePickScreenshotDir],
            ] as const).map(([key, label, placeholder, onPick]) => (
              <Field key={key} label={label}>
                <div className={styles.inputRow}>
                  <Input
                    size="md"
                    className={styles.grow}
                    inputClassName={styles.mono}
                    readOnly
                    value={local[key]}
                    placeholder={placeholder}
                    aria-label={label}
                  />
                  <Button variant="secondary" size="md" onClick={onPick}>
                    {t('settings.browse')}
                  </Button>
                  {local[key] && (
                    <Button
                      variant="danger-soft"
                      size="icon-sm"
                      aria-label={t('settings.reset')}
                      title={t('settings.reset')}
                      onClick={() => setLocal((prev) => ({ ...prev, [key]: "" }))}
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </div>
              </Field>
            ))}
          </Section>

          {/* スキャンパス */}
          <Section title={t('settings.sectionScanPaths')}>
            {watchDirs.length === 0 ? (
              <p className={styles.help}>{t('settings.noScanPaths')}</p>
            ) : (
              <ul className={styles.pathList}>
                {watchDirs.map((dir) => (
                  <li key={dir} className={styles.pathItem}>
                    <span className={styles.pathText} title={dir}>{dir}</span>
                    <Button
                      variant="danger-soft"
                      size="icon-sm"
                      disabled={removingPath === dir}
                      onClick={() => handleRemoveScanPath(dir)}
                      title={t('settings.removePath')}
                      aria-label={t('settings.removePath')}
                    >
                      {removingPath === dir ? "…" : <X aria-hidden />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="secondary"
              size="md"
              fullWidth
              disabled={isScanning || isThumbnailGenerating}
              onClick={handleAddScanPath}
            >
              <FolderPlus aria-hidden />
              {isScanning || isThumbnailGenerating ? t('app.scanning') : t('settings.addFolder')}
            </Button>
          </Section>

          {/* ウェブサーバー */}
          <Section title={t('settings.sectionWebServer')}>
            <p className={styles.help}>{t('settings.webServerDesc')}</p>
            <div className={styles.inputRow}>
              <label className={styles.inlineLabel} htmlFor="settings-port">{t('settings.port')}</label>
              <Input
                id="settings-port"
                size="sm"
                className={styles.portInput}
                type="number"
                min={1024}
                max={65535}
                value={wsPort}
                disabled={wsRunning}
                onChange={(e) => setWsPort(Number(e.target.value))}
              />
              {wsRunning ? (
                <Button variant="danger" size="sm" disabled={wsLoading} onClick={handleStopWs}>
                  {wsLoading ? t('settings.serverStopping') : t('settings.serverStop')}
                </Button>
              ) : (
                <Button variant="primary" size="sm" disabled={wsLoading} onClick={handleStartWs}>
                  {wsLoading ? t('settings.serverStarting') : t('settings.serverStart')}
                </Button>
              )}
            </div>
            {wsRunning && (
              <div className={styles.serverInfo}>
                <p className={styles.settingTitle}>{t('settings.serverRunning')}</p>
                <p className={styles.mono}>http://{localIp ?? '???'}:{wsPort}</p>
                <p className={styles.mono}>/api/videos · /api/stream/:id · /api/thumbnails/:filename</p>
              </div>
            )}
          </Section>

          {/* キーボードショートカット */}
          <Section title={t('settings.sectionKeybindings')}>
            {capturingAction && (
              <div className={styles.capture}>
                {t('settings.keybindingCapture', { action: t(KEY_ACTION_KEYS[capturingAction]) })}
                <Button variant="soft" size="sm" onClick={() => setCapturingAction(null)}>
                  {t('settings.keybindingCancel')}
                </Button>
              </div>
            )}
            <ul className={styles.keyList}>
              {KEY_ACTION_ORDER.map((action) => (
                <li key={action} className={styles.keyRow}>
                  <span className={styles.keyName}>{t(KEY_ACTION_KEYS[action])}</span>
                  <kbd className={styles.kbd}>{formatKey(local.keybindings[action])}</kbd>
                  <Button
                    variant={capturingAction === action ? 'primary' : 'secondary'}
                    size="xs"
                    aria-pressed={capturingAction === action}
                    onClick={() => setCapturingAction(capturingAction === action ? null : action)}
                  >
                    <Keyboard aria-hidden />
                    {t('settings.keybindingChange')}
                  </Button>
                  <span className={styles.keyReset}>
                    {local.keybindings[action] !== DEFAULT_KEYBINDINGS[action] && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('settings.keybindingResetOne')}
                        title={t('settings.keybindingResetOne')}
                        onClick={() => setLocal((prev) => ({
                          ...prev,
                          keybindings: { ...prev.keybindings, [action]: DEFAULT_KEYBINDINGS[action] },
                        }))}
                      >
                        <RotateCw aria-hidden />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setLocal((prev) => ({ ...prev, keybindings: DEFAULT_KEYBINDINGS }))}
              >
                {t('settings.keybindingReset')}
              </Button>
            </div>
          </Section>

          {/* このアプリについて */}
          <Section title={t('about.sectionTitle')}>
            <div>
              <p className={styles.settingTitle}>Chuck Snap Stack</p>
              <p className={styles.help}>{t('about.version')} {appVersion}</p>
            </div>
            <p className={styles.help}>{t('about.description')}</p>
            <p className={styles.help}>{t('about.license')}</p>
          </Section>
        </div>
      </Dialog>
    </>
  );
}
