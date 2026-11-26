// 发版前自检：把仓库打成发布用的 tarball，解包，然后像用户那样「装上并跑起来」。
//
// 这个用例存在的理由：`files` 字段漏一项、产物没重建、worker 入口被挪走，本地全量测试
// 都发现不了——只有在「打包 → 解包 → 加载 → 跑 worker」这条链上才会暴露。
// 发版前跑一次，就能避免再出现 #110（发布包缺 scripts/sync-worker.mjs）那种事故。
//
// 打包器解析顺序：PATH 上的 pnpm → PATH 上的 npm → DSH 桌面自带的 pnpm。
// 三者都没有时整个用例跳过（不把环境问题算成代码问题）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const BASE = String(PKG.name ?? 'dsh-memory-evolve').replace(/^@/, '').replace(/[/\\]/g, '-');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'release-check',
  GIT_AUTHOR_EMAIL: 'release-check@example.invalid',
  GIT_COMMITTER_NAME: 'release-check',
  GIT_COMMITTER_EMAIL: 'release-check@example.invalid',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'init.defaultBranch',
  GIT_CONFIG_VALUE_0: 'main',
};

function tryRun(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    ...options,
  });
}

/** 通过 shell 跑一整条命令（Windows 上 pnpm/npm 是 .cmd，必须经 shell；传整串可避免 DEP0190）。 */
function runShell(commandLine, options = {}) {
  return spawnSync(commandLine, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    shell: true,
    ...options,
  });
}

/** 找 DSH 桌面自带运行时里的 pnpm（它默认不在 PATH 上）。 */
function bundledPnpm() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  if (home === '') return null;
  const runtimes = join(home, '.dsh', 'dsh-runtimes');
  let names = [];
  try {
    names = readdirSync(runtimes, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(runtimes, d.name, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'));
  } catch {
    return null;
  }
  return names.find((p) => existsSync(p)) ?? null;
}

/** 返回能用的打包方式；都不行则 null。 */
function resolvePackager() {
  for (const name of ['pnpm', 'npm']) {
    const probe = runShell(`${name} --version`, { timeout: 20_000 });
    if (!probe.error && probe.status === 0) {
      return (dest) => runShell(`${name} pack --pack-destination "${dest}"`, { cwd: ROOT });
    }
  }
  const pnpmMjs = bundledPnpm();
  if (pnpmMjs !== null) {
    const probe = tryRun(process.execPath, [pnpmMjs, '--version'], { timeout: 30_000 });
    if (!probe.error && probe.status === 0) {
      return (dest) => tryRun(process.execPath, [pnpmMjs, 'pack', '--pack-destination', dest], { cwd: ROOT });
    }
  }
  return null;
}

function gitAvailable() {
  const r = tryRun('git', ['--version'], { timeout: 20_000 });
  return !r.error && r.status === 0;
}

test('发布包自检：打包产物可解包、模块可加载、worker 可运行', async (t) => {
  const pack = resolvePackager();
  if (pack === null) {
    t.skip('没有可用的 pnpm / npm，跳过打包自检（请在装有 pnpm 或 npm 的环境运行）');
    return;
  }

  const work = mkdtempSync(join(tmpdir(), 'dsh-memory-tarball-'));
  try {
    // 1) 打包
    const dist = join(work, 'dist');
    mkdirSync(dist, { recursive: true });
    const packed = pack(dist);
    if (packed.status !== 0) {
      assert.fail(`打包失败：${(packed.stderr ?? '').slice(-800)}`);
    }
    const tgzName = readdirSync(dist).find((f) => f.endsWith('.tgz'));
    assert.ok(tgzName, '打包后 dist 里应该有 .tgz');
    assert.equal(tgzName, `${BASE}-${PKG.version}.tgz`, '产物名应该是 <name>-<version>.tgz');
    const tgz = join(dist, tgzName);

    // 2) 解包
    const extractDir = join(work, 'extract');
    mkdirSync(extractDir, { recursive: true });
    const untar = tryRun('tar', ['-xzf', tgz, '-C', extractDir]);
    assert.equal(untar.status, 0, `解包失败：${(untar.stderr ?? '').slice(-400)}`);
    const pkgDir = join(extractDir, 'package');
    assert.ok(existsSync(pkgDir), 'npm 包里应该有顶层 package/ 目录');

    // 3) 清单完整性：这些是「装上就必须在」的东西
    for (const rel of [
      'package.json',
      'lib/index.js',
      'lib/client.js',
      'lib/sync/index.js',
      'scripts/sync-worker.mjs',
      'cordis.patch.yml',
      'skills/memory-consolidate/SKILL.md',
      'vendor/mermaid.min.js',
    ]) {
      assert.ok(existsSync(join(pkgDir, rel)), `发布包缺少 ${rel}`);
    }
    // 不该进包的东西
    for (const rel of ['src', 'tests', 'node_modules', '.github']) {
      assert.ok(!existsSync(join(pkgDir, rel)), `发布包不该包含 ${rel}`);
    }

    // 4) 包内元数据
    const meta = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    assert.equal(meta.version, PKG.version, '包内 version 必须与仓库一致');
    assert.equal(meta.name, PKG.name, '包内 name 必须与仓库一致');
    assert.ok(!('private' in meta && meta.private === true), '发布包不能是 private');
    assert.ok(Array.isArray(meta.files) && meta.files.length > 0, '必须声明 files');
    assert.ok(meta.main === 'lib/index.js', 'main 必须指向 lib/index.js');
    assert.ok(existsSync(join(pkgDir, meta.main)), 'main 指向的文件必须真实存在');

    // 5) 加载宿主侧入口（相当于 DSH 装完后 import 它）
    const mod = await import(pathToFileURL(join(pkgDir, 'lib', 'index.js')).href);
    for (const key of ['apply', 'name', 'DEFAULTS', 'resolveConfig', 'renderSnapshot']) {
      assert.ok(Object.hasOwn(mod, key), `入口缺少导出 ${key}`);
    }
    assert.equal(mod.name, PKG.name, '导出的 name 应与包名一致');

    // 6) 跑一次 worker（#110 的回归点：入口必须能被执行并输出单行 JSON）
    if (!gitAvailable()) {
      t.diagnostic('git 不可用，跳过 worker 运行检查');
      return;
    }
    const repoDir = join(work, 'mem');
    mkdirSync(repoDir, { recursive: true });
    const env = { ...process.env, ...GIT_ENV };
    const init = tryRun('git', ['init', '-q'], { cwd: repoDir, env });
    assert.equal(init.status, 0, 'git init 失败');

    const workerPath = join(pkgDir, 'scripts', 'sync-worker.mjs');
    const worker = tryRun(process.execPath, [workerPath, 'status', repoDir, 'main'], { cwd: repoDir, env });
    const stdout = String(worker.stdout ?? '').trim();
    assert.ok(stdout.length > 0, 'worker 必须输出内容（#110 的表现就是「worker 无输出」）');
    const payload = JSON.parse(stdout.split('\n').pop() ?? '{}');
    assert.equal(typeof payload.ok, 'boolean', 'worker 输出必须带 ok 字段');
    assert.ok(payload.status === undefined || typeof payload.status === 'object', 'status 应是对象');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
