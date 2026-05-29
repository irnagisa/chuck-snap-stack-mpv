# Chuck Snap Stack

動画ファイルを管理・再生するデスクトップアプリ。mpv を組み込んだ高機能な動画ライブラリマネージャです。

## 機能

- **動画ライブラリ管理** — ディレクトリをスキャンして動画を自動インポート。サムネイル自動生成。
- **mpv 再生** — mpv を内蔵プレイヤーとして使用。高品質・多フォーマット対応。
- **プレイリスト** — プレイリストの作成・管理、連続再生。
- **タグ & カテゴリ** — 動画にタグやカテゴリを付与してフィルタリング。色分け表示。
- **URL ダウンロード** — HTTP 直リンクまたは yt-dlp 経由で動画をダウンロード。進捗表示・キャンセル対応。
- **AV1 変換** — ffmpeg を使って動画を AV1 (libsvtav1 + libopus) に変換。ストレージ削減。
- **一括操作** — 複数動画への一括タグ付与・カテゴリ設定・削除。
- **キーボードショートカット** — 再生操作をキーボードで快適に操作。
- **テーマ切り替え** — ダーク / ライト / OS 設定に合わせた自動切り替え。
- **ファイルウォッチャー** — 監視ディレクトリへの動画追加・削除をリアルタイム検知。

## 動作環境

| 項目 | 要件 |
|---|---|
| OS | macOS / Linux |
| mpv | 必須。動画再生に使用。 |
| ffmpeg / ffprobe | サムネイル生成・AV1 変換に使用。 |
| yt-dlp | オプション。YouTube 等からのダウンロードに使用。 |

## インストール

### バイナリからインストール (推奨)

[Releases](https://github.com/irihi/chuck-snap-stack/releases) から最新版をダウンロードしてください。

| OS | ファイル形式 |
|---|---|
| macOS | `.dmg` |
| Linux | `.AppImage` / `.deb` |

### 依存ツールのインストール

**macOS (Homebrew)**

```bash
brew install mpv ffmpeg yt-dlp
```

**Linux (Ubuntu/Debian)**

```bash
sudo apt install mpv ffmpeg
pip install yt-dlp   # または公式バイナリを /usr/local/bin に配置
```


## 使い方

### 動画ライブラリのセットアップ

1. アプリ起動後、「フォルダを開く」ボタンで動画フォルダを選択
2. スキャン完了後、サムネイルが自動生成されます
3. 動画をクリックすると mpv で再生開始

### 設定

右上の歯車アイコンから設定画面を開けます。

| 設定項目 | 説明 | デフォルト |
|---|---|---|
| mpv パス | mpv 実行ファイルのパス | `/opt/homebrew/bin/mpv` (macOS) / `mpv` (Linux) |
| ffmpeg パス | ffmpeg 実行ファイルのパス | `ffmpeg` (PATH) |
| ffprobe パス | ffprobe 実行ファイルのパス | `ffprobe` (PATH) |
| yt-dlp パス | yt-dlp 実行ファイルのパス | 自動検出 |
| テーマ | ダーク / ライト / 自動 | 自動 |

### キーボードショートカット

| キー | 操作 |
|---|---|
| `Space` | 再生 / 一時停止 |
| `←` / `→` | 5秒戻る / 進む |
| `↑` / `↓` | 音量 +5 / -5 |
| `F` | フルスクリーン切り替え |
| `N` / `P` | 次の動画 / 前の動画 |
| `Escape` | モーダルを閉じる |

### URL ダウンロード

1. ツールバーの「ダウンロード」ボタンをクリック
2. 動画の URL を入力
3. yt-dlp を使う場合は「yt-dlp を使用」をオン
4. 「ダウンロード」を押すと進捗バーが表示されます。キャンセルも可能。

### AV1 変換

1. 動画を右クリックして「詳細」→「AV1 変換」
2. 変換完了後、元ファイルの削除を確認するダイアログが表示されます
3. 変換ファイルは元ファイルと同じディレクトリに `{ファイル名}.av1.mkv` として保存

## ソースからビルド

### 前提

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/)
- Tauri の依存ライブラリ ([公式ガイド](https://v2.tauri.app/start/prerequisites/))

### ビルド手順

```bash
git clone https://github.com/irihi/chuck-snap-stack.git
cd chuck-snap-stack
pnpm install

# 開発サーバー起動
pnpm tauri dev

# リリースビルド
pnpm tauri build
```

## ライセンス

MIT
