# yt-dlp バイナリ配置ガイド

yt-dlp バイナリをアプリにバンドルする場合、以下の命名規則でこのディレクトリに配置してください。

## ダウンロード元

https://github.com/yt-dlp/yt-dlp/releases/latest

## ファイル命名規則

| OS | リリースファイル名 | 配置ファイル名 |
|---|---|---|
| macOS (Apple Silicon) | `yt-dlp_macos` | `yt-dlp-aarch64-apple-darwin` |
| macOS (Intel) | `yt-dlp_macos` | `yt-dlp-x86_64-apple-darwin` |
| Windows (64bit) | `yt-dlp.exe` | `yt-dlp-x86_64-pc-windows-msvc.exe` |
| Linux (64bit) | `yt-dlp` | `yt-dlp-x86_64-unknown-linux-gnu` |

## バンドルバイナリのセットアップ手順 (macOS Apple Silicon の例)

```bash
# yt-dlp バイナリをダウンロード
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos \
  -o src-tauri/binaries/yt-dlp-aarch64-apple-darwin

# 実行権限付与
chmod +x src-tauri/binaries/yt-dlp-aarch64-apple-darwin

# tauri.conf.json の bundle セクションに以下を追加してビルド
# "externalBin": ["binaries/yt-dlp"]
```

## バイナリなしでの使用 (推奨)

バイナリをこのディレクトリに配置しなくても、以下のいずれかで yt-dlp を使用できます:

1. **システムインストール**: `brew install yt-dlp` (macOS) または `pip install yt-dlp`
2. **設定で指定**: アプリの設定 → 実行ファイル → yt-dlp パス に絶対パスを入力
3. **「自動検出」ボタン**: 設定画面の自動検出ボタンで PATH 上のバイナリを検索

## バイナリ検索の優先順位

1. アプリのリソースディレクトリ内の `yt-dlp` (externalBin バンドル時)
2. アプリ実行ファイルと同じディレクトリの `yt-dlp`
3. アプリ設定で指定されたパス
4. PATH 上の `yt-dlp`
