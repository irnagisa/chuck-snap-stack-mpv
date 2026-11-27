#!/usr/bin/env bash
# Chuck Snap Stack を「テスト用の識別子」でビルドし、WebdriverIO で操作する。
# 本物のライブラリ (com.irnagisa.chuck-snap-stack) には触れない。
#
#   driver.sh build              テスト用識別子でデバッグビルド (画面を同梱)
#   driver.sh run <spec.ts>      空のライブラリでアプリを起動し、spec を実行 (前後でテスト用データを消す)
#   driver.sh clean              テスト用識別子のデータ (App Support / Caches / WebKit) を消す
#   driver.sh restore            通常の識別子でデバッグビルドし直す (pnpm test:e2e 用)
#
# スクリーンショットは $OUT (既定: /tmp/chuck-snap-stack-run) に出る。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SKILL_DIR="$ROOT/.claude/skills/run-chuck-snap-stack"
TEST_ID="com.irnagisa.chuck-snap-stack.e2etest"
BIN="$ROOT/src-tauri/target/debug/chuck-snap-stack"
export OUT="${OUT:-/tmp/chuck-snap-stack-run}"
cd "$ROOT"

test_dirs() {
  printf '%s\n' \
    "$HOME/Library/Application Support/$TEST_ID" \
    "$HOME/Library/Caches/$TEST_ID" \
    "$HOME/Library/WebKit/$TEST_ID"
}

clean() {
  while IFS= read -r d; do [ -e "$d" ] && rm -rf "$d" && echo "removed $d"; done < <(test_dirs)
  return 0
}

assert_test_build() {
  [ -x "$BIN" ] || { echo "no binary: run '$0 build' first" >&2; exit 1; }
  # strings | grep -q は pipefail だと SIGPIPE で失敗扱いになるので、バイナリを直接探す
  if ! grep -qa "$TEST_ID" "$BIN"; then
    echo "ABORT: $BIN is not the test-identifier build (it would use the real library). Run '$0 build'." >&2
    exit 1
  fi
}

assert_no_running_app() {
  # 埋め込み WebDriver は先に起動しているインスタンス (pnpm tauri dev 等) につながってしまう
  if pgrep -f 'target/(debug|release)/chuck-snap-stack|Chuck Snap Stack.app' >/dev/null; then
    echo "ABORT: another Chuck Snap Stack is running (e.g. 'pnpm tauri dev'). Quit it first:" >&2
    pgrep -fl 'chuck-snap-stack' >&2
    exit 1
  fi
}

case "${1:-}" in
  build)
    pnpm tauri build --debug --no-bundle --config "{\"identifier\":\"$TEST_ID\"}"
    ;;
  run)
    spec="${2:?usage: driver.sh run <spec.ts>}"
    spec="$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")"
    assert_test_build
    assert_no_running_app
    clean
    mkdir -p "$OUT"
    # spec 側で起動前に置きたいファイルがあれば SEED_THUMB=1 でサムネイルの孤児を 1 つ置く
    if [ "${SEED_THUMB:-0}" = 1 ]; then
      t="$HOME/Library/Application Support/$TEST_ID/thumbnails/zz"
      mkdir -p "$t" && head -c 5000 /dev/urandom > "$t/orphan-test.webp" && touch -t 202001010000 "$t/orphan-test.webp"
    fi
    set +e
    SPEC="$spec" ./node_modules/.bin/wdio run "$SKILL_DIR/wdio.run.conf.ts" 2>&1 \
      | grep -v 'core.invoke not available' | grep -v '^\[0-0\]     at '
    status=${PIPESTATUS[0]}
    set -e
    clean
    echo "screenshots: $OUT"
    exit "$status"
    ;;
  clean)
    clean
    ;;
  restore)
    pnpm test:e2e:build
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
