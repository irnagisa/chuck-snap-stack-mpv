#!/usr/bin/env node
/**
 * update-onnxruntime.mjs
 *
 * ONNX Runtime 共有ライブラリを microsoft/onnxruntime の GitHub Releases から
 * ダウンロードし、src-tauri/libs/{platform}/ に配置する。
 *
 * 使用例:
 *   pnpm update:onnxruntime                    # 現在の OS のみ
 *   pnpm update:onnxruntime -- --all            # macOS + Windows + Linux 全部
 *   pnpm update:onnxruntime -- --version 1.21.0
 *   pnpm update:onnxruntime -- --all --version 1.21.0
 *
 * 取得するバージョンは src-tauri/ort.version に記録する (--version 指定時は上書き)。
 * ダウンロードしたバイナリは .gitignore 済みのため git にはコミットされない。
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LIBS_DIR = join(ROOT, 'src-tauri', 'libs');
const VERSION_FILE = join(ROOT, 'src-tauri', 'ort.version');

// ──────────────────────────────────────────────────────────────────────────────
// 引数パース
// ──────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const versionFlagIdx = args.indexOf('--version');
const allPlatforms = args.includes('--all');
const saveVersion = versionFlagIdx !== -1 && args[versionFlagIdx + 1];

let version;
if (versionFlagIdx !== -1 && args[versionFlagIdx + 1]) {
  version = args[versionFlagIdx + 1].trim();
} else {
  version = (await readFile(VERSION_FILE, 'utf8')).trim();
}

if (!version) {
  console.error('ERROR: バージョンが指定されていません。src-tauri/ort.version を確認するか --version を指定してください。');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────────
// プラットフォーム定義
// ──────────────────────────────────────────────────────────────────────────────
const PLATFORMS = {
  macos: {
    archive: `onnxruntime-osx-universal2-${version}.tgz`,
    extractedDir: `onnxruntime-osx-universal2-${version}`,
    libPattern: /libonnxruntime\.\d+\.\d+\.\d+\.dylib$/,
    destDir: 'macos',
    destName: 'libonnxruntime.dylib',
    extractMethod: 'tar',
  },
  windows: {
    archive: `onnxruntime-win-x64-${version}.zip`,
    extractedDir: `onnxruntime-win-x64-${version}`,
    libPattern: /^onnxruntime\.dll$/,
    destDir: 'windows',
    destName: 'onnxruntime.dll',
    extractMethod: 'zip',
  },
  linux: {
    archive: `onnxruntime-linux-x64-${version}.tgz`,
    extractedDir: `onnxruntime-linux-x64-${version}`,
    libPattern: /libonnxruntime\.so\.\d+\.\d+\.\d+$/,
    destDir: 'linux',
    destName: 'libonnxruntime.so',
    extractMethod: 'tar',
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ──────────────────────────────────────────────────────────────────────────────

/** 現在の OS に対応するプラットフォームキーを返す */
function currentPlatform() {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    case 'linux': return 'linux';
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

/** URL からファイルをストリームダウンロードし進捗を表示する */
async function downloadFile(url, dest) {
  console.log(`  Downloading: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}\n  URL: ${url}`);
  }
  const total = parseInt(response.headers.get('content-length') ?? '0', 10);
  let downloaded = 0;

  const writer = createWriteStream(dest);
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;

      if (total > 0) {
        const pct = Math.round((downloaded / total) * 100).toString().padStart(3);
        const dlMB = (downloaded / 1024 / 1024).toFixed(1).padStart(5);
        const totalMB = (total / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r  ${pct}%  ${dlMB} / ${totalMB} MB`);
      } else {
        const dlMB = (downloaded / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r  ${dlMB} MB`);
      }

      await new Promise((resolve, reject) => {
        writer.write(value, (err) => (err ? reject(err) : resolve()));
      });
    }
    process.stdout.write('\n');
  } finally {
    writer.destroy();
    await new Promise((resolve) => writer.on('close', resolve));
  }
}

/** 子プロセスを起動して完了を待つ */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, { stdio: 'inherit', ...opts });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd}\` exited with code ${code}`));
    });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`Command not found: ${cmd}\n  ${err.message}`));
      } else {
        reject(err);
      }
    });
  });
}

/** ディレクトリを再帰的に探索してパターンに一致するファイルパスを返す */
function findFile(dir, pattern) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(fullPath, pattern);
      if (found) return found;
    } else if (entry.isFile() && pattern.test(entry.name)) {
      return fullPath;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// プラットフォーム別インストール
// ──────────────────────────────────────────────────────────────────────────────

async function updatePlatform(platform) {
  const cfg = PLATFORMS[platform];
  const baseUrl = `https://github.com/microsoft/onnxruntime/releases/download/v${version}`;
  const url = `${baseUrl}/${cfg.archive}`;

  const tmpDir = join(tmpdir(), `ort-update-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. ダウンロード
    const archivePath = join(tmpDir, cfg.archive);
    await downloadFile(url, archivePath);

    // 2. 展開
    console.log(`  Extracting ${cfg.archive}...`);
    if (cfg.extractMethod === 'tar') {
      await run('tar', ['-xzf', archivePath, '-C', tmpDir]);
    } else {
      // Windows zip
      if (process.platform === 'win32') {
        await run('powershell', [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${tmpDir}' -Force`,
        ]);
      } else {
        // macOS / Linux で Windows cross build 向けにダウンロードする場合
        await run('unzip', ['-q', '-o', archivePath, '-d', tmpDir]);
      }
    }

    // 3. ライブラリファイルを探索
    const extractedDir = join(tmpDir, cfg.extractedDir);
    if (!existsSync(extractedDir)) {
      throw new Error(`展開先ディレクトリが見つかりません: ${extractedDir}\n  アーカイブ構造が変わった可能性があります。`);
    }
    const libPath = findFile(extractedDir, cfg.libPattern);
    if (!libPath) {
      throw new Error(
        `ライブラリファイルが見つかりません (pattern: ${cfg.libPattern})\n  展開先: ${extractedDir}`
      );
    }

    // 4. 配置先へコピー
    const destDir = join(LIBS_DIR, cfg.destDir);
    mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, cfg.destName);
    copyFileSync(libPath, destPath);
    console.log(`  Installed: src-tauri/libs/${cfg.destDir}/${cfg.destName}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// メイン
// ──────────────────────────────────────────────────────────────────────────────

const targets = allPlatforms
  ? ['macos', 'windows', 'linux']
  : [currentPlatform()];

console.log(`ONNX Runtime ${version}  (${targets.join(', ')})`);
console.log('');

let hasError = false;
for (const platform of targets) {
  console.log(`[${platform}]`);
  try {
    await updatePlatform(platform);
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    hasError = true;
  }
  console.log('');
}

if (hasError) {
  console.error('一部のプラットフォームでエラーが発生しました。');
  process.exit(1);
}

// --version 指定時はバージョンファイルを更新
if (saveVersion) {
  writeFileSync(VERSION_FILE, `${version}\n`);
  console.log(`ort.version を ${version} に更新しました。`);
}

// 現在の OS 向けの Tauri バンドル用マージ設定ファイルを生成する。
// tauri build --config src-tauri/tauri.ort.conf.json で使用する。
// (tauri.conf.json に resources を直接書くと cargo check 時にファイル存在チェックで失敗するため)
if (!hasError) {
  const host = currentPlatform();
  const cfg = PLATFORMS[host];
  const ortConfPath = join(ROOT, 'src-tauri', 'tauri.ort.conf.json');
  const resourceKey = `libs/${cfg.destDir}/${cfg.destName}`;
  // 宛先はディレクトリ ("./") ではなくファイル名にする必要がある。
  // tauri-build がリソースコピーに fs::copy(src, dest) を使うため、
  // dest がディレクトリだと "Is a directory (os error 21)" で失敗する。
  const ortConf = { bundle: { resources: { [resourceKey]: cfg.destName } } };
  writeFileSync(ortConfPath, JSON.stringify(ortConf, null, 2) + '\n');
  console.log(`tauri.ort.conf.json を生成しました (${resourceKey} → ${cfg.destName})。`);
  console.log('リリースビルド: pnpm tauri build --config src-tauri/tauri.ort.conf.json');
}

console.log('完了。');
if (!allPlatforms) {
  console.log('ヒント: --all を付けると全プラットフォーム向けをまとめてダウンロードできます。');
}
