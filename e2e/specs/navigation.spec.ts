/**
 * ナビゲーションテスト: ホーム・ライブラリ・Inbox 間の遷移を検証する
 */
describe('Chuck Snap Stack - Navigation', () => {
  it('ライブラリビューに遷移するとフィルターバーが表示される', async () => {
    const libBtn = await $('button=ライブラリ')
    await libBtn.click()
    // LibraryFilterBar の評価フィルターセレクト (title="評価フィルタ") はライブラリビューにのみ存在する
    const ratingFilter = await $('select[title="評価フィルタ"]')
    await expect(ratingFilter).toExist()
  })

  it('ホームビューに遷移するとライブラリサマリーが表示される', async () => {
    const homeBtn = await $('button=ホーム')
    await homeBtn.click()
    // InboxSummaryCard が h2 "ライブラリ" を持つ (ホームビュー固有)
    const homeHeading = await $('h2=ライブラリ')
    await expect(homeHeading).toExist()
    // ライブラリのフィルターバーは表示されていない
    const ratingFilter = await $('select[title="評価フィルタ"]')
    await expect(ratingFilter).not.toExist()
  })

  it('Inbox ビューに遷移すると Inbox ヘッダーが表示される', async () => {
    // Inbox ナビボタン (件数バッジが付く場合があるため部分一致)
    const inboxBtn = await $('button*=Inbox')
    await inboxBtn.click()
    // InboxView の h2 "Inbox"
    const inboxHeading = await $('h2=Inbox')
    await expect(inboxHeading).toExist()
  })

  it('ライブラリビューに戻ると Inbox ヘッダーが消える', async () => {
    const libBtn = await $('button=ライブラリ')
    await libBtn.click()
    const ratingFilter = await $('select[title="評価フィルタ"]')
    await expect(ratingFilter).toExist()
    const inboxHeading = await $('h2=Inbox')
    await expect(inboxHeading).not.toExist()
  })
})
