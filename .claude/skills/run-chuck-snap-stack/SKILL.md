---
name: run-chuck-snap-stack
description: Build, run, and drive the Chuck Snap Stack Tauri desktop app (macOS) without touching the real library. Use when asked to run/start the app, confirm a UI change works in the real app, click through a modal/toast/menu, take a screenshot of the app, or write a quick WebdriverIO check against the running app.
---

Chuck Snap Stack は Tauri v2 のデスクトップアプリ。エージェントは
`.claude/skills/run-chuck-snap-stack/driver.sh` で **テスト用の識別子
(`com.irnagisa.chuck-snap-stack.e2etest`) でビルドしたアプリ** を起動し、
WebdriverIO の spec (埋め込み WebDriver: `tauri-plugin-wdio-webdriver`) で操作する。
空のライブラリで始まり、ユーザーの本物の DB・サムネイル・WebKit の保存領域には触れない。

パスはすべてリポジトリのルートから。macOS で確認済み (Linux では未確認)。

## 前提

- `pnpm install` 済み、Rust ツールチェーン、`sqlite3` (macOS 標準)
- **ユーザーの `pnpm tauri dev` や Chuck Snap Stack が起動していないこと。**
  driver は起動中のインスタンスを見つけると止まる。止めてよいかはユーザーに聞く

## 実行 (エージェント用)

```bash
D=.claude/skills/run-chuck-snap-stack
$D/driver.sh build        # テスト用識別子でデバッグビルド (初回 ~2.5 分、以降 ~20 秒)
SEED_THUMB=1 $D/driver.sh run $D/specs/toast-over-modal.spec.ts
$D/driver.sh restore      # 終わったら通常の識別子でビルドし直す (pnpm test:e2e が本物の識別子を前提にしているため)
```

- `run` は前後でテスト用識別子のデータ (`~/Library/{Application Support,Caches,WebKit}/com.irnagisa.chuck-snap-stack.e2etest`) を消す。毎回空のライブラリから始まる
- スクリーンショットは `$OUT` (既定 `/tmp/chuck-snap-stack-run/`) に出る。**撮ったら Read で見ること**
- `SEED_THUMB=1` は使われていないサムネイルを 1 つ置く (「ストレージ整理 → サムネイルを整理」で本物のトーストを出すため)
- 1 回の `run` は 1〜2 分かかる (下の「5 秒待ち」のため)

### spec の書き方

`specs/toast-over-modal.spec.ts` を写して書く。ヘルパーは `helpers.ts`:

| ヘルパー | 用途 |
|---|---|
| `assertIsolated()` | **最初に必ず呼ぶ。** テスト用 DB の動画・監視フォルダが 0 件でなければ止める |
| `openTool(label)` | ヘッダー右のボタンを aria-label で押す (`統計ダッシュボード` `ストレージ整理` `設定` など) |
| `dialogCount()` | 開いている `[role=dialog]` の数 |
| `waitRect(sel)` / `rectOf(sel)` | 要素の中心座標と文字 (待たない `execute` で取る) |
| `clickAt(x, y)` | 本物のポインタ操作で座標をクリック (待たない) |
| `shot(name)` | `$OUT/<name>.png` に保存 |

## 実行 (人が見る場合)

`pnpm tauri dev` でウィンドウが開く。本物のライブラリを使うので、エージェントの確認には使わない。

## 注意点

- **HOME を変えてもデータは分けられない。** Rust 側の app data は `$HOME` に従うが、WebKit の localStorage は本物の `~/Library/WebKit/` のまま使われる。画面側が保存していた監視フォルダの設定が引き継がれ、分けたつもりの DB に本物のフォルダを取り込んでしまった。分けるには識別子を変える (`driver.sh build` がやっている)
- **埋め込み WebDriver は先に起動していたインスタンスにつながる。** `pnpm tauri dev` が動いていると、テストの操作はそちら (本物のデータ) に行く。driver は起動中のアプリを見つけると止まる
- **`pnpm tauri dev` が作るバイナリは画面を同梱していない** (Vite の開発サーバーから読む)。dev を止めた後にそのバイナリを使うと画面が出ない。`tauri build --debug --no-bundle` で作り直す
- **`$` / `$$` / `click` は 1 回ごとに約 5 秒待たされる。** `@wdio/tauri-service` がコマンドの前に毎回ウィンドウのフォーカスを確かめ、`window.__TAURI__` が無い (withGlobalTauri off) ため 5 秒のタイムアウトまで待つ (`Tauri core.invoke not available after 5s timeout` の警告が出る。driver はこの行を消している)。`execute` と `action` は待たないので、トースト (3 秒で消える) のような急ぐ操作は `waitRect` + `clickAt` で行う。mocha のタイムアウトは `wdio.run.conf.ts` で 15 分にしてある
- 要素を見つけた直後でも、モーダルの中身が読み込み直されると要素が作り直されて `element wasn't found` になる。押す直前に `$()` で取り直す
- WebdriverIO の `*=テキスト` セレクタは CSS と混ぜられない (`'[data-floating-layer] *=…'` は SyntaxError)。`$('[data-floating-layer]').$('span*=…')` のようにつなぐか、CSS だけにする
- 本物の DB にテストが触れていないかは `~/Library/Application Support/com.irnagisa.chuck-snap-stack/videos.db` の件数と更新日時で確かめられる

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `ABORT: … is not the test-identifier build` | `driver.sh build` を実行する (`restore` や `pnpm tauri dev` の後は通常の識別子になっている) |
| `ABORT: another Chuck Snap Stack is running` | ユーザーに dev / アプリを終了してもらう |
| `ABORT: test DB is not empty` | 分けたはずのデータに何か入っている。続けずに原因を調べる |
| `Timeout of 60000ms exceeded` | 5 秒待ちが積み重なった。`wdio.run.conf.ts` を通さずに走らせていないか確認 |
| 撮った画面に本物のライブラリ (タグ・カテゴリ・件数) が写る | すぐ止める。別のインスタンスにつながっているか、識別子が通常のまま |

## テスト

```bash
pnpm vitest run src/components/ui/ui.test.tsx   # ユニットテスト (例)
```
