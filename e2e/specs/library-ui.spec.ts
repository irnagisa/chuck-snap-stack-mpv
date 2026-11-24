/**
 * ライブラリ UI テスト: フィルターバー・表示モード切り替え・サイドバー
 *
 * DB 初期化完了後にフィルターバーが描画されるため、before フックで待機する。
 */
describe('Chuck Snap Stack - Library UI', () => {
  before(async () => {
    // ライブラリビューに遷移し、DB 準備完了まで待機 (「絞り込み」ボタンの出現で判定)
    const libBtn = await $('button=ライブラリ')
    await libBtn.click()
    await $('button[title="絞り込み"]').waitForExist({ timeout: 15000 })
  })

  // ────────────────────────────────────────────
  // フィルターバー
  // ────────────────────────────────────────────
  describe('フィルターバー', () => {
    it('ソートセレクトに「追加日」「長さ」「評価」の選択肢がある', async () => {
      // Radix Select: トリガーを開くと role="option" の選択肢が出る
      await (await $('button[title="並び順"]')).click()
      await expect(await $('[role="option"]*=追加日')).toExist()
      await expect(await $('[role="option"]*=長さ')).toExist()
      await expect(await $('[role="option"]*=評価')).toExist()
      await browser.keys('Escape')
    })

    it('ソート順切り替えボタンが存在する', async () => {
      // ソート順ボタンのタイトルは「降順 (クリックで昇順)」または「昇順 (クリックで降順)」
      const descBtn = await $('button[title*="降順"]')
      const ascBtn = await $('button[title*="昇順"]')
      const descExists = await descBtn.isExisting()
      const ascExists = await ascBtn.isExisting()
      expect(descExists || ascExists).toBe(true)
    })

    describe('絞り込みポップオーバー', () => {
      before(async () => {
        await (await $('button[title="絞り込み"]')).click()
        await $('[role="dialog"]').waitForExist({ timeout: 5000 })
      })

      after(async () => {
        await browser.keys('Escape')
      })

      it('評価フィルターが存在する', async () => {
        await expect(await $('[role="radiogroup"][aria-label="評価フィルタ"]')).toExist()
      })

      it('音声フィルターが存在する', async () => {
        await expect(await $('[role="radiogroup"][aria-label="音声フィルタ"]')).toExist()
      })

      it('視聴状態フィルターが存在する', async () => {
        await expect(await $('[role="radiogroup"][aria-label="視聴状態フィルタ"]')).toExist()
      })

      it('メディアタイプフィルターが存在する', async () => {
        await expect(await $('[role="radiogroup"][aria-label="メディアタイプフィルタ"]')).toExist()
      })

      it('最短・最長秒数の数値入力欄が存在する', async () => {
        await expect(await $('input[title="最小長さ (秒)"]')).toExist()
        await expect(await $('input[title="最大長さ (秒)"]')).toExist()
      })
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
  // サイドバー (折りたためるセクション)
  // ────────────────────────────────────────────
  describe('サイドバー', () => {
    it('プレイリスト・カテゴリ・フォルダのセクションが並んで表示される', async () => {
      await expect(await $('section[aria-label="プレイリスト"]')).toExist()
      await expect(await $('section[aria-label="カテゴリ"]')).toExist()
      await expect(await $('section[aria-label="フォルダ"]')).toExist()
    })

    it('セクションの見出しで折りたたみと展開ができる', async () => {
      const toggle = await $('section[aria-label="フォルダ"] button[aria-expanded]')
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    })

    it('「すべて」で絞り込みを解除できる', async () => {
      const all = await $('nav[aria-label="ライブラリのナビゲーション"]').$('button=すべて')
      await all.click()
      await expect(all).toHaveAttribute('aria-current', 'true')
    })
  })
})
