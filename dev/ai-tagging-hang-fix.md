# AI タグ分析が「分析中」から返らない問題 — 根本原因と修正

## 症状

動画詳細の「タグを分析する」ボタンを押すと `分析中…` 表示のまま操作が返ってこない
（`AIモデルの読み込みがタイムアウトしました` を表示するようになった後も、実際にはタイムアウトまで
120 秒ハングし続けていた）。

## 経緯（調査の過程）

最初は以下を疑い、対処した:

1. フロントの `handleAnalyzeTags`（`VideoDetailModal.tsx:217`）は `try/finally` で堅牢 → Rust の
   `analyze_thumbnail_for_tags` コマンドが Promise を resolve/reject せず無限ブロックしていると判明。
2. `Cargo.toml` に `log = "0.4"`（facade）はあるが **ロガーバックエンドが一切未初期化**で、
   `log::info!` 系の診断ログは全てサイレントに握りつぶされていた。全て `eprintln!` に置き換えて
   可視化（`lib.rs` の ORT 初期化失敗時と同じ既存パターン）。
3. `WdTagger::load` / `JoyTagger::load` の `Session::builder()` に
   `with_optimization_level(Level1)` / `with_intra_threads(4)` / `with_parallel_execution(false)`
   を追加（後述の根本原因が判明する前の対症療法。無害だが本質的な効果はなかった）。
4. `analyze_thumbnail_for_tags` のモデルロード・推論を `tokio::time::timeout`（120秒）でガード
   （`block_in_place` → `spawn_blocking` に統一）。UI が永久ハングしないための独立した保険として有効。

## 根本原因（確定）

`eprintln!` を仕込んだ結果、ログは以下で止まることが判明:

```
[ai] モデルロード開始: kind=JoyTag
[joytag] load() 開始: ".../ai/joytag/model.onnx"
```

次に実行されるのは `JoyTagger::load()` 内の `Session::builder()` 呼び出しのみ。ここで
一切先に進まなくなっていた。

**切り分け実験**: 同じ dylib を Python の `ctypes.CDLL()` で単体 `dlopen()` したところ **0.01秒**
で完了。つまり `dlopen()` 自体は一瞬で終わり、ハングの原因ではない。

**ort クレートのソースを直接確認**した結果、`Session::builder()`
（= `SessionBuilder::new()`, `ort-2.0.0-rc.12/src/session/builder/mod.rs:130-131`）が
以下を**無条件に**呼んでいることが判明:

```rust
#[cfg(feature = "api-22")]
let _ = ortsys![@ort: unsafe SessionOptionsSetEpSelectionPolicy(session_options_ptr.as_ptr(), AutoDevicePolicy::MaxEfficiency.into()) as Result];
```

これは ONNX Runtime 1.22 で追加された **Auto EP Selection**（実行プロバイダの自動選択）機能で、
`MaxEfficiency` ポリシーを設定する際に内部でシステム上の EP/デバイスを列挙する。この列挙処理が
**Intel Mac + macOS Tahoe 環境で無限にハングする**（Session::builder() から一切復帰しない）。

`src-tauri/Cargo.toml` の `ort` 依存は `features = ["load-dynamic"]` のみを指定しており
`default-features` を無効化していなかったため、**デフォルトで `api-24`（→ 内部的に api-22 を含む）
が有効になっていた**。これが `SessionOptionsSetEpSelectionPolicy` 呼び出しをビルドに含めていた
直接の原因。

`with_execution_providers([ep::CPU::default().build()])` で CPU EP を明示していても、この
自動選択ポリシー設定は **`.with_execution_providers()` を呼ぶ「前」に `SessionBuilder::new()`
の中で** 強制的に走るため、CPU EP 指定では回避できない。

旧コードのコメント「CoreML EP は Intel Mac + macOS Tahoe でモデルコンパイルがハングするため除外」
は原因の特定としては微妙にズレていた（CoreML EP 自体は選択していない）が、「この環境の何らかの
EP/デバイス列挙処理がハングする」という直感は正しかった。

## 修正

`src-tauri/Cargo.toml`:

```toml
ort = { version = "=2.0.0-rc.12", default-features = false, features = ["std", "load-dynamic", "ndarray", "api-21"] }
```

`default-features = false` とし、`api-21` までに抑えることで `SessionOptionsSetEpSelectionPolicy`
の呼び出し自体をビルドから除外した。

**安全性の確認**:
- `with_execution_providers` / `with_optimization_level` / `with_intra_threads` /
  `with_parallel_execution` / `commit_from_file` / `session.run()` / `Tensor::from_array` /
  `try_extract_array` / `ep::CPU` — いずれも api-22 未満で利用可能（ソース上に api レベルの
  cfg ゲートなし）。
- api-22 以降でのみ追加される API（`edit_from_memory` / `opset_for_domain` / `LoadCanceler` /
  `EditableSession` / `with_auto_ep`）はコードベース内で未使用（grep で確認済み）。
- `cargo check` / `cargo test --lib ai::`（24 件）は全て成功。

## 副次的に直した/整理した箇所

- `src-tauri/src/commands/ai.rs`: `AI_STAGE_TIMEOUT`（120秒）でモデルロード・推論をそれぞれ
  `tokio::time::timeout` ガード。原因不明のハングが将来再発しても UI が復帰できるようにする保険。
- `src-tauri/src/ai/wd_tagger.rs` / `joytag.rs`: `Session::builder()` に
  `with_optimization_level(Level1)` / `with_intra_threads(4)` / `with_parallel_execution(false)`
  を追加（根本原因ではなかったが、害もないため残置）。
- 上記ファイル + `src-tauri/src/commands/ai.rs` + `src-tauri/src/runtime/macos.rs` +
  `src-tauri/src/lib.rs`: 切り分け用の `eprintln!` 診断ログ（`[wd_tagger]` / `[joytag]` / `[ai]` /
  `[runtime]` / `[runtime:macos]` プレフィックス）。根本原因が確定したので**今後削除してよい**
  （現状は残したまま様子見）。

## 検証

1. `cd src-tauri && cargo check && cargo test --lib ai::` — 完了、全テスト green。
2. `pnpm tauri dev` で実機確認: サムネイル付き動画の詳細を開き「タグを分析する」を押す。
   - WD Tagger / JoyTag 両方で完走し、タイムアウトせずタグ候補が返ることを確認する。
3. 確認が取れたら:
   - 診断用 `eprintln!` の削除（または `log` バックエンド導入の上で `debug!` に降格）。
   - `wd_tagger.rs` / `joytag.rs` の「CoreML EP は... ハングするため除外」コメントを、
     実際の原因（Auto EP Selection / api-22）に即した内容に更新する。
