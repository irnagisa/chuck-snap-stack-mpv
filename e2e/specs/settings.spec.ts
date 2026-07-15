/**
 * ヘッダーボタン・設定パネルのテスト
 *
 * ヘッダーは全ビューで常に表示されるため、ビューを問わず実行できる。
 */
describe('Chuck Snap Stack - Settings & Header', () => {
  // ────────────────────────────────────────────
  // ヘッダーボタン
  // ────────────────────────────────────────────
  describe('ヘッダーボタン', () => {
    it('検索入力欄が存在し正しいプレースホルダーが設定されている', async () => {
      const searchInput = await $('input[placeholder="ファイルを検索..."]')
      await expect(searchInput).toExist()
    })

    it('統計ダッシュボードボタンが存在する', async () => {
      await expect(await $('button[title="統計ダッシュボード"]')).toExist()
    })

    it('エクスポート / インポートボタンが存在する', async () => {
      await expect(await $('button[title="エクスポート / インポート"]')).toExist()
    })

    it('重複動画検出ボタンが存在する', async () => {
      await expect(await $('button[title="重複動画を検出"]')).toExist()
    })

    it('欠損ファイル検出ボタンが存在する', async () => {
      await expect(await $('button[title="欠損・破損ファイルを検出"]')).toExist()
    })

    it('設定ボタンが存在する', async () => {
      await expect(await $('button[title="設定"]')).toExist()
    })

    it('URL ダウンロードボタンが存在する', async () => {
      // ボタンテキストは "↓ URL" (t("app.downloadUrl"))
      const downloadBtn = await $('button*=URL')
      await expect(downloadBtn).toExist()
    })
  })

  // ────────────────────────────────────────────
  // 設定パネル
  // ────────────────────────────────────────────
  describe('設定パネル', () => {
    afterEach(async () => {
      // テスト後に設定パネルが開いたままの場合はキャンセルで閉じる
      const settingsPanel = await $('h2=設定')
      if (await settingsPanel.isExisting()) {
        const cancelBtn = await $('button=キャンセル')
        if (await cancelBtn.isExisting()) {
          await cancelBtn.click()
        }
      }
    })

    it('設定ボタンをクリックするとパネルが開く', async () => {
      const settingsBtn = await $('button[title="設定"]')
      await settingsBtn.click()
      const settingsTitle = await $('h2=設定')
      await expect(settingsTitle).toExist()
    })

    it('キャンセルボタンで設定パネルを閉じられる', async () => {
      const settingsBtn = await $('button[title="設定"]')
      await settingsBtn.click()
      await expect(await $('h2=設定')).toExist()

      const cancelBtn = await $('button=キャンセル')
      await cancelBtn.click()
      await expect(await $('h2=設定')).not.toExist()
    })

    it('テーマ切り替えボタン (ライト / ダーク / 自動) が存在する', async () => {
      await (await $('button[title="設定"]')).click()
      await expect(await $('button=ライト')).toExist()
      await expect(await $('button=ダーク')).toExist()
      await expect(await $('button=自動')).toExist()
    })

    it('mpv パス入力欄が存在する', async () => {
      await (await $('button[title="設定"]')).click()
      const mpvInput = await $('input[placeholder="/opt/homebrew/bin/mpv"]')
      await expect(mpvInput).toExist()
    })

    it('自動再生・AI タグのトグルスイッチが存在する', async () => {
      await (await $('button[title="設定"]')).click()
      // autoPlayNext と aiEnabled のトグル (role="switch")
      const switches = await $$('button[role="switch"]')
      expect(switches.length).toBeGreaterThanOrEqual(2)
    })

    it('キーボードショートカット変更ボタンが複数存在する', async () => {
      await (await $('button[title="設定"]')).click()
      // 各アクション (一時停止/再生・5秒進む…) に「変更」ボタンが並ぶ
      const changeButtons = await $$('button=変更')
      expect(changeButtons.length).toBeGreaterThan(0)
    })

    it('カテゴリモードの Virtual / Sync ラジオボタンが存在する', async () => {
      await (await $('button[title="設定"]')).click()
      const radios = await $$('input[name="category-mode"]')
      expect(radios.length).toBe(2)
    })

    it('AI モデル選択のラジオボタンが存在する', async () => {
      await (await $('button[title="設定"]')).click()
      const radios = await $$('input[name="ai-model-type"]')
      expect(radios.length).toBe(2)
    })
  })
})
