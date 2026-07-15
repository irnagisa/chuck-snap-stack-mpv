/**
 * ライブラリ UI テスト: フィルターバー・表示モード切り替え・サイドバータブ
 *
 * DB 初期化完了後にフィルターバーが描画されるため、before フックで待機する。
 */
describe('Chuck Snap Stack - Library UI', () => {
  before(async () => {
    // ライブラリビューに遷移し、DB 準備完了まで待機 (評価フィルターセレクトの出現で判定)
    const libBtn = await $('button=ライブラリ')
    await libBtn.click()
    await $('select[title="評価フィルタ"]').waitForExist({ timeout: 15000 })
  })

  // ────────────────────────────────────────────
  // フィルターバー
  // ────────────────────────────────────────────
  describe('フィルターバー', () => {
    it('ソートセレクトに「追加日」「長さ」「評価」の選択肢がある', async () => {
      await expect(await $('option=追加日')).toExist()
      await expect(await $('option=長さ')).toExist()
      await expect(await $('option=評価')).toExist()
    })

    it('ソート順切り替えボタンが存在する', async () => {
      // ソート順ボタンのタイトルは「降順 (クリックで昇順)」または「昇順 (クリックで降順)」
      const descBtn = await $('button[title*="降順"]')
      const ascBtn = await $('button[title*="昇順"]')
      const descExists = await descBtn.isExisting()
      const ascExists = await ascBtn.isExisting()
      expect(descExists || ascExists).toBe(true)
    })

    it('評価フィルターセレクトが存在する', async () => {
      await expect(await $('select[title="評価フィルタ"]')).toExist()
    })

    it('音声フィルターセレクトが存在する', async () => {
      await expect(await $('select[title="音声フィルタ"]')).toExist()
    })

    it('視聴状態フィルターセレクトが存在する', async () => {
      await expect(await $('select[title="視聴状態フィルタ"]')).toExist()
    })

    it('メディアタイプフィルターセレクトが存在する', async () => {
      await expect(await $('select[title="メディアタイプフィルタ"]')).toExist()
    })

    it('最短・最長秒数の数値入力欄が存在する', async () => {
      await expect(await $('input[title="最小長さ (秒)"]')).toExist()
      await expect(await $('input[title="最大長さ (秒)"]')).toExist()
    })
  })

  // ────────────────────────────────────────────
  // 表示モード切り替え
  // ────────────────────────────────────────────
  describe('表示モード切り替え', () => {
    it('グリッド・リスト切り替えボタンが存在する', async () => {
      await expect(await $('button[title="グリッド表示"]')).toExist()
      await expect(await $('button[title="リスト表示"]')).toExist()
    })

    it('グリッドモードでカードサイズボタン (S/M/L/XL) が表示される', async () => {
      await (await $('button[title="グリッド表示"]')).click()
      for (const size of ['S', 'M', 'L', 'XL'] as const) {
        await expect(await $(`button[title="カードサイズ: ${size}"]`)).toExist()
      }
    })

    it('リストモードに切り替えるとグリッドサイズボタンが消え行サイズボタンが現れる', async () => {
      await (await $('button[title="リスト表示"]')).click()
      // グリッドサイズボタンは消える
      await expect(await $('button[title="カードサイズ: S"]')).not.toExist()
      // リストの行サイズボタンが表示される
      for (const size of ['S', 'M', 'L', 'XL'] as const) {
        await expect(await $(`button[title="行サイズ: ${size}"]`)).toExist()
      }
    })

    it('グリッドモードに戻すとグリッドサイズボタンが再表示される', async () => {
      await (await $('button[title="グリッド表示"]')).click()
      await expect(await $('button[title="カードサイズ: S"]')).toExist()
      // リストサイズボタンは消える
      await expect(await $('button[title="行サイズ: S"]')).not.toExist()
    })
  })

  // ────────────────────────────────────────────
  // サイドバータブ
  // ────────────────────────────────────────────
  describe('サイドバータブ', () => {
    it('カテゴリ・フォルダ・リストの 3 タブが表示される', async () => {
      await expect(await $('button=カテゴリ')).toExist()
      await expect(await $('button=フォルダ')).toExist()
      await expect(await $('button=リスト')).toExist()
    })

    it('フォルダタブに切り替えられる', async () => {
      const folderTab = await $('button=フォルダ')
      await folderTab.click()
      await expect(folderTab).toBeDisplayed()
    })

    it('プレイリストタブに切り替えられる', async () => {
      const listTab = await $('button=リスト')
      await listTab.click()
      await expect(listTab).toBeDisplayed()
    })

    it('カテゴリタブに戻れる', async () => {
      const categoryTab = await $('button=カテゴリ')
      await categoryTab.click()
      await expect(categoryTab).toBeDisplayed()
    })
  })
})
