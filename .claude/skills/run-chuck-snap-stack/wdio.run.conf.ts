// driver.sh run から使う。e2e/wdio.conf.ts を元に、spec を 1 つだけ・タイムアウト長めで実行する
import { config as base } from '../../../e2e/wdio.conf'

const spec = process.env.SPEC
if (!spec) throw new Error('SPEC env is required (use driver.sh run <spec.ts>)')

export const config = {
  ...base,
  specs: [spec],
  // tauri-service は要素の検索・クリックのたびに約 5 秒待つので、mocha の既定 60 秒では足りない
  mochaOpts: { ui: 'bdd', timeout: 900000 },
}
