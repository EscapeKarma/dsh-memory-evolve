#!/usr/bin/env node
// 构建「预构建发布包」，供 GitHub Release 与插件市场使用。
//
// 产出两个文件（都在 dist/ 下）：
//   1. <package-name>-<version>.tgz —— 带版本号，便于按版本核对与人工下载；
//   2. <package-name>.tgz           —— 稳定名，市场的 tarball 字段指向
//      https://github.com/<owner>/<repo>/releases/latest/download/<package-name>.tgz
//      ，这样每次发版不必再改目录条目。
//
// 用法：pnpm pack:release 或者 node scripts/pack-release.mjs
// 之后把两个文件都上传到同一个 Release：
//   gh release upload v<version> dist/<package-name>-<version>.tgz dist/<package-name>.tgz --clobber

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

function readPackageJson() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
}

// DSH 桌面自带运行时里有 pnpm，但默认不在 PATH 上；找不到 pnpm/npm 时退回到它。
function findBundledPnpm() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  if (!home) return null;
  const runtimes = join(home, '.dsh', 'dsh-runtimes');
  let dirs = [];
  try {
    dirs = readdirSync(runtimes, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(runtimes, d.name, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'));
  } catch {
    return null;
  }
  return dirs.find((p) => existsSync(p)) ?? null;
}

function runPack() {
  // Windows 上 pnpm/npm 是 .cmd 包装，Node 24 起必须经 shell 才能执行；
  // 传整串命令而不是「命令 + 参数数组」，避免 DEP0190（参数不转义）。
  const attempts = [
    [`pnpm pack --pack-destination "${DIST}"`, 'pnpm'],
    [`npm pack --pack-destination "${DIST}"`, 'npm'],
  ];
  const errors = [];
  for (const [command, label] of attempts) {
    const r = spawnSync(command, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
    });
    if (r.error) {
      errors.push(`${label}: ${r.error.code ?? r.error.message}`);
      continue;
    }
    if (r.status === 0) return label;
    errors.push(`${label}: exit ${r.status}`);
  }

  const bundled = findBundledPnpm();
  if (bundled !== null) {
    const r = spawnSync(process.execPath, [bundled, 'pack', '--pack-destination', DIST], {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (!r.error && r.status === 0) return 'DSH 自带 pnpm';
    errors.push(`DSH 自带 pnpm: ${r.error?.code ?? `exit ${r.status}`}`);
  }

  console.error('打包失败，试过 pnpm / npm / DSH 自带 pnpm：');
  for (const e of errors) console.error('  -', e);
  console.error('请先安装 npm 或 pnpm，或手动运行 `npm pack --pack-destination dist`。');
  process.exit(1);
}

function main() {
  const pkg = readPackageJson();
  const version = String(pkg.version ?? '').trim();
  if (!version) {
    console.error('package.json 没有 version，先补上再打包。');
    process.exit(1);
  }

  mkdirSync(DIST, { recursive: true });
  const used = runPack();

  const base = String(pkg.name ?? '').replace(/^@/, '').replace(/[/\\]/g, '-');
  const versioned = join(DIST, `${base}-${version}.tgz`);
  const stable = join(DIST, `${base}.tgz`);

  if (!existsSync(versioned)) {
    console.error(`没找到打包产物：${versioned}`);
    process.exit(1);
  }

  copyFileSync(versioned, stable);

  const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
  console.log('');
  console.log(`打包完成（使用 ${used}）：`);
  console.log(`  ${versioned}  ${kb(versioned)}`);
  console.log(`  ${stable}  ${kb(stable)}  ← 稳定名，市场的 tarball 字段指向它`);
  console.log('');
  console.log(`下一步：`);
  console.log(`  gh release upload v${version} "${versioned}" "${stable}" --clobber`);
  console.log('');
  console.log(`市场条目里的 tarball 字段（一次配好，之后不必再改）：`);
  console.log(`  https://github.com/<owner>/<repo>/releases/latest/download/${base}.tgz`);
}

main();
