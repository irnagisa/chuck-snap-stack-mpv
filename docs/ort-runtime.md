# ONNX Runtime (ORT) 統合ガイド

Chuck Snap Stack は AI タグ推論 (WD ViT Tagger v3 / JoyTag) に [ONNX Runtime](https://onnxruntime.ai/) を使用します。
Rust バインディングは [pykeio/ort](https://github.com/pykeio/ort) v2.0.0-rc.12 です。

---

## アーキテクチャ概要

```
lib.rs (setup)
  └─ runtime::initialize_runtime(app)      # OS 別ディスパッチ
       ├─ runtime/macos.rs                 # macOS: dylib をロード
       ├─ runtime/windows.rs               # Windows: DLL をロード
       └─ runtime/linux.rs                 # Linux: .so をロード

ai/wd_tagger.rs   ─┐
ai/joytag.rs      ─┘  # OS を一切知らない。Session::builder() のみ使用。
```

`ort` の `load-dynamic` feature を使用するため、ライブラリはビルド時にリンクされず、
起動時に `ort::init_from(path)` で明示的に `dlopen` / `LoadLibrary` される。

---

## バージョン管理

```
src-tauri/ort.version   ← バージョン番号を 1 行で記載 (例: 1.20.1)
```

- ここが単一の真実の源 (single source of truth)
- CI・ダウンロードスクリプト・ドキュメントはすべてこのファイルを参照する
- バージョンを上げる場合は `pnpm update:onnxruntime -- --version <new>` を実行すると
  ファイルも自動更新される

**ort 2.0.0-rc.12 が要求する ORT C API バージョン: 17 以上 (ORT 1.17+)**

---

## 開発環境セットアップ

### macOS

```bash
# ORT バイナリをダウンロード (universal2: Intel + Apple Silicon 両対応)
pnpm update:onnxruntime

# または手動配置
# src-tauri/libs/macos/libonnxruntime.dylib を置く
```

ダウンロード後は `pnpm tauri dev` でそのまま起動できる。
ORT は `src-tauri/libs/macos/libonnxruntime.dylib` → `resource_dir()` にバンドルされる。

**代替 (環境変数):**

```bash
# .cargo/config.toml または export で設定
ORT_LIB_LOCATION=/path/to/dir  # libonnxruntime.dylib が入ったディレクトリ
pnpm tauri dev
```

### Windows

```bash
pnpm update:onnxruntime
# src-tauri/libs/windows/onnxruntime.dll が配置される
pnpm tauri dev
```

**代替 (環境変数):**

```powershell
$env:ORT_LIB_LOCATION = "C:\path\to\dir"   # onnxruntime.dll が入ったディレクトリ
pnpm tauri dev
```

### Linux

```bash
pnpm update:onnxruntime
# src-tauri/libs/linux/libonnxruntime.so が配置される
pnpm tauri dev
```

**代替 (環境変数):**

```bash
ORT_LIB_LOCATION=/path/to/dir  # libonnxruntime.so が入ったディレクトリ
pnpm tauri dev
```

---

## バンドル設定

`tauri.conf.json` には ORT の resources を **書かない**。
代わりに `pnpm update:onnxruntime` が実行後に `src-tauri/tauri.ort.conf.json` を自動生成する。

```json
// src-tauri/tauri.ort.conf.json (auto-generated, .gitignore 済み)
// macOS の場合:
{ "bundle": { "resources": { "libs/macos/libonnxruntime.dylib": "./" } } }
```

リリースビルド時は Tauri のコンフィグマージ機能を使って結合する:

```bash
pnpm tauri build --config src-tauri/tauri.ort.conf.json
```

この設計により:
- `tauri.conf.json` に resources を書かないため `cargo check` がファイル存在チェックで失敗しない
- CI のテストジョブ (`ci.yml`) はORT ダウンロード不要
- ORT が存在するときのみ bundle に含まれる (明示的なエラーで失敗)

---

## ランタイム初期化の探索順序

### macOS (`runtime/macos.rs`)

| 優先度 | パス | 用途 |
|--------|------|------|
| 1 | `$resource_dir/libonnxruntime.dylib` | 本番 (bundle.resources) |
| 2 | `$resource_dir/../Frameworks/libonnxruntime.dylib` | 本番 (bundle.macOS.frameworks) |
| 3 | `$ORT_LIB_LOCATION/libonnxruntime.dylib` | 開発環境 |
| - | 見つからない場合 | `Err(...)` でアプリ起動失敗 |

### Windows (`runtime/windows.rs`)

| 優先度 | パス | 用途 |
|--------|------|------|
| 1 | `$resource_dir/onnxruntime.dll` | 本番 (bundle.resources) |
| 2 | `$ORT_LIB_LOCATION/onnxruntime.dll` | 開発環境 |
| - | 見つからない場合 | `Err(...)` でアプリ起動失敗 |

### Linux (`runtime/linux.rs`)

| 優先度 | パス | 用途 |
|--------|------|------|
| 1 | `$resource_dir/libonnxruntime.so` | 本番 (bundle.resources) |
| 2 | `$ORT_LIB_LOCATION/libonnxruntime.so` | 開発環境 |
| - | 見つからない場合 | `Err(...)` でアプリ起動失敗 |

---

## CI/CD フロー (GitHub Actions)

### リリース (`release.yml`)

```
git push tag v1.x.y
  └─ create-release ジョブ (GitHub Release 下書き作成)
       └─ build-tauri ジョブ (matrix: macOS/Windows/Linux)
            ├─ pnpm install
            ├─ pnpm update:onnxruntime   ← ORT バイナリ + tauri.ort.conf.json を生成
            ├─ pnpm tauri icon ...
            └─ tauri-apps/tauri-action  ← ビルド・署名・アップロード
                 args: --config src-tauri/tauri.ort.conf.json
  └─ publish-release ジョブ (下書き → 公開)
```

各 OS のランナーで `pnpm update:onnxruntime` が実行され、そのランナーの OS 向け
バイナリのみをダウンロードする (macOS ランナー → universal2 dylib、等)。

### CI (`ci.yml`)

`cargo check` / `cargo test` は ORT バイナリなしで通る (ユニットテストは
前処理とタグロードのみをテストし、実際の推論は行わない)。
そのため CI では ORT ダウンロードステップは不要。

---

## バージョンアップ手順

1. 互換性確認:
   ```bash
   # ort-sys の ORT_API_VERSION を確認
   cargo tree -p ort-sys
   # 要求 API バージョン以上の ORT リリースを選択
   ```

2. 新バージョンをダウンロード・テスト:
   ```bash
   pnpm update:onnxruntime -- --version 1.21.0
   # src-tauri/libs/macos/libonnxruntime.dylib と tauri.ort.conf.json が生成される
   pnpm tauri build --config src-tauri/tauri.ort.conf.json  # ビルド確認
   ```

3. バージョンファイルを確定:
   ```bash
   pnpm update:onnxruntime -- --all --version 1.21.0
   # ↑ --all で全プラットフォーム向けをダウンロード + ort.version を更新
   git add src-tauri/ort.version
   git commit -m "chore: ORT を 1.21.0 にアップデート"
   ```

---

## ファイル構成

```
chuck-snap-stack/
├── src-tauri/
│   ├── ort.version                    ← ORT バージョン (単一管理点)
│   ├── libs/
│   │   ├── macos/
│   │   │   ├── .gitkeep
│   │   │   └── libonnxruntime.dylib   ← .gitignore 済 (ダウンロードで生成)
│   │   ├── windows/
│   │   │   ├── .gitkeep
│   │   │   └── onnxruntime.dll        ← .gitignore 済
│   │   └── linux/
│   │       ├── .gitkeep
│   │       └── libonnxruntime.so      ← .gitignore 済
│   └── src/
│       ├── runtime/
│       │   ├── mod.rs
│       │   ├── macos.rs
│       │   ├── windows.rs
│       │   └── linux.rs
│       └── ai/
│           ├── mod.rs
│           ├── wd_tagger.rs
│           └── joytag.rs
└── scripts/
    └── update-onnxruntime.mjs         ← ダウンロード自動化スクリプト
```

---

## トラブルシューティング

### `{lib} が見つかりません` エラーでアプリが起動しない

```bash
pnpm update:onnxruntime
```

### `ORT_LIB_LOCATION` を設定したが読み込まれない

ディレクトリパスを指定する (ファイルパスではなく):

```bash
# ✓ 正しい
ORT_LIB_LOCATION=/usr/local/lib

# ✗ 誤り
ORT_LIB_LOCATION=/usr/local/lib/libonnxruntime.dylib
```

### CI でビルドが失敗する (ORT ライブラリ未配置)

`release.yml` に `pnpm update:onnxruntime` ステップが含まれているか確認する。
`bundle.resources` のグロブパターンはファイル未存在でも `tauri build` は通るが、
ランタイムでアプリが起動失敗する。

### macOS でのコード署名

ORT dylib は Tauri のバンドルプロセスで自動的に `.app` バンドル内に含まれ、
`tauri-apps/tauri-action` が署名・公証処理を行う。
個別に dylib を署名する必要はない。
