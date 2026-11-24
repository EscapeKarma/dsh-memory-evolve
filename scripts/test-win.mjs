#!/usr/bin/env node
/**
 * 本地测试跑批（Windows / macOS / Linux 通用，名字里的 win 只是因为它最早是在
 * Windows 上排的坑）。
 *
 * 为什么需要它：
 *   tests/ 下有一批用例会在临时目录里 `git init` 再 commit / push。如果这台机器
 *   没配 git 身份（user.name / user.email）或者默认分支不是 main，这些用例会成
 *   片失败，看起来像插件有 bug，其实只是环境没准备好。手工敲一长串环境变量又
 *   容易漏，所以固化到这里。
 *
 * 用法：
 *   node scripts/test-win.mjs                    # 跑全部
 *   node scripts/test-win.mjs tests/canvas.test.js
 *   node scripts/test-win.mjs --test-reporter=spec
 *   npm run test:win                             # 等价于第一种
 *
 * 除 git 身份与默认分支以外不改变任何行为，也不碰全局 git 配置（只通过环境变量
 * 传给被测进程）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// 只影响被 spawn 的测试子进程；测试里的 commit 用这个名字不会有副作用。
const TEST_GIT_ENV = {
  GIT_AUTHOR_NAME: 'dsh-memory-evolve tests',
  GIT_AUTHOR_EMAIL: 'tests@example.invalid',
  GIT_COMMITTER_NAME: 'dsh-memory-evolve tests',
  GIT_COMMITTER_EMAIL: 'tests@example.invalid',
  // 让测试仓库的初始分支固定为 main：多处用例会 `git init` 后直接 push main。
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'init.defaultBranch',
  GIT_CONFIG_VALUE_0: 'main',
};

const userArgs = process.argv.slice(2);
const hasPositional = userArgs.some((arg) => !arg.startsWith('-'));
const testArgs = ['--test', ...(hasPositional ? [] : ['tests/*.test.js']), ...userArgs];

if (repoRoot.split(path.sep).includes('node_modules')) {
  console.error(
    '\n[test-win] 警告：当前目录位于 node_modules 内，Node 会拒绝直接加载其中的 .ts，\n' +
      '          `client-*` 用例必然报 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING。\n' +
      '          请在普通 clone 目录里跑。\n',
  );
}

console.log(
  `[test-win] node ${process.version} · ${process.platform}/${process.arch}\n` +
    `[test-win] 已注入 git 身份 + init.defaultBranch=main（仅子进程环境）\n` +
    `[test-win] node ${testArgs.join(' ')}\n`,
);

const result = spawnSync(process.execPath, testArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, ...TEST_GIT_ENV },
});

if (result.error) {
  console.error(`[test-win] 启动失败：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
