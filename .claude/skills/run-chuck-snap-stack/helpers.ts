// spec から import する操作ヘルパー。
// tauri-service は $ / $$ / click などの前に毎回約 5 秒待つ (window.__TAURI__ が無いため)。
// browser.execute と browser.action は待たないので、急ぐ操作 (3 秒で消えるトースト等) はこちらで行う。
import { execFileSync } from 'child_process'
import { homedir } from 'os'

export const OUT = process.env.OUT ?? '/tmp/chuck-snap-stack-run'
export const TEST_DB = homedir() + '/Library/Application Support/com.irnagisa.chuck-snap-stack.e2etest/videos.db'

/** テスト用識別子の DB につながっていて、ライブラリと監視フォルダが空であることを確かめる。最初に必ず呼ぶ */
export async function assertIsolated() {
  await browser.pause(3000) // DB の初期化を待つ
  const counts = execFileSync('sqlite3', [
    TEST_DB,
    "select (select count(*) from videos) || ',' || (select count(*) from watch_dirs)",
  ]).toString().trim()
  if (counts !== '0,0') throw new Error(`ABORT: test DB is not empty (videos,watch_dirs=${counts})`)
}

export const shot = (name: string) => browser.saveScreenshot(`${OUT}/${name}.png`)

/** 開いているダイアログ (role=dialog) の数 */
export const dialogCount = () =>
  browser.execute(() => document.querySelectorAll('[role=dialog]').length)

/** CSS セレクタに合う最初の要素の中心座標と文字。無ければ null (待たない) */
export const rectOf = (selector: string) =>
  browser.execute((s) => {
    const el = document.querySelector(s) as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent ?? '' }
  }, selector)

/** セレクタの要素が現れるまで 50ms 間隔で待つ (execute なので速い) */
export async function waitRect(selector: string, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const r = await rectOf(selector)
    if (r) return r
    await browser.pause(50)
  }
  throw new Error(`not found: ${selector}`)
}

/** ビューポート座標を本物のポインタ操作でクリック (待たない) */
export const clickAt = (x: number, y: number) =>
  browser
    .action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' })
    .down()
    .up()
    .perform()

/** ヘッダー右のツールボタン (aria-label) を押す: 統計 / ストレージ整理 / 設定 など */
export const openTool = (label: string) => $(`button[aria-label="${label}"]`).click()
