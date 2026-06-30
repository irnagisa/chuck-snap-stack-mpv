# Stack & Inbox 機能仕様

# コンセプト

Inbox は未整理ファイルの状態を表す。

Stack はファイルの所属先ではなく、Inbox を作業しやすく見せるための表示単位である。

Stack 自体は永続的なデータ構造ではない。

Stack は Inbox 上のファイルを動的にグループ化した結果として生成される。

```text
File
 ↓
Status = Inbox
 ↓
Inbox
 ↓
Grouping Strategy
 ↓
Stack View
```

Stack は「作業台の上に積まれた未整理ファイルの山」であり、カテゴリとは異なる。

---

# Inbox

Inbox は状態である。

```text
status = Inbox
```

新規追加されたファイルは全て Inbox 状態になる。

対象:

* Import
* Download
* Drag & Drop
* External Sync

カテゴリ設定、タグ設定、評価設定などの整理作業が完了するまで Inbox に所属する。

整理完了後は Inbox から除外される。

---

# Stack

Stack は Inbox の表示単位である。

Stack はテーブルや ID を持たない。

Stack は表示時に動的生成される。

Stack は複数の戦略で生成できる。

---

# Grouping Strategy

## Source Stack

source_type ごとにグループ化する。

例:

```text
yt-dlp
52 files

Import
20 files

Drag & Drop
8 files
```

---

## Session Stack

一定時間内に追加されたファイルをまとめる。

例:

```text
2026-06-23 20:15
YouTube Download

52 files
```

30分以上間隔が空く場合は別 Stack とする。

閾値は設定可能。

---

## Date Stack

日付単位でグループ化する。

例:

```text
Today
Yesterday
Last Week
```

---

## Missing Metadata Stack

不足している項目ごとにグループ化する。

例:

```text
Category Missing
18 files

Tag Missing
53 files

Rating Missing
104 files
```

同一ファイルが複数 Stack に所属してもよい。

---

## Almost Done Stack

あと1項目で整理完了となるファイル。

例:

```text
Almost Done

9 files
```

優先的に処理できる。

---

## Hold Stack

保留状態のファイル。

例:

```text
Hold

14 files
```

期限付き再表示にも対応する。

---

# Stack の性質

Stack は永続化しない。

以下は保持しない。

```text
stack_id
stack_table
stack_relation
```

Stack は

```sql
GROUP BY
```

の結果として生成される。

1ファイルのみの Stack が存在しても問題ない。

同一ファイルは複数の Stack に所属できる。

---

# Workbench

Inbox のメイン画面は Workbench と呼ぶ。

Workbench は Stack の集合で構成される。

```text
Workbench
├─ Source Stack
├─ Session Stack
├─ Missing Metadata Stack
├─ Almost Done Stack
└─ Hold Stack
```

ユーザーは一覧ではなく Stack 単位で整理作業を行う。

---

# Stack に対する操作

Stack 単位で以下を実行できる。

* カテゴリ設定
* タグ追加
* 評価設定
* 保留
* 一括移動
* 一括削除
* Undo

---

# Quick Sort

Stack を開くと連続整理モードへ移行できる。

```text
File

Category [Anime]

Tags [OP] [Music]

Rating ★★★★

Next
```

一覧へ戻らず連続処理できる。

---

# Work In Progress

途中まで整理した状態を保持する。

例:

```text
Now Working

Source Stack
yt-dlp

52 files

Current Position
18 / 52
```

アプリ終了後も復元できる。

---

# Inbox Completion

ライブラリ全体の進捗を表示する。

例:

```text
Total Files
12000

Inbox
421

Category Missing
84

Tag Missing
302

Rating Missing
191

Completion
96%
```

---

# 設計思想

Inbox は状態である。

Stack はデータではなくビューである。

Stack は「未整理ファイルの山」を表現する UI 概念であり、永続的な所属先ではない。

カテゴリはファイルの永続的な所属を表す。

Stack は整理作業を行うための作業単位を提供する。

ファイルを大量に一覧表示するのではなく、作業可能な塊として見せることを目的とする。

```text
Chuck
↓
放り込む

Snap
↓
内容を確認する

Stack
↓
作業台に積まれる

Sort
↓
カテゴリへ移動する
```
