# Chuck Snap Stack

Tauri v2 製のメディア管理・ビューワーデスクトップアプリ。

## Tech Stack

| レイヤー | 技術 |
|---|---|
| デスクトップフレームワーク | Tauri v2 |
| フロントエンド | React 19 + TypeScript + Vite |
| UI プリミティブ | Radix UI (`radix-ui` 統合パッケージ) |
| スタイリング | Native CSS (CSS Modules + カスケードレイヤー + デザイントークン) |
| アイコン | Lucide React |
| アニメーション | Motion (`motion/react`) |
| 状態管理 | Zustand |
| バックエンド | Rust (Tauri コマンド) |
| メディア再生 | mpv (IPC ソケット経由サブプロセス) |
| DB | SQLite (rusqlite bundled) |

## アーキテクチャ

### mpv 統合 (IPC ソケット方式)

mpv をサブプロセスとして起動し、Unix ソケット (macOS/Linux) または名前付きパイプ (Windows) 経由で JSON IPC コマンドを送信する。

```
Frontend (React) → invoke() → Tauri Command (Rust) → mpv IPC Socket → mpv process
```

**mpv 起動コマンド例:**
```
mpv --idle --no-terminal --input-ipc-server=/tmp/mpv-socket <file>
```

**IPC コマンド形式:**
```json
{ "command": ["loadfile", "/path/to/video.mp4"] }
{ "command": ["get_property", "playback-time"] }
{ "command": ["set_property", "pause", true] }
```

### ディレクトリ構成

```
chuck-snap-stack/
├── CLAUDE.md
├── e2e/                        # E2E テスト (WebdriverIO + tauri-plugin-wdio-webdriver)
│   ├── specs/
│   └── wdio.conf.ts
├── src/                        # React フロントエンド
│   ├── components/
│   │   ├── Home/               # ダッシュボード (HomeView, 各サマリーカード)
│   │   ├── Library/            # メディアライブラリ UI (32 ファイル)
│   │   ├── Inbox/              # Inbox・クイックソート UI
│   │   ├── Player/             # プレイヤー UI (mpv ウィンドウのラッパー)
│   │   ├── Settings/           # 設定パネル
│   │   └── common/             # 共通 UI コンポーネント
│   ├── hooks/                  # カスタムフック
│   ├── store/                  # Zustand ストア (13 ファイル)
│   ├── types/                  # TypeScript 型定義
│   ├── utils/                  # ユーティリティ関数
│   ├── lib/                    # メディアアイコン等
│   ├── i18n/                   # 国際化 (i18next)
│   └── App.tsx
├── src-tauri/                  # Rust/Tauri バックエンド
│   ├── src/
│   │   ├── commands/           # Tauri コマンド (149 個)
│   │   │   ├── library.rs      # メディアファイル操作・メタデータ抽出
│   │   │   ├── mpv.rs          # mpv プロセス管理・IPC
│   │   │   ├── db_videos.rs    # メディア DB CRUD・Inbox 管理
│   │   │   ├── db_videos_scan.rs # ディレクトリスキャン・インポート
│   │   │   ├── db_tags.rs      # タグ・カテゴリ DB
│   │   │   ├── db_playlists.rs # プレイリスト DB
│   │   │   ├── db_groups.rs    # グループ (シリーズ・別パターン) とファイル名からのまとめる候補
│   │   │   ├── db_settings.rs  # 設定 DB
│   │   │   ├── db_stats.rs     # ライブラリ統計
│   │   │   ├── storage.rs      # 容量の内訳・整理候補・サムネイルの掃除・ゴミ箱と退避フォルダ
│   │   │   ├── storage_duplicates.rs # 整理画面の重複検出 (中身の一致 + pHash)。抜き出しのハッシュは DB に取っておく。APFS のクローンは空く容量から除く
│   │   │   ├── storage_leftovers.rs # 途中で止まったダウンロード・変換・AI モデル取得の残りファイル
│   │   │   ├── fs_clone.rs     # APFS のクローン情報 (共有していない容量・clone id、macOS の getattrlist)
│   │   │   ├── db_export.rs    # バックアップ・エクスポート
│   │   │   ├── download.rs     # HTTP ダウンロード
│   │   │   ├── transcode.rs    # ffmpeg 変換 (AV1 / HEVC / 音声だけ / トラック整理・切り詰め)
│   │   │   ├── webp_thumb.rs   # サムネイルの WebP 書き出し (libwebp なしの ffmpeg は PNG 経由)
│   │   │   ├── ytdlp.rs        # yt-dlp 連携
│   │   │   ├── watcher.rs      # ファイルシステム監視
│   │   │   ├── window.rs       # ミニプレイヤーウィンドウ
│   │   │   ├── webserver.rs    # 組み込み HTTP サーバー (サムネイル配信)
│   │   │   ├── phash.rs        # 知覚的ハッシュ・重複検出
│   │   │   ├── media_probe.rs  # 映像の情報 (コーデック・解像度・fps) を ffprobe で調べて media_probe に保存。AV1 にしたときに減る割合の見積もり
│   │   │   ├── silent_audio.rs # 無音の音声トラックの検出 (volumedetect。既定は数十か所を読む簡易判定、thorough で全体を読む)
│   │   │   ├── ai.rs           # AI タグ提案 (ONNX)
│   │   │   ├── link.rs         # URL メタデータ取得・リンクアセット DB
│   │   │   ├── system.rs       # システム情報 (ディスク情報等)
│   │   │   ├── settings.rs     # アプリ設定・パス検出
│   │   │   ├── utils.rs        # 検証ユーティリティ
│   │   │   └── mod.rs
│   │   ├── db/                 # SQLite スキーマ・クエリ
│   │   │   ├── mod.rs
│   │   │   ├── schema.rs       # テーブル定義・インデックス
│   │   │   └── migrations.rs   # スキーママイグレーション
│   │   ├── ai/                 # AI タグ推論エンジン
│   │   │   ├── mod.rs
│   │   │   ├── wd_tagger.rs    # WD ViT Tagger v3
│   │   │   └── suggest.rs      # タグスコアリング
│   │   ├── lib.rs              # Tauri ビルダー・状態管理・invoke_handler
│   │   └── main.rs             # エントリーポイント
│   ├── Cargo.toml
│   └── tauri.conf.json
└── .claude/commands/           # Claude Code カスタムスキル
```

### SQLite スキーマ

```sql
-- メディアファイル情報 (動画・音声・画像)
CREATE TABLE videos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  path                TEXT NOT NULL UNIQUE,
  title               TEXT,
  duration            REAL,
  thumbnail           TEXT,
  watched_at          TEXT,
  progress            REAL DEFAULT 0,        -- 再生位置 (秒)
  rating              INTEGER DEFAULT 0,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  category_id         INTEGER REFERENCES categories(id),
  has_audio           INTEGER,
  watch_count         INTEGER DEFAULT 0,
  media_type          TEXT DEFAULT 'video',  -- 'video' | 'audio' | 'image'
  source_url          TEXT,
  status              TEXT,                  -- 'active' | 'inbox' | 'missing'
  source_type         TEXT,                  -- 'local' | 'download'
  ai_tag_suggestions  TEXT,                  -- JSON (AI 提案タグ)
  ai_new_suggestions  TEXT,                  -- JSON (未マッチの新規提案)
  ai_analyzed_at      TEXT,
  phash               TEXT,                  -- 知覚的ハッシュ (重複検出用)
  last_viewed_at      TEXT,                  -- 最終視聴日時
  file_size           INTEGER,               -- ファイルサイズ (bytes, ソート用キャッシュ)
  audio_silence       TEXT,                  -- 無音の音声トラック: 'none' | 'partial' | 'all' (NULL = 未確認)
  silent_audio_streams TEXT,                 -- 無音のトラックの番号 (ffprobe の index、カンマ区切り)
  silent_audio_bytes  INTEGER,               -- 無音のトラックの容量の見込み (外すと空く)
  audio_silence_sampled INTEGER,             -- 1 = 無音は数か所を読んだだけの簡易判定 (外す前に全体を読んで確かめる)
  content_digest      TEXT,                  -- 重複の比較用の抜き出しのハッシュ (hex)
  content_digest_key  TEXT,                  -- content_digest を計算したときの「サイズ:更新日時(ns)」。変わったら計算し直す
  group_id            INTEGER REFERENCES media_groups(id) ON DELETE SET NULL,
  group_position      INTEGER                -- グループ内の並び順
);

-- グループ (シリーズ・同じ内容の別パターン)。ライブラリでは代表の 1 件にまとめて表示できる
CREATE TABLE media_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'variants', -- 'variants' | 'series'
  cover_video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL, -- 代表 (NULL = 並び順で最初)
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ffprobe で調べた映像の情報 (計算し直せるキャッシュなので videos と分ける)。整理画面の高ビットレートで減る割合の見積もりに使う
CREATE TABLE media_probe (
  video_id      INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  probe_key     TEXT NOT NULL,   -- 調べたときの「サイズ:更新日時(ns)」。サイズが videos.file_size と違えば調べ直す
  video_codec   TEXT,
  width         INTEGER,
  height        INTEGER,
  fps           REAL,
  video_bitrate INTEGER,         -- 映像だけ (bps)
  probed_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- カテゴリ (階層構造対応)
CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  parent_id  INTEGER REFERENCES categories(id),
  icon       TEXT DEFAULT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- タグ
CREATE TABLE tags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  color           TEXT NOT NULL DEFAULT '#6366f1',
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  tag_category_id INTEGER REFERENCES tag_categories(id),
  icon            TEXT DEFAULT NULL
);

CREATE TABLE tag_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE video_tags (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);

-- プレイリスト
CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE playlist_items (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position    INTEGER,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE TABLE smart_playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 監視フォルダ
CREATE TABLE watch_dirs (
  path                TEXT PRIMARY KEY,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  use_dir_as_category INTEGER DEFAULT 0
);

-- アプリ設定
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## UI 構成 (Radix UI + Native CSS + Lucide + Motion)

- デザインは「カジュアル」テーマ: 暖色寄りのニュートラル + ぶどう色 (violet) のアクセント、大きめの角丸、丸ゴシック (SF Rounded / ヒラギノ丸ゴ)、色付き背景の上に角丸パネルを並べるレイアウト
- `src/styles/reset.css` — 最小リセット (Tailwind v4 の preflight が元)。全要素 margin / padding 0・`border: 0 solid`、見出しは大きさを継承、リストは記号なし、画像は block、ボタン・入力欄はフォントと色を継承。モジュールはこの初期値を前提に書く
- `src/styles/tokens.css` — デザイントークン (`--color-*`, `--space-*`, `--radius-*` 等)。色は `light-dark()` で定義し、`color-scheme` で明暗が決まる
- ダークモード: 設定 `theme` (light / dark / auto、既定 auto = OS 追従)。`src/lib/theme.ts` が `<html class="light|dark">` を付け、`useTheme` が設定変更・OS の外観変更に追従する。起動時は `main.tsx` の `initTheme()` がキャッシュ (localStorage) から即適用してちらつきを防ぐ。ネイティブのタイトルバーも `setTheme` で合わせる (capability `core:window:allow-set-theme`)。切替は View Transitions でクロスフェード
- `src/components/ui/` — 共通プリミティブ。Radix ベース: Button, Dialog, ConfirmDialog, DropdownMenu, ContextMenu, Select, Tooltip, Popover, Tabs, SegmentedControl (ToggleGroup), Switch, Checkbox, RadioGroup, Slider, ScrollArea。Radix に無いもの: Input (ネイティブ input をトークンで装飾)。`import { Button } from "../ui"`
- ボタン・入力・選択は生の `<button>` / `<input>` / `<select>` を書かず ui の部品を使う (一覧の行・色見本・星評価・タグチップなど、ボタンの見た目でないクリック要素は例外)
- `src/components/Layout/` — アプリシェル・3 ペインレイアウト (ThreePaneLayout, PaneResizer, Pagination 等)
- コンポーネントのスタイルは隣接する `*.module.css` に `@layer ui { … }` で書き、値はトークンを使う。状態は `data-*` 属性 (Radix の `data-state` 等) でスタイルする
- レイヤー順序は `base, tokens, ui` (`src/index.css`)。`index.css` は `main.tsx` で最初に import すること (レイヤー順序を最初に確定させるため)
- アニメーションは `src/components/ui/motion.ts` のプリセットを使う。`prefers-reduced-motion` は `<MotionConfig reducedMotion="user">` で一括対応
  - hover / focus の色変化は CSS transition、出現・消滅・移動・サイズ変化は Motion
  - 条件付き表示は `AnimatePresence`。高さの開閉は `<Collapse>`、ストアの値が消えても退場中に中身を保つには `useFrozenWhileExiting` (`src/components/ui/presence.tsx`)
- ユーティリティクラスは無い。`className` にはモジュールのクラスだけを渡し、色は `tokens.css` のセマンティックトークン (`--color-*`) を使う。常に暗い面 (再生バーなど) は `color-scheme: dark` を付けると配下のトークンもダーク配色になる

## 開発コマンド

```bash
# 開発サーバー起動
pnpm tauri dev

# フロントエンドのみ
pnpm dev

# ビルド
pnpm tauri build

# 型チェック
pnpm tsc --noEmit

# Rust チェック
cd src-tauri && cargo check

# Rust テスト
cd src-tauri && cargo test

# ユニットテスト (Vitest)
pnpm test

# E2E テスト (WebdriverIO)
pnpm test:e2e:build   # デバッグビルド (初回・変更時)
pnpm test:e2e         # E2E テスト実行
```

## Tauri コマンドのパターン

### Rust 側 (src-tauri/src/commands/*.rs)

```rust
#[tauri::command]
pub async fn command_name(
    state: tauri::State<'_, AppState>,
    param: String,
) -> Result<ReturnType, String> {
    // エラーは .map_err(|e| e.to_string()) で String に変換
    do_something(&param).map_err(|e| e.to_string())
}
```

### 登録 (src-tauri/src/lib.rs)

```rust
.invoke_handler(tauri::generate_handler![
    commands::mpv::play,
    commands::library::scan_directory,
    // ...他 147 個のコマンド
])
```

### フロントエンド側 (src/hooks/ or コンポーネント)

```typescript
import { invoke } from '@tauri-apps/api/core';

const result = await invoke<ReturnType>('command_name', { param: 'value' });
```

## mpv IPC コマンド一覧

| 操作 | IPC コマンド |
|---|---|
| ファイル再生 | `["loadfile", path, "replace"]` |
| 一時停止/再開 | `["cycle", "pause"]` |
| 再生位置取得 | `["get_property", "playback-time"]` |
| 再生位置移動 | `["set_property", "playback-time", seconds]` |
| 音量設定 | `["set_property", "volume", 0-100]` |
| 速度設定 | `["set_property", "speed", 1.0]` |
| フルスクリーン | `["set_property", "fullscreen", true]` |
| 終了 | `["quit"]` |

## コーディング規約

- Rust: `snake_case`、エラーは `thiserror` クレートで定義
- TypeScript: `camelCase`、コンポーネントは `PascalCase`
- Tauri コマンド名: `snake_case` (Rust) / フロントエンドでも `snake_case` 文字列として呼ぶ
- 非同期: Rust は `tokio::spawn` / `async fn`、TS は `async/await`
- Zustand ストアは機能ごとにファイル分割 (`usePlayerStore`, `useLibraryStore`)

## Tauri イベント (進捗通知パターン)

長時間処理 (ダウンロード・トランスコード) は Tauri イベントで進捗を Frontend に Push する。

**イベントチャンネル一覧:**

| イベント | ペイロード | 説明 |
|---|---|---|
| `download://progress` | `{percent, downloaded, total, filename, speed}` | HTTP ダウンロード進捗 |
| `transcode://progress` | `{percent, filename}` | トランスコード進捗 |
| `ytdlp://progress` | `{percent, filename, status}` | yt-dlp ダウンロード進捗 |
| `thumbnail://progress` | `{current, total}` | サムネイル生成進捗 |
| `phash://progress` | `{current, total}` | pHash 計算進捗 |
| `ai-model://download-progress` | `{percent}` | AI モデルダウンロード進捗 |
| `video-file-created` | `{path}` | ウォッチャー: ファイル追加検知 |
| `video-file-removed` | `{path}` | ウォッチャー: ファイル削除検知 |

```rust
// Rust 側: app.emit でイベント送信
app.emit("download://progress", DownloadProgress { percent, ... })?;

// キャンセルは AtomicBool で制御
if cancel_flag.load(Ordering::SeqCst) {
    // クリーンアップ (ファイル削除など)
    return Err("キャンセルされました".to_string());
}
```

```typescript
// TS 側: listen でイベント受信
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen<DownloadProgress>('download://progress', (e) => {
  setPercent(e.payload.percent);
});
// クリーンアップ
unlisten();
```

## ファイルウォッチャー

`notify` クレートでメディアフォルダを監視。`start_watching` / `stop_watching` コマンドで制御。
イベント: `video-file-created` / `video-file-removed` → `useWatcher` フックで DB に反映。

## 注意事項

- mpv のパスは OS によって異なる。macOS: Homebrew `/opt/homebrew/bin/mpv`
- IPC ソケットパスは一時ディレクトリに作成し、アプリ終了時に削除する
- 大量のメディアファイルスキャンは `tokio::task::spawn_blocking` でブロッキング I/O を処理
- CPU 負荷の高い処理 (transcode) も `spawn_blocking` を使う
- AV1 変換は SVT-AV1 (`libsvtav1`) を優先し、無い ffmpeg (evermeet.cx の Intel Mac 向けビルドなど) では libaom (`libaom-av1`) で代わりにする。使えるエンコーダーは `ffmpeg -encoders` で調べる
- HEVC 変換 (`hevc_videotoolbox`) は Intel Mac で画質指定 `-q:v` が使えないためビットレート指定にしている。8 ビット入力は `-pix_fmt nv12` を明示しないと失敗する。libopus は `5.1(side)` 等の配置を受け付けないので `aformat` で並べ替える
- サムネイルは WebP 形式で生成 (ffmpeg 使用、`webp_thumb::ffmpeg_to_webp` を通す)。WebP の書き出しには libwebp 入りの ffmpeg が要るが、Homebrew の `ffmpeg` など libwebp なしの配布もあるため、書けない ffmpeg では PNG で取り出して `webp` クレートで非可逆 WebP にする。`start_web_server` で組み込み HTTP サーバー (axum) を起動してフロントエンドへ配信する
- pHash (知覚的ハッシュ) で重複メディアを検出。`db_compute_video_phash` → `db_find_similar_videos` の流れ
- 計算し直せる解析結果のキャッシュを新しく持つときは、`videos` に列を足さず別テーブル (`media_probe` のように video_id を主キー・ON DELETE CASCADE) にする
- 整理画面の高ビットレートは、AV1 にしたときに減る割合の見積もり (`media_probe::estimate_av1_saving`、解像度・fps・コーデック・ビットレートからの目安) の大きい順に並べる
- 整理画面の確認 (映像の情報・pHash・無音の簡易判定) は `useBackgroundChecks` が何もしていないときに裏で進める (設定 `background_checks`、既定 on)。急がない ffmpeg は `utils::background_command` で起動し、macOS では `taskpolicy -c utility` で優先度を下げる
- AI タグ提案は tract-onnx で ONNX モデルを実行 (WD ViT Tagger v3)。モデルは `download_ai_model` でダウンロード
- rusqlite を直接使用 (tauri-plugin-sql は不使用)。SQL インジェクション対策でプリペアドステートメントを使う
- ダウンロード URL は SSRF 対策でバリデーション済み (プライベート IP・localhost・mDNS ブロック)
- mpv プロセス監視: `generation` カウンタで古いモニタスレッドを自動終了させる
