# Chuck Snap Stack

Tauri v2 製のメディア管理・ビューワーデスクトップアプリ。

## Tech Stack

| レイヤー | 技術 |
|---|---|
| デスクトップフレームワーク | Tauri v2 |
| フロントエンド | React 19 + TypeScript + Vite |
| UI プリミティブ | Radix UI (`radix-ui` 統合パッケージ) |
| スタイリング | Native CSS (CSS Modules + カスケードレイヤー + デザイントークン)。既存画面は Tailwind CSS v4 から段階移行中 |
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
│   │   ├── commands/           # Tauri コマンド (142 個)
│   │   │   ├── library.rs      # メディアファイル操作・メタデータ抽出
│   │   │   ├── mpv.rs          # mpv プロセス管理・IPC
│   │   │   ├── db_videos.rs    # メディア DB CRUD・Inbox 管理
│   │   │   ├── db_videos_scan.rs # ディレクトリスキャン・インポート
│   │   │   ├── db_tags.rs      # タグ・カテゴリ DB
│   │   │   ├── db_playlists.rs # プレイリスト DB
│   │   │   ├── db_settings.rs  # 設定 DB
│   │   │   ├── db_stats.rs     # ライブラリ統計
│   │   │   ├── storage.rs      # 容量の内訳・整理候補・サムネイルの掃除
│   │   │   ├── db_export.rs    # バックアップ・エクスポート
│   │   │   ├── download.rs     # HTTP ダウンロード
│   │   │   ├── transcode.rs    # ffmpeg トランスコード
│   │   │   ├── ytdlp.rs        # yt-dlp 連携
│   │   │   ├── watcher.rs      # ファイルシステム監視
│   │   │   ├── window.rs       # ミニプレイヤーウィンドウ
│   │   │   ├── webserver.rs    # 組み込み HTTP サーバー (サムネイル配信)
│   │   │   ├── phash.rs        # 知覚的ハッシュ・重複検出
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
  file_size           INTEGER                -- ファイルサイズ (bytes, ソート用キャッシュ)
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
- `src/styles/tailwind-bridge.css` — 既存 Tailwind 画面にも新テーマを当てるブリッジ (gray → ニュートラル、blue → アクセント)。角丸 (`--radius-*`) とフォントは tokens.css が Tailwind にもそのまま効く。Tailwind 撤去時に削除
- `src/styles/tokens.css` — デザイントークン (`--color-*`, `--space-*`, `--radius-*` 等)。色は `light-dark()` で定義し、`color-scheme` で明暗が決まる
- ダークモード: 設定 `theme` (light / dark / auto、既定 auto = OS 追従)。`src/lib/theme.ts` が `<html class="light|dark">` を付け、`useTheme` が設定変更・OS の外観変更に追従する。起動時は `main.tsx` の `initTheme()` がキャッシュ (localStorage) から即適用してちらつきを防ぐ。ネイティブのタイトルバーも `setTheme` で合わせる (capability `core:window:allow-set-theme`)。切替は View Transitions でクロスフェード
- `src/components/ui/` — 共通プリミティブ。Radix ベース: Button, Dialog, ConfirmDialog, DropdownMenu, ContextMenu, Select, Tooltip, Popover, Tabs, SegmentedControl (ToggleGroup), Switch, Checkbox, RadioGroup, Slider, ScrollArea。Radix に無いもの: Input (ネイティブ input をトークンで装飾)。`import { Button } from "../ui"`
- ボタン・入力・選択は生の `<button>` / `<input>` / `<select>` を書かず ui の部品を使う (一覧の行・色見本・星評価・タグチップなど、ボタンの見た目でないクリック要素は例外)
- `src/components/Layout/` — アプリシェル・3 ペインレイアウト (ThreePaneLayout, PaneResizer, Pagination 等)
- コンポーネントのスタイルは隣接する `*.module.css` に `@layer ui { … }` で書き、値はトークンを使う。状態は `data-*` 属性 (Radix の `data-state` 等) でスタイルする
- レイヤー順序は `theme, base, tokens, components, ui, utilities` (`src/index.css`)。`index.css` は `main.tsx` で最初に import すること (順序が崩れると Tailwind preflight が ui を上書きする)
- アニメーションは `src/components/ui/motion.ts` のプリセットを使う。`prefers-reduced-motion` は `<MotionConfig reducedMotion="user">` で一括対応
  - hover / focus の色変化は CSS transition、出現・消滅・移動・サイズ変化は Motion
  - 条件付き表示は `AnimatePresence`。高さの開閉は `<Collapse>`、ストアの値が消えても退場中に中身を保つには `useFrozenWhileExiting` (`src/components/ui/presence.tsx`)
- 新規・改修するコンポーネントは新構成で書く。既存の Tailwind コンポーネントは触る機会に移行し、全移行後に Tailwind を削除する

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
    // ...他 140 個のコマンド
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
- サムネイルは WebP 形式で生成 (ffmpeg 使用)。`start_web_server` で組み込み HTTP サーバー (axum) を起動してフロントエンドへ配信する
- pHash (知覚的ハッシュ) で重複メディアを検出。`db_compute_video_phash` → `db_find_similar_videos` の流れ
- AI タグ提案は tract-onnx で ONNX モデルを実行 (WD ViT Tagger v3)。モデルは `download_ai_model` でダウンロード
- rusqlite を直接使用 (tauri-plugin-sql は不使用)。SQL インジェクション対策でプリペアドステートメントを使う
- ダウンロード URL は SSRF 対策でバリデーション済み (プライベート IP・localhost・mDNS ブロック)
- mpv プロセス監視: `generation` カウンタで古いモニタスレッドを自動終了させる
