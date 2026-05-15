# Chuck Snap Stack

Tauri v2 製の動画管理・ビューワーデスクトップアプリ。

## Tech Stack

| レイヤー | 技術 |
|---|---|
| デスクトップフレームワーク | Tauri v2 |
| フロントエンド | React 19 + TypeScript + Vite |
| スタイリング | Tailwind CSS v4 |
| 状態管理 | Zustand |
| バックエンド | Rust (Tauri コマンド) |
| 動画再生 | mpv (IPC ソケット経由サブプロセス) |
| DB | SQLite via tauri-plugin-sql |

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
│   │   ├── Library/            # 動画ライブラリ UI
│   │   ├── Player/             # プレイヤー UI (mpv ウィンドウのラッパー)
│   │   └── common/             # 共通 UI コンポーネント
│   ├── hooks/                  # カスタムフック
│   ├── store/                  # Zustand ストア
│   ├── types/                  # TypeScript 型定義
│   └── App.tsx
├── src-tauri/                  # Rust/Tauri バックエンド
│   ├── src/
│   │   ├── commands/           # Tauri コマンド (invoke ハンドラ)
│   │   │   ├── library.rs      # 動画ライブラリ操作
│   │   │   ├── mpv.rs          # mpv プロセス管理・IPC
│   │   │   └── mod.rs
│   │   ├── db/                 # SQLite スキーマ・クエリ
│   │   ├── mpv/                # mpv IPC クライアント実装
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── .claude/commands/           # Claude Code カスタムスキル
```

### SQLite スキーマ

```sql
CREATE TABLE videos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path        TEXT NOT NULL UNIQUE,
  title       TEXT,
  duration    REAL,
  thumbnail   TEXT,
  watched_at  TEXT,
  progress    REAL DEFAULT 0,   -- 再生位置 (秒)
  rating      INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

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

### 登録 (src-tauri/src/main.rs)

```rust
.invoke_handler(tauri::generate_handler![
    commands::mpv::play,
    commands::library::scan_directory,
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

## 注意事項

- mpv のパスは OS によって異なる。macOS: Homebrew `/opt/homebrew/bin/mpv`
- IPC ソケットパスは一時ディレクトリに作成し、アプリ終了時に削除する
- 大量の動画ファイルスキャンは `tokio::task::spawn_blocking` でブロッキング I/O を処理
- サムネイル生成は `ffmpeg` コマンドを使用 (要確認: インストール済みか)
- `tauri-plugin-sql` は SQL インジェクション対策で必ずプリペアドステートメントを使う
