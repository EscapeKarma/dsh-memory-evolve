# 贡献指南 / Contributing

English summary at the bottom.

## 这个项目怎么运转

本仓库是 [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve) 的社区维护 fork。原作者已停更，由 [@EscapeKarma](https://github.com/EscapeKarma) 在业余时间维护：**issue 会看会回，但不承诺时限**；PR 只要能用、能测、不改坏别人正在用的东西，就会合并。

维护者的判断标准，按优先级排列：

1. **不能引入安全风险**——插件跑在宿主进程里，能读文件、调 shell、拿会话数据。任何放宽文件访问、放宽鉴权、执行外部脚本的改动都会被重点审查；
2. **不能破坏现有用户**——默认行为尽量不变，需要变的给出开关或迁移路径；
3. **有测试**——新增/修复都要有能复现的用例；测试必须跨平台可重复；
4. **说得清**——提交说明写清「现象 / 根因 / 改法 / 测试」。

## 报 Issue

提之前先搜一下有没有重复。请包含：

- DSH 版本、插件版本（`设置 → Memory Evolve → 版本`）、操作系统
- 复现步骤（越具体越好：点了什么、说了什么、期望什么、实际什么）
- 报错原文或截图；相关日志（宿主日志、`~/AppData/Local/Temp/` 下本插件的临时日志等）
- 是否修改过配置（尤其是 `cordis.patch.yml` 与运行时配置）

如果是**安全问题**（能读到不该读的文件、能执行任意命令、token 泄露等），不要开公开 issue，走 [SECURITY.md](SECURITY.md)。

## 提 PR

```sh
# 1. fork 后从 main 切分支
git checkout -b fix/xxx

# 2. 改代码 + 加测试
pnpm install                 # 只为构建
pnpm test:win                # Windows
pnpm test                    # macOS / Linux

# 3. 改了 src/client/ 必须重建产物并一起提交
pnpm build
git status                   # lib/client.js 有变化就 git add

# 4. 提交
git commit -m "修复：……（现象 / 根因 / 改法 / 测试写清）"
```

**硬性要求**

- 测试全绿（当前基线：**976 例 / 975 通过 / 0 失败 / 1 跳过**），CI 三个 job 全绿；
- 不新增运行时依赖（宿主侧只用 Node 内置模块，浏览器侧只用 DSH 提供的模块）；
- 测试不要写死 POSIX 分隔符、macOS 专属路径、固定 `setTimeout` 等待——CI 在 ubuntu + windows 上跑；
- 新增文件访问逻辑必须经过敏感目录检查（`lib/canvas.js` 的 `findDeniedFragment` 一族）；
- 不改 `LICENSE` 的原版权行。

**提交说明风格**（本项目历来如此，便于回溯）：

```
修复：中文 Windows 下首次同步被误判为远端分支已删除

现象：……
根因：git 子进程未固定 locale，中文报错文本匹配不上英文正则
改法：runGit 注入 LC_ALL=C；worker 正则补中文兜底
测试：tests/sync-git-locale.test.js（5 例），全量 976/975/0/1
```

**合并方式**：维护者会用 `cherry-pick -x` 合入，**保留你的原作者署名**。如果你的分支上有多个 commit，可以 squash 后再提。

## 代码约定

- **中文注释优先**（与代码库现状一致），关键分支要写清"为什么"；
- 只在必要时新增文件；新增公开导出请在对应测试里覆盖；
- 客户端只能 import `scripts/build.mjs` 里 `EXTERNALS` 表内的宿主模块；
- 运行时注入的 `<style>` 必须带 `data-plugin` 归属（见 `src/client/style-tag.ts`），否则会被别的插件认领走；
- 涉及 Windows 的路径/进程/编码逻辑，请按 `docs/DEVELOPING-WINDOWS.md` 的方式在 Windows 上验一遍（或用 `test:win` 的环境变量模拟）。

## 文档

改功能请同步：

- `docs/CHANGELOG.md` + `docs/CHANGELOG.en.md`（两份都要，按日期倒序；同日合并到同一节；`## 未发布` 永远在最上）
- 面向使用者的说明在 `README.md` / `README.en.md`（两份镜像），细节在 `README-详细说明.md`
- 开发相关在 `docs/DEVELOPING-WINDOWS.md`、`docs/rules.md`（记忆与审查规则）、`docs/记忆同步.md`、`docs/COI-调度.md`

## 发版（维护者）

1. 改两份 CHANGELOG 与 `package.json` 的 `version`，提交推送；
2. 打 annotated tag 并推送，建 GitHub Release；
3. 构建并上传预构建包：

```sh
pnpm pack:release    # 需要 npm 或 pnpm；DSH 桌面自带的 pnpm 也会被自动找到
gh release upload v0.6.2 dist/dsh-memory-evolve-0.6.2.tgz dist/dsh-memory-evolve.tgz --clobber
```

**为什么要传稳定名 `dsh-memory-evolve.tgz`**：插件市场的目录条目里 `tarball` 字段指向
`https://github.com/<owner>/<repo>/releases/latest/download/dsh-memory-evolve.tgz`，
每次发版覆盖上传同一个名字即可，目录条目不用再改、也不用再提 PR。
带版本号的那个文件留着给人工下载与按版本核对。

上传后自己验一遍：

```sh
curl -sIL -o /dev/null -w "%{http_code}
" https://github.com/EscapeKarma/dsh-memory-evolve/releases/latest/download/dsh-memory-evolve.tgz
```

期望 `200`。若市场里仍显示「源码构建」，等目录仓库的构建跑完（通常几十分钟）。

---

## English summary


This is the community-maintained fork of `csyangwen/dsh-memory-evolve`. The original author is inactive; maintenance happens in spare time — issues are answered, but no SLA.

- **Bug reports**: include DSH version, plugin version (*Settings → Memory Evolve → Version*), OS, reproduction steps and the exact error text. Search first.
- **Security issues**: do **not** open a public issue — see [SECURITY.md](SECURITY.md).
- **Pull requests**: branch from `main`, add tests, run `pnpm test:win` (Windows) or `pnpm test`; rebuild with `pnpm build` and commit `lib/client.js` if you touched `src/client/`. CI must be green (ubuntu + windows + build-artifact job).
- **Rules**: no new runtime dependencies; deterministic, cross-platform tests; new file-access code must pass the sensitive-path check; never remove the upstream copyright line.
- **Commit messages**: state symptom / root cause / fix / tests (the repo's historical style, Chinese preferred but English is fine).
- Community PRs are merged with `cherry-pick -x`, keeping your authorship.
- **Releases**: after tagging, run `pnpm pack:release` and upload both tarballs with `gh release upload v<version> dist/<name>-<version>.tgz dist/<name>.tgz --clobber`. The stable-name asset is what the plugin catalog `tarball` field points at (`releases/latest/download/<name>.tgz`), so the entry never needs another PR.
