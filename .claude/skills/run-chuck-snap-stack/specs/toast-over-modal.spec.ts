// 例: モーダルの上のトーストを押してもモーダルが閉じないこと
//   SEED_THUMB=1 .claude/skills/run-chuck-snap-stack/driver.sh run .claude/skills/run-chuck-snap-stack/specs/toast-over-modal.spec.ts
// SEED_THUMB=1 で使われていないサムネイルを 1 つ置き、「サムネイルを整理」で本物のトーストを出す
import { assertIsolated, clickAt, dialogCount, openTool, rectOf, shot, waitRect } from '../helpers'

const TOAST = '[data-floating-layer] [data-tone]'

describe('toast over modal', () => {
  it('clicking a toast keeps the modal open; clicking the backdrop closes it', async () => {
    await assertIsolated()

    await openTool('ストレージ整理')
    await browser.waitUntil(async () => (await dialogCount()) > 0, { timeout: 20000 })
    await browser.waitUntil(async () => {
      const b = await $('button*=サムネイルを整理')
      return (await b.isExisting()) && (await b.isEnabled())
    }, { timeout: 30000 })
    await shot('1-modal')
    await $('button*=サムネイルを整理').click()

    const body = await waitRect(`${TOAST} span:nth-child(2)`)
    console.log('TOAST:', body.text)
    await clickAt(body.x, body.y)
    await browser.pause(200)
    await shot('2-after-toast-body-click')
    expect(await dialogCount()).toBe(1)

    const close = await rectOf(`${TOAST} button[aria-label="閉じる"]`)
    if (!close) throw new Error('toast disappeared before clicking its close button')
    await clickAt(close.x, close.y)
    await browser.pause(800)
    await shot('3-after-toast-close')
    expect(await dialogCount()).toBe(1)
    expect(await rectOf(TOAST)).toBeNull()

    // 対照: 背景を押すと閉じる
    await clickAt(15, 400)
    await browser.pause(1000)
    await shot('4-after-backdrop-click')
    expect(await dialogCount()).toBe(0)
  })
})
