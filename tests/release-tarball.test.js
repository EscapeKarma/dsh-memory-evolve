// 发版前自检：把仓库打成发布用的 tarball，然后「像用户那样装上、加载、跑 worker」。
//
// 这个用例存在的理由：`files` 字段漏一项、产物没重建、worker 入口被挪走，本地全量测试
// 都发现不了——只有在「打包 → 安装 → 加载 → 跑 worker」这条链上才会暴露。
// 发版前跑一次，就能避免再出现 #110（发布包缺 scripts/sync-worker.mjs）那种事故。
//
// 打包/安装都用包管理器自己的实现（npm 或 pnpm），**不用系统 tar**：
// Windows CI 上的 GNU tar 读不了含 UTF-8 文件名的 pax 头，会报
// 「Archive entry has empty or unreadable filename」，而 npm/pnpm 自己解包没有这个问题。
//
// 工具链解析顺序：PATH 上的 pnpm → PATH 上的 npm → DSH 桌面自带的 pnpm。
// 三者都没有时整个用例跳过（不把环境问题算成代码问题）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PKG_NAME = String(PKG.name ?? 'dsh-memory-evolve');
const BASE = PKG_NAME.replace(/^@[^/]+\//, '').replace(/[/\\]/g, '-'); // 产物名去掉 scope

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
  return spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 240_000, ...options });
}

// Windows 上 pnpm/npm 是 .cmd 包装，必须经 shell；传整串命令可避免 DEP0190。
function runShell(commandLine, options = {}) {
  return spawnSync(commandLine, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240_000,
    shell: true,
    ...options,
  });
}

/** DSH 桌面自带运行时里的 pnpm（它默认不在 PATH 上）。 */
function bundledPnpm() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  if (home === '') return null;
  const runtimes = join(home, '.dsh', 'dsh-runtimes');
  let candidates = [];
  try {
    candidates = readdirSync(runtimes, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(runtimes, d.name, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'));
  } catch {
    return null;
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** 返回 { label, pack(dest), install(projectDir, tgz) }；都没有则 null。 */
function resolveToolchain() {
  for (const name of ['pnpm', 'npm']) {
    const probe = runShell(`${name} --version`, { timeout: 30_000 });
    if (probe.error || probe.status !== 0) continue;
    return name === 'pnpm' ? pnpmFromPath() : npmFromPath();
  }
  const pnpmMjs = bundledPnpm();
  if (pnpmMjs !== null) {
    const probe = tryRun(process.execPath, [pnpmMjs, '--version'], { timeout: 30_000 });
    if (!probe.error && probe.status === 0) return pnpmFromMjs(pnpmMjs);
  }
  return null;
}

// 经 node 跑 pnpm.mjs：参数用数组传，避免路径里的空格被拆开。
function pnpmFromMjs(pnpmMjs) {
  return {
    label: 'DSH 自带 pnpm',
    pack: (dest) => tryRun(process.execPath, [pnpmMjs, 'pack', '--pack-destination', dest], { cwd: ROOT }),
    install: (projectDir, tgz) => tryRun(process.execPath, [pnpmMjs, 'add', `file:${tgz}`], { cwd: projectDir }),
  };
}

function pnpmFromPath() {
  return {
    label: 'pnpm',
    pack: (dest) => runShell(`pnpm pack --pack-destination ${dest}`, { cwd: ROOT }),
    install: (projectDir, tgz) => runShell(`pnpm add file:${tgz}`, { cwd: projectDir }),
  };
}

function npmFromPath() {
  return {
    label: 'npm',
    pack: (dest) => runShell(`npm pack --pack-destination ${dest}`, { cwd: ROOT }),
    install: (projectDir, tgz) =>
      runShell(`npm install --no-save --no-audit --no-fund ${tgz}`, { cwd: projectDir }),
  };
}

function gitAvailable() {
  const r = tryRun('git', ['--version'], { timeout: 20_000 });
  return !r.error && r.status === 0;
}

/** 包名 → node_modules 下的相对路径（scoped 包是 @scope/name）。 */
function installedDir(projectDir) {
  return join(projectDir, 'node_modules', ...PKG_NAME.split('/'));
}

test('发布包自检：打包产物可安装、模块可加载、worker 可运行', async (t) => {
  const tool = resolveToolchain();
  if (tool === null) {
    t.skip('没有可用的 pnpm / npm，跳过打包自检（请在装有 pnpm 或 npm 的环境运行）');
    return;
  }
  t.diagnostic(`使用 ${tool.label} 打包与安装`);

  const work = mkdtempSync(join(tmpdir(), 'dsh-memory-tarball-'));
  try {
    // 1) 打包
    const dist = join(work, 'dist');
    mkdirSync(dist, { recursive: true });
    const packed = tool.pack(dist);
    if (packed.status !== 0) {
      assert.fail(`打包失败（${tool.label}）：${(packed.stderr ?? '').slice(-800)}`);
    }
    const tgzName = readdirSync(dist).find((f) => f.endsWith('.tgz'));
    assert.ok(tgzName, '打包后 dist 里应该有 .tgz');
    // 包管理器给 scoped 包起的名字带 scope（@scope/name → scope-name），这里只校验版本后缀；
    // 对外发布用的稳定名由 scripts/pack-release.mjs 统一改成不带 scope 的 dsh-memory-evolve.tgz。
    assert.ok(tgzName.endsWith(`-${PKG.version}.tgz`), `产物名应以 -${PKG.version}.tgz 结尾，实际 ${tgzName}`);
    const tgz = join(dist, tgzName);

    // 2) 装进一个干净项目（等同于用户 `dsh plugin add` 时发生的事）
    const project = join(work, 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'release-check', private: true, version: '0.0.0' }, null, 2));
    const installed = tool.install(project, tgz);
    assert.equal(installed.status, 0, `安装失败（${tool.label}）：${(installed.stderr ?? '').slice(-800)}`);

    const pkgDir = installedDir(project);
    assert.ok(existsSync(pkgDir), `安装后应有 ${pkgDir}`);

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
    assert.equal(meta.name, PKG_NAME, '包内 name 必须与仓库一致');
    assert.ok(!(meta.private === true), '发布包不能是 private');
    assert.ok(Array.isArray(meta.files) && meta.files.length > 0, '必须声明 files');
    assert.equal(meta.main, 'lib/index.js', 'main 必须指向 lib/index.js');
    assert.ok(existsSync(join(pkgDir, meta.main)), 'main 指向的文件必须真实存在');

    // 5) 加载宿主侧入口（等同于 DSH 装完后 import 它）
    const mod = await import(pathToFileURL(join(pkgDir, 'lib', 'index.js')).href);
    for (const key of ['apply', 'name', 'DEFAULTS', 'resolveConfig', 'renderSnapshot']) {
      assert.ok(Object.hasOwn(mod, key), `入口缺少导出 ${key}`);
    }
    assert.equal(mod.name, PKG_NAME, '导出的 name 应与包名一致');

    // 6) 跑一次 worker（#110 的回归点：入口必须能被执行并输出单行 JSON）
    if (!gitAvailable()) {
      t.diagnostic('git 不可用，跳过 worker 运行检查');
      return;
    }
    const repoDir = join(work, 'mem');
    mkdirSync(repoDir, { recursive: true });
    const env = { ...process.env, ...GIT_ENV };
    assert.equal(tryRun('git', ['init', '-q'], { cwd: repoDir, env }).status, 0, 'git init 失败');

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
