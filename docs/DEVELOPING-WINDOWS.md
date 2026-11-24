# 在 Windows 上开发 / 验证本插件

> 本文档面向「fork 之后自己维护」的场景，2026-11 在本机实测通过。
> macOS / Linux 也能用 `npm run test:win`（脚本本身跨平台，名字是历史原因）。

## 1. 需要什么

| 项 | 要求 | 本机实测值 |
|---|---|---|
| Node.js | **≥ 22.18**（`tests/client-compat.test.js` 直接 import `.ts`，依赖原生类型剥离） | DSH 桌面自带 v24.21.0 |
| git | 任意较新版本（测试会在临时目录里 init / commit / push） | 2.56.0 |
| pnpm / npm 安装依赖 | 只跑测试时不需要（零运行期依赖）；要构建前端 bundle 时用它装 devDependency esbuild | pnpm 11.28.5（DSH 自带） |

DSH 桌面版自带的 Node 位于（示例）：

```
C:\Users\<你>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
```

它默认不在 PATH 里，用绝对路径调用即可，例如：

```bash
"C:/Users/<你>/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe" --version
```

## 2. 跑测试

```bash
# 推荐：带好 git 环境变量的跑批脚本
npm run test:win

# 等价手写
node scripts/test-win.mjs

# 只跑一个文件
node scripts/test-win.mjs tests/canvas.test.js

# 换 reporter
node scripts/test-win.mjs --test-reporter=spec
```

`scripts/test-win.mjs` 只做三件事：把测试用 git 身份、`init.defaultBranch=main`
通过**环境变量**注入子进程；检查你是不是在 `node_modules` 里跑（那是必然报
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 的，因为 Node 拒绝加载
`node_modules` 内的 `.ts`）；把剩下的参数原样交给 `node --test`。它不改任何全局
git 配置。

### 期望结果

```
# tests 895 / pass 893 / fail 0 / skipped 2
```

* 1 个 skip 是作者原本就标了的；
* 1 个 skip 是 `tests/sync-utf8-stream.test.js` 的集成冒烟：它靠「无扩展名 +
  shebang 的假 git 脚本」劫持 PATH，Windows 不能直接执行这种脚本，故在 win32 上
  跳过（同一文件里逐字节覆盖解码逻辑的单元用例仍然跑）。

全量跑一轮约 60~180 秒（取决于机器负载）。

## 3. 不配 git 身份会怎样（历史坑）

`tests/` 下有多处会在临时目录 `git init` 后 commit / push。如果这台机器没有
`user.name` / `user.email`，会看到一片 `Author identity unknown`；如果
`init.defaultBranch` 不是 `main`，会看到 `src refspec main does not match any`
（用例写的是 `git push origin main`）。两者都不是插件 bug，`npm run test:win`
已经替你处理。

## 4. 构建前端 bundle

```bash
pnpm install          # 只装 devDependency（esbuild），本插件运行期零依赖
node scripts/build.mjs   # 或 npm run build，产物 lib/client.js
```

> pnpm 11 默认不许依赖跑构建脚本，遇到 esbuild 会直接 `ERR_PNPM_IGNORED_BUILDS`
> 并以 1 退出（CI 等同失败）。仓库根的 `pnpm-workspace.yaml` 已经写了
> `allowBuilds: { esbuild: true }` 放行——注意 pnpm 11 已用 `allowBuilds` 取代
> pnpm 10 的 `onlyBuiltDependencies`，旧键会被静默忽略。
>
> 另外：esbuild 的 postinstall 用 `node install.js` 启动，所以 `pnpm install` 要求
> `node` 在 PATH 上。只装了 DSH 自带运行时（不在 PATH）时会看到
> `'node' is not recognized …`；把
> `C:\Users\<你>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin`
> 加进 PATH 即可（或临时用 `pnpm install --ignore-scripts`，产物照样能构建）。

esbuild 通过 `devDependencies` 固定为 **0.28.1**（与仓库里已提交的 `lib/client.js`
对应版本；换版本可能导致产物字节变化，见下）。`scripts/build.mjs` 的解析顺序是
「本仓库 node_modules → `$DSH_SOURCE` 指向的 DSH 源码 checkout」，所以**不再需要**
在本机放一份 DSH 源码。

验证构建链是否健康的标准（也是本次修复的验收标准）：

```bash
cp lib/client.js /tmp/before.js
node scripts/build.mjs
cmp /tmp/before.js lib/client.js   # 必须完全一致，即「重编产物 = 仓库产物」
```

> 历史坑：`scripts/build.mjs` 以前只从 `~/.dsh/source/current` 找 esbuild，而
> `tsconfig.json` 的 `paths` 又全是作者 Mac 路径 `/Users/edgar/.dsh/source/current/**`。
> 结果是 fork 者 `npm run build` 必然报 `esbuild not found under ...`。
> 现在 build 已可移植；`tsconfig.json` 的 `paths` 仍指向作者机器，只影响
> `tsc --noEmit` 类型检查（本插件不用 tsc 出产物，esbuild 只剥离类型不做检查），
> 如果你要在本地跑类型检查，把 `paths` 改成你自己的 DSH 源码路径即可。

## 5. 排障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | 在 `node_modules/dsh-memory-evolve` 里跑测试 | 在普通 clone 目录跑 |
| 大量 `Author identity unknown` | 没有 git 身份 | 用 `npm run test:win` |
| `src refspec main does not match any` | 默认分支是 master | 用 `npm run test:win` |
| `spawnSync node ENOENT` / `status: null` | `node` 不在 PATH | 用脚本跑（它用 `process.execPath` 之外的场景也已修） |
| 画板打开 `C:\...\.ssh\id_rsa` 没被拦 | 旧版敏感路径判定只认 `/` | 已在 `lib/canvas.js` 的 `findDeniedFragment` 修复 |
