# Chuck Snap Stack

Tauri v2 製のメディア管理・ビューワーデスクトップアプリ。

## Tech Stack

| レイヤー | 技術 |
|---|---|
| デスクトップフレームワーク | Tauri v2 |
| フロントエンド | React 19 + TypeScript + Vite |
| スタイリング | Tailwind CSS v4 |
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
├── src/                        # React フロントエンド
│   ├── components/
│   │   ├── Library/            # メディアライブラリ UI (30+ ファイル)
│   │   ├── Inbox/              # Inbox・クイックソート UI
│   │   ├── Player/             # プレイヤー UI (mpv ウィンドウのラッパー)
│   │   ├── Settings/           # 設定パネル
│   │   └── common/             # 共通 UI コンポーネント
│   ├── hooks/                  # カスタムフック
│   ├── store/                  # Zustand ストア (10 ファイル)
│   ├── types/                  # TypeScript 型定義
│   ├── utils/                  # ユーティリティ関数
│   ├── lib/                    # メディアアイコン等
│   ├── i18n/                   # 国際化 (i18next)
│   └── App.tsx
├── src-tauri/                  # Rust/Tauri バックエンド
│   ├── src/
│   │   ├── commands/           # Tauri コマンド (122 個)
│   │   │   ├── library.rs      # メディアファイル操作・メタデータ抽出
│   │   │   ├── mpv.rs          # mpv プロセス管理・IPC
│   │   │   ├── db_videos.rs    # メディア DB CRUD・Inbox 管理
│   │   │   ├── db_videos_scan.rs # ディレクトリスキャン・インポート
│   │   │   ├── db_tags.rs      # タグ・カテゴリ DB
│   │   │   ├── db_playlists.rs # プレイリスト DB
│   │   │   ├── db_settings.rs  # 設定 DB
│   │   │   ├── db_stats.rs     # ライブラリ統計
│   │   │   ├── db_export.rs    # バックアップ・エクスポート
│   │   │   ├── download.rs     # HTTP ダウンロード
│   │   │   ├── transcode.rs    # ffmpeg トランスコード
│   │   │   ├── ytdlp.rs        # yt-dlp 連携
│   │   │   ├── watcher.rs      # ファイルシステム監視
│   │   │   ├── window.rs       # ミニプレイヤーウィンドウ
│   │   │   ├── webserver.rs    # 組み込み HTTP サーバー (サムネイル配信)
│   │   │   ├── phash.rs        # 知覚的ハッシュ・重複検出
│   │   │   ├── ai.rs           # AI タグ提案 (ONNX)
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
  category_id         INTEGER REFERENCES categories(id),
  has_audio           INTEGER DEFAULT 1,
  watch_count         INTEGER DEFAULT 0,
  media_type          TEXT DEFAULT 'video',  -- 'video' | 'audio' | 'image'
  source_url          TEXT,
  status              TEXT DEFAULT 'active', -- 'active' | 'inbox' | 'missing'
  source_type         TEXT DEFAULT 'local',  -- 'local' | 'download'
  ai_tag_suggestions  TEXT,                  -- JSON (AI 提案タグ)
  ai_new_suggestions  TEXT,                  -- JSON (未マッチの新規提案)
  ai_analyzed_at      TEXT,
  phash               TEXT,                  -- 知覚的ハッシュ (重複検出用)
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

-- カテゴリ (階層構造対応)
CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT,
  parent_id  INTEGER REFERENCES categories(id),
  icon       TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- タグ
CREATE TABLE tags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  color           TEXT,
  tag_category_id INTEGER REFERENCES tag_categories(id),
  icon            TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tag_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE video_tags (
  video_id INTEGER REFERENCES videos(id),
  tag_id   INTEGER REFERENCES tags(id),
  PRIMARY KEY (video_id, tag_id)
);

-- プレイリスト
CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE playlist_items (
  playlist_id INTEGER REFERENCES playlists(id),
  video_id    INTEGER REFERENCES videos(id),
  position    INTEGER,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE TABLE smart_playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  filter_json TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 監視フォルダ
CREATE TABLE watch_dirs (
  path                TEXT PRIMARY KEY,
  use_dir_as_category INTEGER DEFAULT 0,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

-- アプリ設定
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

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
    // ...他 120 個のコマンド
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
