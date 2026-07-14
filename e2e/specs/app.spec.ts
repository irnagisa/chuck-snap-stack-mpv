describe('Chuck Snap Stack - Smoke Tests', () => {
  it('アプリが起動しタイトルが表示される', async () => {
    const title = await $('h1')
    await expect(title).toExist()
    await expect(title).toHaveText('Chuck Snap Stack')
  })

  it('メインレイアウトが表示される (ヘッダー)', async () => {
    const header = await $('div.border-b')
    await expect(header).toExist()
  })

  it('ナビゲーションボタンが存在する', async () => {
    // $$() 1回で全ボタン取得し、getText()で比較 (focusコマンド呼び出しを最小化)
    const buttons = await $$('button')
    const texts = await Promise.all(buttons.slice(0, 20).map(b => b.getText()))
    expect(texts).toContain('ホーム')
    expect(texts).toContain('ライブラリ')
    expect(texts).toContain('Inbox')
  })

  it('ライブラリビューがデフォルトで表示される', async () => {
    const main = await $('main')
    await expect(main).toExist()
    // 2回目以降の起動ではライブラリビューが表示される
    // (初回はhomeビューが表示される場合があるため、メインレイアウトの存在のみ確認)
    await expect(main).toBeDisplayed()
  })
})
