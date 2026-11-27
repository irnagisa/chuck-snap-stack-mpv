/**
 * ナビゲーションテスト: ホーム・ライブラリ間の遷移を検証する
 */
describe('Chuck Snap Stack - Navigation', () => {
  it('ライブラリビューに遷移するとフィルターバーが表示される', async () => {
    const libBtn = await $('button=ライブラリ')
    await libBtn.click()
    // LibraryFilterBar の「絞り込み」ボタンはライブラリビューにのみ存在する
    const ratingFilter = await $('button[title="絞り込み"]')
    await expect(ratingFilter).toExist()
  })

  it('ホームビューに遷移するとライブラリサマリーが表示される', async () => {
    const homeBtn = await $('button=ホーム')
    await homeBtn.click()
    // NewItemsCard が h2 "ライブラリ" を持つ (ホームビュー固有)
    const homeHeading = await $('h2=ライブラリ')
    await expect(homeHeading).toExist()
    // ライブラリのフィルターバーは表示されていない
    const ratingFilter = await $('button[title="絞り込み"]')
    await expect(ratingFilter).not.toExist()
  })

  it('ライブラリの「新着」で新着だけに絞り込める', async () => {
    const libBtn = await $('button=ライブラリ')
    await libBtn.click()
    const newBtn = await $('button*=新着')
    await expect(newBtn).toHaveAttribute('aria-pressed', 'false')
    await newBtn.click()
    await expect(newBtn).toHaveAttribute('aria-pressed', 'true')
    await newBtn.click()
    await expect(newBtn).toHaveAttribute('aria-pressed', 'false')
  })
})
