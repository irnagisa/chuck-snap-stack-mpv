import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const binaryPath = join(__dirname, '../src-tauri/target/debug/chuck-snap-stack')

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: [join(__dirname, 'specs/**/*.spec.ts')],
  maxInstances: 1,
  capabilities: [{}],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: [['tauri', { appBinaryPath: binaryPath, driverProvider: 'embedded' }]],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
}
