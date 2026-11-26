# 更新日志（Changelog）

本仓库所有版本变更记录，按日期倒序排列。

> [English](CHANGELOG.en.md)

## 2026-11-27 · v0.7.1（接入 DSH 官方准入检查 + 文档与作者信息整理）

### 安全

- **HTTP 路由接入 DSH 官方准入**：所有插件端点在做自己的同源校验之前，先问宿主的 `ctx.connection.requestRejection(req)`。宿主返回 **403**（Host/Origin 栅栏判定不可信：跨站网页、DNS rebinding）时直接拒绝；返回 **401**（没有浏览器会话 cookie 的本机 `curl` / CLI 调用）不代表跨站，回落到插件自己的回环校验，脚本用法不受影响；宿主没有该能力（旧版本 / 非 Web 宿主）时整层跳过。这样既满足 DSH 的准入口径，也不会因为缺少会话 cookie 把本机脚本一并封死。
- `trustedHosts` 与宿主准入叠加生效：写进白名单的 Host 同时被两层认可。

### 文档

- `SECURITY.md` 按当前实现重写：补上宿主准入、外发附件白名单（`channelSendRoots`）、COI 适配器白名单、子进程环境收敛、原子写与注入清洗等条目，「支持的版本」从 v0.3.0 更正到 v0.7.1。
- `README.md` / `README.en.md` 的版本里程碑表补齐 v0.4–v0.7（原来停在 v0.3.0，与新版本事实不符）。
- `tsconfig.json` 的 `paths` 不再写死原作者的本机目录，改为仓库内相对路径 `.dsh-source/`（把本地 DSH 源码软链过去即可获得类型提示，不影响构建）；`.gitignore` 忽略该目录；`docs/DEVELOPING-WINDOWS.md` 对应说明同步更新；`tests/store.test.js` 夹具里的原作者路径换成中性示例路径。

### 其它

- `package.json` 的 `author` 改为 `{ "name": "EscapeKarma", "url": … }`，`contributors` 明确标注原作者 csyangwen（MIT 要求的原版权行继续保留在 `LICENSE` 里）。

## 2026-11-27 · v0.7.0（npm 发布：包名改为 scoped，启用自动发包）

### 新增

- 推 `v*` tag 即自动发版：`.github/workflows/release.yml` 会校验 `lib/client.js` 与 `src/client/` 一致、跑发布包自检（打包 / 安装 / 加载 / 跑 worker），再创建或复用该 tag 的 Release 并上传两个 tarball（带版本号 + 稳定名），最后校验稳定名地址可下载。需要补传历史版本时仍可 `pnpm pack:release` 手动上传，或用 `gh workflow run release.yml -f tag=<tag>` 重跑。
- 新增 `.github/workflows/publish-npm.yml`：Release 发布后（非预发布）把同一版本发到 npm，带 Sigstore provenance 签名，发布后回读 registry 确认真的上架；预发布 tag 不自动发 npm。

### 变更

- **包名改为 `@escapekarma49/dsh-memory-evolve`**（v0.7.0），以便在 npm 上以 scoped 包发布——旧的 `dsh-memory-evolve` 名字已被上游作者占用。**Loader 条目 id 仍是 `dsh-memory-evolve`**：profile 里的配置、记忆数据、设置页 key 都不变，只是依赖名变了。`cordis.patch.yml` 的 `name:` 与 `lib/index.js` 导出的 `name` 随之改为 scoped 包名。
- 样式归属键跟随包名变为 `@escapekarma49/dsh-memory-evolve`；旧键 `dsh-memory-evolve` 留在 `LEGACY_OWNERS` 里，重新注入时自动迁回，不会留下无主标签。
- 文档的安装命令改为 npm 首选（`dsh plugin --profile web add @escapekarma49/dsh-memory-evolve`），保留 `github:` 源码安装作为等价方式，并补了「从 v0.6.x 升级」的迁移说明。

### 文档

- `README.md` 与 `CONTRIBUTING.md` 的发版流程改为「推 tag 自动完成」，手动命令只作为补传/重跑的兜底。
- `CONTRIBUTING.md` 新增「预发布版本」小节（tag 带 `-` 时自动标 Pre-release、不抢占 `releases/latest`），`README.md` 发版流程同步一句。

## 2026-11-26 · v0.6.1（巡检收尾：外发附件路径校验 + 边界加固）

### 安全（巡检 B1③：附件外发路径）

- `de_channel_send` / `de_notify` 发送本地文件前现在会校验路径：命中敏感目录片段（`.ssh`、`.aws`、`.env` 等）一律拒绝，**先按字面串判定、再按 `realpath` 复检一次**，符号链接 / junction / 大小写变形都绕不过去。
- 新增配置 `channelSendRoots`（默认 `[]` = 不限制目录，只挡敏感路径）：填了绝对路径后，只有落在这些目录内的文件才允许发送。跨平台注意：Windows 下路径比较会归一为 `/` 并忽略大小写。
- 行为变化：以前能一条命令把任意本地文件发到 IM，现在敏感路径与白名单外路径会被拒，并逐渠道返回可读原因。

### 修复（巡检 A1–A7、B2、B3）

- **A1 分支名不再能拆坏条目**：`memory` 工具的 `branches` 参数拒绝含 `]`、`\n`、`\r` 的分支名（它们会被写进 `[branch:…]` 头部标记）。
- **A2 目录名不再被 rg 当成选项**：`memory_evolve_search_local_files` 的列表模式在根路径前插入 `--`，`-开头的目录名` 不再被解析成 flag。
- **A3 `/api/todo?date=` 只接受 `YYYY-MM-DD`**：非法值返回 400（date 参与拼每日文件名，此前是可穿越的）。
- **A4 评审间隔在提交前夹到 1–50**：输入框被清空或粘贴乱码时，不会把「每 N 轮评审一次」变成 0 或天文数字；配置面板的保存键形状保持不变。
- **A5 别名里的换行被折叠成空格**：别名会作为一行注入快照，含换行就能伪造一个新段。
- **A6 模型表格保存失败不再静默**：失败时显示「保存失败：…」，成功才清空提示。
- **A7 前端写操作防重 + 丢弃过期响应**：提示词页与广播页的删除/踢人/解散等操作在请求返回前禁用重复点击；记忆页与待办页切会话时，晚到的旧响应不再覆盖新数据。
- **B2 git 子进程改用环境白名单**（新增 `lib/sync/env.js`）：只放行 `PATH`/`HOME`/`GIT_*`/`LC_*`/代理与证书等必要键，`GH_TOKEN`、`GITHUB_TOKEN`、`*_API_KEY`、`*_TOKEN`、`*_SECRET` 一律剥离——git 子进程不再继承宿主的模型 API Key。
- **B3 归档 / 列表 / 展开统一用「有效工作目录」**：`archive`、`list(archived)`、`expand`、`branches` 不再用会话 header 的 cwd，子代理与跨工作区执行时与写入落在同一个项目桶（#106 的另一半）。

### 测试

- 新增 `tests/hardening-c.test.js`（12 例：附件拒绝表与白名单、符号链接真实路径、git 环境白名单、别名折叠、`date` 穿越、前端防重与令牌、分支名校验、rg `--`）。
- 全量 1117 例 / 1116 通过 / 0 失败 / 1 跳过。

## 2026-11-26 · v0.6.0（P3 C 组：前端稳定性）

### 修复（P3 C 组：前端稳定性）

- **COI「重试」加了防重**：请求返回前按钮禁用，连点不再同时开出多个重试任务。
- **书签跳转不再因锚点内容崩掉**：`data-chat-anchor-key` 原文含引号或方括号时，旧实现把 key 拼进 CSS 选择器会抛 `SyntaxError`、整页书签跳转随之失效；改为遍历候选节点比对 `dataset`，与 key 内容无关。
- **切会话 / 切页 / 改搜索词后丢弃过期响应**：COI 的任务列表与任务详情用递增令牌标记请求，晚到的旧响应不再覆盖新会话刚渲染的内容。
- **功能开关保存失败不再静默**：浏览器存储不可用或配额满时，开关只在本次会话生效——面板现在明确提示「重启后会回退」，不再让人以为已保存。

### 测试

- 新增 `tests/client-p3c.test.js`（7 例，源码 + 产物双侧静态契约）。

## 2026-11-26 · v0.5.2（P3 B 组：稳定性）

### 修复（P3 B 组：稳定性）

- **所有「整表覆盖写」改为原子写**：`aliases.json`、`PROVENANCE`、`plugin-state.json`、书签、模型目录、通知、画板 `boards.json`、检索缓存统一走「唯一临时文件 → fsync → rename」（新增 `lib/atomic-write.js`）。此前临时文件名只带进程号，同进程并发写会互踩。
- **合并半装技能目录前先备份**：覆盖同名文件前把目标目录复制到 `<dir>.bak.<timestamp>`（只留最近 3 份），装坏还能找回旧内容。
- **迁移 / 回填不跟随符号链接**：`lstat` 判定，链接指向记忆目录外部时不再把内容写到链接目标里。
- **外部命令超时按进程树终止**：Windows 上 `rg` / `es` 的孙进程不再残留（`taskkill /T`），定时检索不会越积越多。
- **会话级状态表加上限**：评审轮次计数与「连续未写」计数两张 Map 超过 500 条时按插入顺序淘汰，长期运行不再无限增长。
- **测试适配**：`tests/review-tool-lifecycle.test.js` 的「持久化失败」注入从「预占临时文件名」改成「把目标路径换成目录」（临时名现在是 pid + 随机后缀），语义更强且不依赖内部实现。

### 测试

- 新增 `tests/hardening-b.test.js`（5 例：临时名唯一、原子写不留残留、别名表并发写仍是合法 JSON、合并前备份且最多 3 份、lstat 不把符号链接当文件）。全量 1098 例 / 1097 通过 / 0 失败 / 1 跳过。

## 2026-11-26 · v0.5.1（P3 A 组：数据正确性）

### 修复（P3 A 组：数据正确性）

- **跨零点写入不再串日期**：同一笔写入里「写进哪一天的日志文件」与「时间戳写几点」改为取自同一个时刻（此前是两次独立取时，23:59:59 写入可能落进昨天文件却盖 00:00）。
- **CRLF 文件不再永久只读**：读取时把 `\r\n` 归一为 `\n`，Windows 编辑器/同步工具把记忆文件换成 CRLF 后，`replace` 不再永远被判为「格式漂移」。
- **漂移备份只留最近 5 份**：`<file>.bak.<timestamp>` 此前每漂移一次写一份、永不清理；现在自动清理更旧的备份。
- **单文件条目软上限**（`maxEntriesPerFile`，默认 2000）：超过时写入照常成功，但在结果里附一条提示建议归档——**绝不自动删除任何旧条目**。
- **检索索引缓存键覆盖全量内容**：原来只含「条数 + 总字符 + 首尾片段」，两组只改中间条目的语料会撞键、拿到别的索引算分；改为对全量文本做 32 位哈希。
- **头部标记固定顺序**：`replace` 补回 `[branch:…]` / `[dsh-only]` / `[summary:…]` 时按固定顺序拼回，不再随写入路径变化。
- **`engines.dsh` 限定 `>=0.2.2-rc.5`**（市场准入要求）：只在 0.2.2-rc.5 上验证过，更旧的宿主直接拒绝安装，避免带着未知 API 差异崩溃。

### 测试

- 新增 `tests/store-hardening-a.test.js`（7 例：注入时钟的跨零点一致性、CRLF 往返、备份份数、软上限提示、索引缓存键、头部标记顺序）；`tests/package-manifest.test.js` 补 `engines.dsh` 断言。全量 1093 例 / 1092 通过 / 0 失败 / 1 跳过。

## 2026-11-26 · v0.5.0（安全巡检与四刀加固）

### 新增

- **渐进式披露 v2（#66 A 块）**：`memory` 的 `summary` 参数从 key 轨扩到 memory / user / key 三轨（日志轨忽略）；摘要清洗与 120 字上限收敛到单一事实源；新增 `summaryMinChars`——摘要模式下正文不超过阈值的条目保持全文，更长的才折成摘要行（默认 0 关闭，建议 400，实测省约 61%）；新增 `memory` 的 `retag` 动作，只改摘要元数据、不动正文与身份证。

### 修复

- `es` 搜索提供者在"目录/全部搜索"时误报"rg 不支持目录搜索"——改为正确的提供者名与回落说明。

### 安全（巡检刀1）

- **插件全部 HTTP 路由补齐同源校验**（巡检 P0-1）：统一守卫拦跨站 Origin、跨站 `Sec-Fetch-Site`、`Origin: null`、DNS rebinding；写请求必须是 `application/json`（跨站表单提交因此失效）；无 Origin 的调用要求对端回环或 Host 可信；新增 `trustedHosts` 配置（默认空），用于局域网 / 反向代理等确实需要远程访问的场景。修前实测：旧版宿主上跨站 `POST /memory-evolve/api/config` 返回 200，现在 403 / 415。
- **COI 运行时适配器改为内置白名单**（巡检 P0-2）：不再接受自定义 `binary` / `args` / `testCmd`——它们能让任何能改配置的调用方执行任意命令；旧配置文件里的自定义条目在加载时丢弃。只保留外观类覆盖（启用、名称、用途、指南、模型、超时）。
- advisor 的同源守卫补「Host 必须可信」判定（原实现只比较 Origin 与 Host 相等，DNS rebinding 可绕过）。
- `memory-sync/global-*` 端点补 POST 方法校验（原来 GET 也能触发同步与远端写入）。

### 修复（巡检刀2 / 刀3 / 刀4）

- **`add` / `replace` 拒绝条目分隔符 §**：含 § 的内容会把一条记忆静默拆成两条，此后无法整体替换或删除（GUI 路径一直有校验，工具路径漏了）。
- **`replace` 保留程序元数据**：不再丢失 `[branch:…]` / `[dsh-only]` / `[summary:…]`——调用方没有重写这些标记时原样保留。
- **待确认队列只对完全相同的内容去重**：原来「互相包含」也算重复，短条目会把包含它的新事实吞掉。
- **项目分桶归一化**：`D:\repo` / `D:/repo/` 等不同写法不再产生两个记忆桶；升级前按旧哈希建的桶仍然沿用（不会看起来「记忆丢了」）。
- **画板敏感路径加固**：拒绝表补 `.docker/` / `.kube/` / `.netrc` / `.npmrc` / PowerShell 历史；解析真实路径后再判一次（软链接 / junction 不再能绕过）；Windows 打开不再经 `cmd /c start`（路径里的 `&` / `|` 不再被当成命令分隔符），改用 `explorer.exe` 直传参数。
- **记忆写入 fsync**：先刷盘再 rename，断电不再留下会被当成空库的 0 字节文件。
- **快照读取失败不再拖垮会话**：某条轨道读失败时降级为「本轮不注入该轨」并给一行提示，而不是每一步都抛错。
- **注入清洗**：记忆条目进入系统提示前抹平换行、行首标题符与 `System:` 类角色前缀、伪 XML 标签（记忆文本可由跨站写入 / 社区 PR 提供，不能让它伪造结构）。
- **锁文件补硬上限**：pid 被复用时十分钟以上的旧锁不再无限等待。
- **快照热路径去子进程**：`gitBranch()` 改为直接读 `.git/HEAD`（按 mtime 失效），不再每步 `spawnSync('git')`；记忆文件读取按 mtime 缓存，未变更时只花一次 `stat`。
- **同步子进程与 git 输出补上限**：worker 120s 硬超时（超时杀整棵进程树并如实报错），stdout / stderr 各 4MB 上限。

### 文档

- 新增 `docs/不采纳的社区提案.md`：记录 #72（Jev 自动审批）不采纳的四条理由、#66 C 块（Everything IPC + PowerShell 直连）只保留 es.exe 回落链的决策，以及 #65 / #82 已被现有实现覆盖的结论。

### 测试

- 新增 `tests/summary-v2.test.js`（9 例）、`tests/api-csrf.test.js`（15 例）、`tests/coi-adapters-whitelist.test.js`（5 例）、`tests/data-integrity.test.js`（8 例）、`tests/snapshot-hardening.test.js`（4 例）、`tests/perf-hardening.test.js`（4 例）。全量 1083 例 / 1082 通过 / 0 失败 / 1 跳过。

## 2026-11-25 · v0.4.3（P3：COI 重试不丢内容、会话级隔离）

### 修复

- **#48 COI 任务在重试与失败中保持内容完整**：启动前先建立内部运行记录，参数构造 / 文件准备 / 同步 spawn 失败都走同一条失败处理（不再出现"调用方拿到已启动、其实没启动"）；占用冲突在磁盘上记为已结束的失败（不再只删内存记录、留一个永远 queued 的任务）；重试保留图片、背景与完成唤醒设置，已启动过的任务复用完整提示词（避免每次重试叠加包装），准备阶段失败的任务保留重新准备所需输入；取消复用结束处理，保存尚未落盘的日志并只发一次终态通知。Windows 下长任务改由 CLI 读取完整任务文件，绕开命令行长度限制，普通 plain-cli 参数语义不变。
- **#47 提示词注入与 COI 访问按会话隔离**：注入记录目标会话，快照投影、重复检查、回合计数只影响该会话（子代理只推进自己的注入）；COI 工具 / 命令 / HTTP 入口对读取、控制、引用和会话管理使用同一层级过滤，缺少查看者身份时不返回私有或项目记录（global 仍共享）；`--continue` 先解析当前查看者可访问的已登记会话，再用明确的 session ID 恢复并检查占用锁，沿用登记的工作目录；私有任务不自动写共享摘要，项目摘要归发起工作区。**行为变化**：不带 `session.id` 的旧调用方（脚本、直接打 COI HTTP 的客户端）需要补上会话身份；历史上没有 sessionId 的注入记录不再全局投影，需在目标会话重新注入。

### 测试

- 全量 1038 例 / 1037 通过 / 0 失败 / 1 跳过。
- 新增 `tests/coi-start-failure.test.js`（启动失败不留半启动任务）、`tests/coi-process-tree.test.js`（取消 CLI 包装进程连同子进程、长任务文件传递）；`tests/coi.test.js` 与 `tests/prompts.test.js` 补会话隔离与重试用例。

## 2026-11-25 · v0.4.2（P2：轮尾星标、页面内对话框、执行目录落桶）

### 新增

- **#103 可选轨道级注入**：新增配置 `projectInjectMode` / `dailyInjectMode`（「记忆配置」面板里也有两个下拉），取值 `off`（默认）/ `tail:N` / `always`。project 与 daily 日志默认仍然**不进快照**——它们每次写入都会变，一变宿主就追加一条 runtime-context 尾消息、废掉前缀缓存；但长任务中断后要接着干、或子代理需要父项目上下文时，这份缓存代价是值得付的，所以给出开关：`tail:N` 只注入最近 N 条，`always` 全量。`off` 时渲染结果与升级前逐字节一致（回归用例钉死）。关联上游 issue #103（轨道级注入策略的第 1 项；条目级 `[inject:off]` 标记与命中驱动注入留待后续）。

### 修复

- **#86 轮尾星标恢复注入**：DSH 0.2.x 把消息操作区（含 Branch 按钮）搬到了独立的 `turn-tail` 节点，插件此前只在消息节点内部找 Branch，`findTailBranch()` 恒为 null → 会话书签的 ☆ 星标与「中间轮 fork 接管」都不再出现。现在按 `data-turn-tail` 定位每条回复的操作栏，用该轮最后一条助手消息做书签锚点；中间轮（`aria-disabled="true"`）只接管 fork、不打星；旧 DOM 结构保留兼容路径。
- **#88 原生确认框换页面内对话框**：Electron / Win32 的原生 `confirm` / `alert`（TaskDialog）关闭后不会把键盘焦点还给页面，`document.hasFocus()` 会持续 false，只能切窗口恢复（上游 electron#41602 已 not_planned）。插件 27 处调用全部改为 `confirmDialog()` / `alertDialog()`（新文件 `src/client/dialog.tsx`：Promise 化、串行排队、Esc 取消、Enter 确认、关闭后焦点还给打开前的元素），并加静态护栏用例禁止再出现 `window.confirm(` / `window.alert(`。
- **#106 project / key 记忆按执行目录落桶**：子代理、Team 成员、固定工作区可以在别的目录里干活，而 `session.header.cwd` 仍是归属项目——此前一律按 header 落桶，于是 B 项目一条记忆都没有。新增 `lib/cwd.js`（`createCwdResolver()`：显式覆盖 > 宿主 `workingDirectory` 服务 > header.cwd 兜底）与 `MemoryStore.cwdOf()`，`project` / `key` 的桶、`[git 分支]` 标注、daily 的项目标签都走同一入口；Web API / 复审 / 看板使用的伪 agent 行为不变（仍按显式 cwd）。执行目录与归属项目不一致时，快照里给一段说明（文本只依赖目录字符串，逐轮稳定，不破坏前缀缓存）。

### 测试

- 新增 `tests/snapshot-inject-mode.test.js`（5 例）：默认 off 时带不带条目输出逐字节相等、`tail:N` 只取最近 N 条且保持旧→新顺序、`always` 全量、开关值写错回落 off、无 cwd 时不注入 project、`validateRuntimePatch` 对 `off` / `tail:N` / `always` 与非法值的接受/拒绝边界。
- `tests/effective-cwd.test.js`（8 例）：解析优先级（显式 > 服务 > header）、子代理写 project 落执行目录的桶、没有 workingDirectory 服务时回退旧行为、伪 agent 不受影响、影子 agent 不改真实 header、`sameCwd` 的 Windows 归一、快照目录说明段逐轮稳定、分支标注不炸。
- `tests/client-dialog.test.js`（4 例）：源码里不得再出现 `window.confirm(` / `window.alert(`、每处 `confirmDialog(` 必须 await、实现必须有焦点还原 / Esc / Enter / 串行队列 / 无 DOM 兜底、产物含对话框类名且不含原生调用。
- `tests/client-turn-tail-star.test.js`（4 例）：源码与产物都必须按 `[data-turn-tail]` 定位、必须有 `turnOfTail` / `lastAssistantAnchor` / `enableFork(branch, anchor)`、中间轮跳过打星、幂等与重注入、旧结构兼容。


## 2026-11-25 · v0.4.1（P1：注入稳定性、采纳鲁棒性）

### 修复

- **#109** memory:snapshot 不再注入会话标题（标题是 DSH 异步提交的，必然晚于第一个 preStep 的快照组装，导致每个会话固定多一次 6–8KB 的整包 runtime-context 注入）；别名与会话 ID 保留，需要自动名称的部署可用新配置 `snapshotSessionName: true` 显式打开并接受这一次成本
- **#85 / #108** 采纳技能时，技能库若已有同名「半装」目录（没有 SKILL.md）改为**合并安装**：待确认侧文件覆盖同名、技能库侧独有数据文件保留，不再抛 `EPERM`（Windows）/ `ENOTEMPTY`（macOS）把用户卡在「装不上也消化不掉队列项」的中间态

### 文档

- **#73** 补回 memory-consolidate 技能的「轨道能力差异」说明（archive 只支持 memory/user/key，project/daily 无归档能力），并把 `x-version` 2 → 3 让已装机的旧副本能同步到

## 2026-11-25 · v0.4.0（版本页按安装方式分流 + 只读发布检查）

### 变更

- **「版本」页按安装方式分流**，不再对所有人显示一个失效的按钮：`git clone` 安装（目录里没有 `.git` 就没有）继续保留一键更新这条开发者路径；市场 / `dsh plugin add` 安装明确显示「由插件市场管理」，给出可复制的升级命令，并把原来那句「不支持自动检测 / 请用 git clone 重新安装」换成解释性的安装形态说明（`lib/update.js` 新增 `detectInstallKind()`，状态接口新增 `installKind` / `pluginVersion`）
- **只读的发布检查**（新文件 `lib/release-check.js`）：24 小时最多一次匿名 `GET` GitHub Releases 最新发布，只读 `tag_name` / `published_at` / `html_url`，与本机 `package.json` 版本比对；404（只打了 tag 没建 Release）时退回 tags 列表，且优先语义化 tag、避免日期制 tag（如 `v26092801`）被误判为最新；结果缓存在 `release-state.json`，断网 / 限流 / 超时静默沿用上次结果，**不下载、不安装、不重启、不需要 token、不上传任何内容**
- 导航红点在包安装形态下改由上面的只读检查驱动（原来只由 git 检测驱动，包安装永远是 0）

### 修复

- 只读检查的 tag 比较复用 `lib/update.js` 的 `compareVersions()`，但该函数吃的是 `parseVersion()` 的对象而不是字符串，直接传字符串会静默判等——新模块用 `cmpTags()` 显式包装并归一化 `0.3.0` / `v0.3.0`

### 文档

- 重写主指南 `README.md` 与 `README.en.md`：按「这个仓库是什么 → 快速开始 → 30 秒认识（工具表）→ 11 个场景 → 配置速查 → 常见问题 → 开发与维护 → 发版流程」重组，补齐 v0.2.0/v0.3.0 带来的行为变化（记忆检索排序、渐进式披露、队列就地更新、设置迁到全局 Settings、样式归属、附件名推断、Windows 修复与安全提示），并加 CI/版本/许可徽章
- 新增 `CONTRIBUTING.md`（提 issue/PR 的流程、硬性要求、提交说明风格、代码约定）、`SECURITY.md`（插件权限边界、已实现的防护、漏洞上报方式）、`docs/README.md`（文档索引）
- 新增 `.github` issue 模板（问题报告 / 功能建议）与 PR 模板；关闭空 issue，安全漏洞引导到私密漏洞报告
- `README-详细说明.md` 顶部加文档状态与版本同步说明；「设置入口」章节改为 v0.3.0 的全局「设置 → Memory Evolve」（指南 / 配置 / 版本），安装命令改为本 fork 的 GitHub 源
- README 补「怎么知道自己有没有新版？」（两种安装方式各自会发生什么），FAQ 的「『检查更新』按钮不起作用？」改写为按形态分流

## 2026-11-24 · v0.3.0（并入作者停更后积压的社区修复）

### 变更

本版把作者停更后积压的社区修复一次性并入（8 项，均保留原作者署名）：

- **#102**（by [@NameLess](https://github.com/NameLess)）IM 发文件不再变成 `file.bin`：显式文件名 > 路径 basename > URL basename 逐级推断。
- **#78** 待确认队列就地更新：采纳 / 归档 / 拒绝只删对应行，不再整块重拉、不再清空其他条目未提交的编辑。
- **#79** § 分隔符约束从「读取时的提示」前移到「写入时刻」，写之前就看到规则。
- **#101** 记忆检索三级语义 + `rank` 排序（新增 `lib/memory-rank.js`：中文二元组 TF-IDF + 关键词覆盖，整句提问不再必然返回空）。
- **#70** memory / user 轨渐进式披露（`auto | off | on`，默认 off；开启后注入量实测 -78.9%）。
- **#111** 插件设置移入 DSH 全局 Settings 页，不再单独占一个 Tab。
- **#60**（by [@师忠港](https://github.com/shizhonggang)）跨设备采纳改逐文件拷贝，中途失败不留半成品目录（`EPERM` / `EXDEV` 的温床）。
- **#56**（by [@dsh-external](https://github.com/dsh-external)）+ **#89** 样式注入补 `data-plugin` 归属、且不再随 dispose 移除——修「热重载后整页掉 CSS」。
- 另含两处 Windows 修复：超时杀 git 子进程改用 `taskkill /T`（原先孙进程会变孤儿、定时同步越攒越多）、测试里的 detached 子进程不再弹出黑色控制台窗口。

### 修复

- **热重载 / 插件回收后整页掉样式（`<style>` 没有 `data-plugin` 归属，#89、#83、#56）**：DSH 客户端用 `<style>` 上的 `data-plugin` 维护样式归属账本——物化插件时会把页面上**所有没有归属的 `<style>`** 认领到该插件名下，插件重载时再按归属删除。本插件 11 处运行时注入只写了私有标记（`data-memory-evolve-css` 等）却没写 `data-plugin`，于是双向受伤：自己的样式被之后物化的任意插件认领走、那个插件一重载就整页没 CSS（刷新才恢复），本插件重载时又会把别人的孤儿标签一起删掉。修复分两步：**A. 补归属** —— 新增 `src/client/style-tag.ts`（`STYLE_OWNER = 'dsh-memory-evolve'`，归属键必须等于包名＝Loader 条目 id），11 处注入（`src/client/index.ts` 的 10 个 `ctx.effect` 与 `src/client/canvas-grok/index.ts` 的 `injectCanvasStyles()`）统一改为 `claimStyleOwnership(tag)`，守卫分支命中已存在标签时**顺手抢回归属**（修复历史遗留的误认领）；**B. 不随 dispose 移除** —— 注入守卫（「已存在就跳过创建」）叠加「dispose 时 `tag.remove()`」会形成「新一轮不再创建、卸载阶段删掉上一轮那张」的死局，合并上游 PR #56（by [@dsh-external](https://github.com/dsh-external)）把 11 处改为**注入一次、不注册移除动作**（样式是文档级常量，随文档销毁）。自查：页面 Console 里 `document.querySelectorAll('style:not([data-plugin])').length` 应为 0。
- **确认 / 删除一条待确认记忆会让整个记忆 Tab 重刷一遍（列表闪「加载中」、没提交的编辑被清空）**：症状是在「待确认」子 Tab 上每点一次采纳 / 归档 / 拒绝，整块界面就重新加载一次，连点几条很卡、手感断断续续。拆开看是三条链路叠在一起：① 会话页 Tab 上的待确认红点数字只能靠「dispose + 重新注册 slot」刷新（DSH `ui-slots` 的 `register()` 只返回 dispose，没有就地更新 label 的 API），而重新注册会让 `MemoryTabView` 整体卸载重建；② 队列状态与编辑草稿都留在组件里，重挂即回到 `null` → 闪「加载中」→ 再拉一遍；③ 每次操作成功后客户端都调 `load()` 把 `/api/suggestions` + `/api/pending-skills` + `/api/config` **三个接口全量重拉**，并顺手 `setEdits({})` / `setTargetPicks({})` 把用户在其他条目上**还没提交的正文编辑与改轨选择一起清掉**（草稿原先按服务端 1-based 序号存，删一条后面条目整体前移、草稿必然错位，所以只能全清）。一次点击 ≈ 6 个 HTTP 请求 + 一次整 Tab 重挂 + 一次编辑丢失。修复分两步：**A. 就地更新** —— `lib/review.js` 的 `approveSuggestions` / `rejectSuggestions` / `archiveSuggestions` 报告新增 `removedIndices`（**真正离开队列**的 1-based 序号；写失败、归档失败、待办功能关闭的条目会留在队列里且**不列入**），客户端据此精确删掉那几行、不再重拉；紧随其后再做一次**静默对账**（只重拉 `/api/suggestions` 一个接口，不清空界面、不闪空窗、不丢草稿）——`removedIndices` 报的是服务端处理请求那一刻的位次，与本地快照之间可能已有别的会话入队，对账一次即可消除位次漂移；待确认技能同样按名字就地移除。**B. 状态提到模块级** —— 新增 `src/client/memory-queue-store.ts`，队列数据、编辑草稿、目标轨选择、配置草稿都放在模块级（记忆 / 技能 / 待办 / 设置四个共用本视图的 Tab 一起受益），重挂只是重渲染；草稿改按「条目稳定键」（时间 + 轨 + 正文）存，删除条目不再错位，因而可以只清理被删条目的草稿、保留其余未提交的编辑。记忆 Tab 的文件列表（`MemoryTabView`）同样加了按会话分桶的缓存：重挂先用缓存渲染，只有缓存过期（10s）才后台刷新，文件页签行与条目列表不再闪空窗；刷新失败时保留旧数据，不再把已有内容清空。**副作用（有意）**：本地队列在操作成功后即视为与服务端同步（30s 新鲜期），此窗口内的 Tab 重挂不再多余地拉一次列表；超过新鲜期仍会静默刷新一次，刷新期间旧数据继续显示。

### 测试

- 新增 `tests/suggestion-report.test.js`（6 例）：钉住 `removedIndices` 的准确性——写失败的条目必须留在队列且不列入（少报会让界面「点了没反应」，多报会吞掉没写成功的条目）、重复建议算作已消费、reject 的跳号与不存在序号不虚报、归档失败保留、待办功能关闭时待办建议保留而记忆建议照常处理。`tests/api.test.js` 的 approve/reject 用例增加路由透传断言。
- 新增 `tests/client-queue-inplace.test.js`（8 例）：与 `client-config-save.test.js` 同款的**源码 + 构建产物**静态契约——操作路径必须走 `applyRemovedIndices(report.removedIndices)` / `removePendingSkill(name)` 而不得回到整块重拉、不得再出现 `setEdits({})` 整体清空、队列状态必须来自模块级 store、草稿必须按 `suggestionKey(entry)` 读写（同时请求体仍按服务端原始序号对齐）、产物必须随源码重建。
- 新增 `tests/style-ownership.test.js`（4 例）：静态护栏——每处 `document.createElement('style')` 之后必须紧跟 `claimStyleOwnership(tag)`、每处「已存在则跳过」的守卫必须抢回归属、归属键必须等于 `package.json` 的 `name`、构建产物 `lib/client.js` 里注入点与归属标记必须一一对应（防止改了源码忘记重建）。

## 2026-11-24 · v0.2.0（首个社区维护版本）

### 变更

- **本仓库改由社区维护**：原作者 `csyangwen` 自 2026-10-30 起停止更新，11 月起 issue 无人回复（积压 42 条）。本仓库是 `EscapeKarma` 接手的 fork，安装地址改为 `github:EscapeKarma/dsh-memory-evolve`；原作者版权行按 MIT 保留，`package.json` 补齐 author / contributors / repository / homepage / bugs / keywords，README 与客户端内文案同步更新。功能行为不变。
- **首次接入 CI**：`.github/workflows/test.yml` 在 ubuntu-latest 与 windows-latest 上跑全量测试（Node 24，并禁止 `describe/it/test.only` 混入），另在 ubuntu 上校验 `pnpm install --frozen-lockfile && node scripts/build.mjs` 之后 `lib/client.js` 与源码一致——防止改了 `src/` 忘记重新构建（产物是提交进仓库的）。
- **Windows 开发可重复**：新增 `scripts/test-win.mjs`（`pnpm test:win`），为测试注入 git 身份与 `init.defaultBranch=main`；没有这套环境变量的机器上会出现 55 个与本插件无关的假红（`Author identity unknown` / `src refspec main does not match any`）。配套新增 `docs/DEVELOPING-WINDOWS.md`。
- **构建不再依赖原作者本机**：`scripts/build.mjs` 改为先找仓库内 `node_modules/esbuild`，找不到才回退 `DSH_SOURCE`；`esbuild@0.28.1` 进 devDependencies，并用 pnpm 11 的 `allowBuilds`（`pnpm-workspace.yaml`）放行它的构建脚本——pnpm 11 对被忽略的构建脚本直接以 1 退出，会让 CI 的构建 job 假失败。

### 修复

- **中文系统下首次同步被误判成「远端分支已删除」（#75，阻塞）**：`runGit()` 没有固定子进程 locale，`git fetch` 的报错文本随系统语言变成中文（`找不到远程引用`），而 `lib/sync/worker.js` 只按英文 `couldn't find remote ref` 判定，于是把「远端还没有这个分支」的首次推送误判为「分支被删」，同步直接失败。修复：`lib/sync/repo.js` 新增 `GIT_LOCALE_ENV = { LC_ALL: 'C', LANG: 'C' }` 并注入所有 git 子进程（网络命令仍额外带 `GIT_TERMINAL_PROMPT=0`）；判定正则同时补上中文兜底，且不误命中网络类错误。
- **npm / 市场安装的插件，记忆同步永远报「worker 无输出」（#110，阻塞）**：worker 入口 `scripts/sync-worker.mjs` 在 `package.json` 里没有 `files` 声明，打包时被整目录丢掉，而 `lib/sync/index.js` 仍按相对路径去 spawn 它——`spawn` 失败、stdout 为空，用户只看到一句含糊的「worker 无输出」。修复：`package.json` 补 `files`（lib / scripts / skills / vendor / docs / cordis.patch.yml / 三个 README），并新增 `tests/package-manifest.test.js` 把「运行时资源必须随包发布」钉成测试；`spawnWorker()` 增加入口缺失守卫，直接返回结构化错误并给出「插件安装不完整，请重装插件」的明确提示，而不是让上层解析空输出。
- **Cordis 4 下插件整体加载失败（#112，阻塞）**：`lib/advisor/index.js` 通过 `ctx.root` 拿 llm 服务，Cordis 4 起访问未声明的 `ctx` 属性直接抛错，导致 `apply()` 整个失败、插件的记忆 Tab 与全部工具一起消失。修复：llm 解析改为纯服务容器查询（`ctx.get('llm')` / `holder.get('llm')`，每次访问都 try/catch 兜底），并对 `root` 取不到的情况逐级回退；新增 `tests/advisor-cordis4.test.js`，用「未声明属性一律抛错」的严格 Proxy 复现 Cordis 4 行为。
- **跑一次测试就往真实技能库里写 4~5 个内置技能（#105）**：`tests/plugin.test.js` 等 4 个文件里的插件装配都不传 `skillDir`，于是走到默认的 `~/.agents/skills`，把 kimi/codex/grok/hermes-cli-calling 与 memory-consolidate 写进用户的真实技能库（还会覆盖用户改动过的同名技能）。修复：新增 `tests/helpers/isolate-skills.js` 的 `makeIsolatedApply()`，未显式传 `skillDir` 时自动注入临时目录并在进程退出时清理；4 个测试文件统一走它，`tests/plugin.test.js` 增加守卫用例，断言真实技能库在装配前后逐条一致。
- **画板打开敏感路径的拦截在 Windows 上整体失效（安全）**：`lib/canvas.js` 的拒绝清单是 `'/.ssh/' '/.gnupg/' '/.aws/' '/.config/' '/.git/' '/node_modules/'` 这类 POSIX 片段，判定用 `path.includes(denied)`；Windows 路径是 `C:\Users\…\.ssh\id_rsa`，永远匹配不上——私钥、`.git/config`、`node_modules` 都能被画板的文件代理读写、被「打开所在文件夹」直接打开。修复：新增 `findDeniedFragment()`，先把分隔符统一成 `/`、转小写、补尾斜杠再比对，并对 `.env` / `.pem` / `.key` / `.p12` 增加文件名兜底；顺带把过粗的 `'/AppData/'`（会把 `%LOCALAPPDATA%\Temp` 一起拦掉）收窄为 5 条系统凭据目录。
- **Windows 上后台命令会闪出控制台窗口（#95，PR #104 by [@idealistichacker](https://github.com/idealistichacker)）**：记忆/分支查询、同步 Git、文档检索的子进程都没传 `windowsHide`，每次调用窗口一闪。合并上游 PR #104（保留原作者署名），补回归测试 `tests/background-processes.test.js`。
- **自定义技能目录换一种写法删除会 404**：`lib/skills-manager.js` 用 `indexOf` 做严格字符串比较，同一目录写成正斜杠、全大写或 Windows 短路径（`RUNNER~1`）就删不掉。修复：新增 `samePath()`（统一分隔符 + Windows 忽略大小写）并先按原文、再按 `realpath` 比较，删除成功后返回实际移除的路径。

### 测试

- 全量 **913 例 / 911 通过 / 0 失败 / 2 跳过**（Windows，Node 24；两个 skip 一个是作者原有的，一个是「POSIX shebang 假 git」在 Windows 上无法模拟）。相比修复前的基线 832 通过，其中 15 个红是本仓库修复的跨平台缺陷（4 个画板敏感路径、4 个测试写死 POSIX 分隔符、3 个测试假设 macOS、2 个固定 `setTimeout` 等评审落盘导致的随机红、2 个 Windows 专属），其余是 git 身份/默认分支环境缺失造成的假红，已由 `scripts/test-win.mjs` 固化。
- 新增测试文件：`tests/sync-git-locale.test.js`、`tests/package-manifest.test.js`、`tests/advisor-cordis4.test.js`、`tests/helpers/isolate-skills.js`、`tests/background-processes.test.js`。
- 测试侧的两处健壮性修复：`tests/advisor-api.test.js` / `tests/advisor-optin.test.js` 把「等评审落盘」的固定 `setTimeout(20)` 换成轮询式 `settle()` / `waitForRecords()`（机器慢时随机红，产品侧 fire-and-forget 逻辑不动）；`tests/search-docs.test.js` 的 provider 断言改为「配置列表的子序列」，不再要求 CI runner 必装 `rg`。

## 2026-11-04

### 修复

- Windows 后台记忆/分支查询、同步 Git 和文档检索子进程不再创建可见控制台窗口（#95）。用户主动打开文件或外部界面的行为不变。
## 2026-11-01

### 修复

- **`de_notify` / `de_channel_send` 附件文件名丢失：IM 侧全显示成 `file.bin`**：工具 schema 声称 path/url 来源的附件「fileName 缺省自动推断」，但发送内核（`lib/notify.js`）此前把原始附件对象**原样透传**给渠道 `entry.sendMedia`——`path`/`url` 渠道插件各自会读，唯独没人从路径里把展示名抠出来；渠道侧拿不到 `fileName` 时只能兜底成 `file.bin` 占位名（实测：发安装包 `Cloudreve-Music-Player-0.2.80-x64-setup.exe`，用户飞书里收到的显示名是 `file.bin`，内容完好但文件名全部失真）。修复在内核层做**单一来源**推断 `withInferredFileName()`：显式 `fileName` > `path` 的 basename（同时支持 `\` 与 `/` 分隔，Windows 宿主路径也能推对）> `url` 路径的 pathname basename（query 串自动剥离）；`base64` 来源推不出就**保持缺省**（内核不发明名字，渠道侧兜底语义不变）。`de_notify` 与 `de_channel_send` 两条发送路径统一接入，web 渠道不受影响（其图片附件走 `resolveAttachments` 独立命名链路）。

### 测试

- `tests/notify.test.js` 新增 8 例：① path 无 fileName → 推断出 basename（含中文文件名）；② url → pathname basename 且剥离 query；③ 显式 fileName 优先于 path；④ base64 无 fileName → 原样透传不发明名字；⑤ Windows 反斜杠路径两分隔符都能取末段；⑥ `de_notify` 附件路径同样生效（两内核单一来源）；⑦ content 并入 caption 与 fileName 推断共存不互踩；⑧ 畸形 url 不崩溃、fileName 保持缺省。变异检验：摘掉 `withInferredFileName` 两处接入点后 5 例转红、恢复后 `notify.test.js` 50/50 全绿。

## 2026-10-30

### 修复

- **「对话区加宽」「消息气泡加宽」两个开关在 DSH 0.2.x 上完全无效——CSS 变量被子元素声明遮蔽 + 气泡锚点已被官方移除（issue #99）**：现象是开关能开、`html[data-dsh-ui-wide-chat]` 属性正常挂上、localStorage 也正常写入，但**宽度纹丝不动**，反复关闭再打开同样没用——因为 JS 侧只负责挂属性，宽度全由 CSS 决定，而两条 CSS 规则都不命中。
  - **根因一（对话区加宽）**：`--dsh-chat-content-width` 的声明位置在 0.2.x **下移了一层**。0.1.x 声明在 ConversationRoot 根 div（`.root`，挂 `[data-phase]`），旧规则写在那里是对的；0.2.x 改为声明在 `.body` 上——`--dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width,0px) * .64), 920px))`，而 `.body` 正是 `[data-conversation-content]` 挂载的元素。CSS 自定义属性按**最近的声明**生效，写在外层 `[data-phase]` 的值被子元素自己的声明完整遮蔽，**不是 specificity 不够**（加 `!important` 到外层同样无效，子元素声明永远更近）。修复：双锚点并写（`[data-phase]` 保留旧版兼容 + `[data-conversation-content]` 命中新版声明处），取值改 `100%`——0.2.x 的兜底 clamp 上限是 920px，宽视口下写 95% 只比 920px 多二十几像素，观感仍是「没变」；100% 同时解除这个固定上限。
  - **根因二（消息气泡加宽）**：旧锚点 `[data-time-hover-root]` 是 0.1.x 的 MessageItem 属性，0.2.x 已移除（全页 `querySelectorAll` 计数 0，源码里 MessageItem 也 0 命中），现在用户消息行只挂 `[data-pending-steering]` 与 `[data-submission-echo]`——后者是提交中才出现的瞬时状态，不能当稳定锚点。新版真正的宽度上限在 CSS Modules 类上：`.userStack { max-width: min(calc(var(--dsh-chat-content-width, 748px) * .702), 82%) }`。修复：改用 `[class*="_userStack"]`（hash 前缀随构建变化、`_userStack` 后缀稳定；该后缀在整个 `@deepseek-ai/*` 包里只在定义处与映射表各出现一次，无误伤），并外层补 `[data-conversation-content]` 收窄作用域；取值 80% → 92%。
  - **手机端同源失效**：`mobile.css` 第 10 节的两条规则（对话区满宽 100%、气泡满宽 100%）用的是同一批锚点，一起失效，已同步改为双锚点与 `_userStack`。
  - **测试**：新增 `tests/wide-chat-anchors.test.js`（5 例），读 CSS 源文本做静态断言——锚点必须落在变量的**声明处**、不得再出现 `[data-time-hover-root]`、取值必须是 100%、`_userStack` 必须被 `[data-conversation-content]` 限定。这类失效**不会让任何运行时测试变红**（属性照挂、开关照存、没有任何报错），只能靠静态断言钉死；已用 HEAD 版 CSS 反向验证过这 5 例全部报红（非假绿灯）。
  - **实测**（DSH 0.2.1-rc.3，1256×808 与 1920 视口）：1256 视口对话列 680 → **905px**、1920 视口 920 → **1569px**；用户气泡 `max-width` 82% → **92%**；关闭开关后 680px / `min(477.36px,82%)` 完整回退，无横向溢出（`scrollWidth == clientWidth`）。源码依据：`@deepseek-ai/dsh-client-ui-chat` 的 `ConversationRoot.module.css` 与 `MessageItem.module.css`。

## 2026-10-29

### 修复

- **技能管理 Tab 整块显示不出来：`skills listing failed: Cannot read properties of undefined (reading 'startsWith')`（DSH 0.2.1-rc.2 兼容，阻塞级）**：界面只报一句 "skills listing failed"，实际是两层问题叠在一起。
  - **第一层（直接崩点）**：`isProtectedSource(source)` 无条件 `source.startsWith('project')`，而 0.2.1 起 `ctx.skills.register()` 注册的「运行时技能」允许**不带 `source`**——本机实例里 `dsh-purge-flash` 注册的 `armor-playbook` 就是这种形态；宿主 `toSummary()` 把 `source: undefined` 原样透传，`GET /skills-manager/api/skills` 在 `skills.map(...)` 里抛错 → 整个接口 500（POST disable 也一起崩，因为同样经过 `isProtectedSource`）。修复：`isProtectedSource` 做类型守卫（非字符串一律视为「非保护」），新增 `sourceLabel()` 把缺省 source 兜底成 `'runtime'`（与宿主 `RUNTIME_SKILL_PROVIDER` 语义一致），前端徽标/筛选拿到的永远是字符串；客户端 `sourceClass()` 同步加守卫，避免任何异常值把列表打成白屏。
  - **第二层（就算不崩也是空列表）**：0.2.1 的 skills 服务按 scope 分层——skill-local 注册进 agent preset 的 scope 层，`skills.register()` 的运行时技能挂在 global 层。插件原来靠 `agentPresets.standingKeyFor()` 取默认 preset 的 standing scope，**该方法已被上游删除**（本次用 `cordis_inspect` 现场核对：新版只剩 `serviceFor(agent, 'skills')` 与 `acquireScope(id?)`），`resolveScope()` 于是恒返回 `undefined` → `list()` 只读 global 层，用户的 17 个 `~/.agents/skills` 技能一条都不显示。修复：按官方 `packages/api/session-controller/src/skill-catalog.ts` 的解析顺序重写为 `resolveCatalogView(sessionId)` —— ① `ctx.agents.get(sessionId)` 取活跃 Agent；② `ctx.agentPresets.serviceFor(live, 'skills')` 取 preset 挂载组内的 skills 实例（取不到就用宿主注册表），`scope` 传 **Agent 本体**；③ 冷会话/无会话退到 `acquireScope(默认 preset).key` 的 lease（`withCatalogView()` 保证 `finally` 里释放，避免 preset 修订回收不掉）；④ 都没有服务时回退无 scope 的旧行为。列表 / 浏览 / 读 / 写 / 禁用校验 / shadow reconcile / 懒迁移**七处统一走这个视图**（此前 reconcile 与迁移各查各的，会出现「UI 看得见、模型侧 shadow 建不起来」）。接口新增 `view` 诊断字段（`session` / `preset` / `global`），下次出问题一眼看出命中哪条路径。
  - **顺带**：运行时技能没有可写的 `SKILL.md`，禁用从「写盘失败 500」改为明确的 403（`... is a runtime skill registered by another plugin and has no SKILL.md to mark`）；`reconcile` 在 `state.disabled` 为空时直接返回，不再每次目录变化都白查一次全量目录。

### 测试

- `tests/skills-manager.test.js` 新增 3 例、改写 2 例（假 `agentPresets` 已按 0.2.1 契约改为 `acquireScope()`/`serviceFor()`）：① **回归崩点**——目录里放一条无 `source`/`path` 的运行时技能，列表必须 200、该条 `source: 'runtime'` / `protected: false`，禁用返回明确 403；② **活跃会话视图**——`agents.get(sessionId)` + `serviceFor(agent,'skills')` 命中 preset 挂载组实例、`scope` 收到 Agent 本体、不借 preset lease，预设层独有的技能能显示出来；③ **冷会话/无会话**——走 `acquireScope()` 的 lease key（`view: 'preset'`），无 `agentPresets` 服务时回退无 scope（`view: 'global'`）。全量 **894 例通过**。
- 端到端：用隔离实例验证真实 composition（`--profile web` + 3099 端口 + `--patch` overlay 关掉 IM/代理插件，避免与常驻实例抢长连接）：`GET /skills-manager/api/skills` 返回 200，`view: 'preset'`，18 条（17 条 `user-agents` + 1 条 `runtime`），`armor-playbook` 的 `source` 已归一化为 `runtime`、`protected: false`。
## 2026-10-25


### 新增

- **全局轨（`memory` / `user`）渐进式披露 + 配置面板两个开关（默认 `off`＝行为不变）**：`keyProgressiveDisclosure` 只解决了 key 轨，而**全量注入的最大头是全局 `MEMORY.md`**——实测本机 486 条 / 518 KB，整份快照 260,744 字符里 257,110 字符（98.6%）来自 memory 段、2,726 字符来自 user 段。新增 `memoryProgressiveDisclosure` / `userProgressiveDisclosure`（`auto` / `off` / `on`，与 key 轨同构、彼此独立）：`on`（或 `auto` 未命中阈值）时两条全局轨改为注入 `- [日期] [短id] 摘要`，模型用 `memory action=expand+id` 取回正文——同一份数据实测 260,744 → **55,130 字符（省 78.9%）**。`auto` 的双阈值是**条目数 ≤ 20 且总字符 ≤ 8000**（key 轨的 3 条 / 1500 字符是为「关键记忆」这一小集合定的，直接沿用会把任何真实全局轨都判成摘要，故单独设阈值）；`off` 保持历史行为逐字节不变（仍在剥掉 `[id:…]` / `[summary:…]` 后全量注入），默认配置下的上下文与升级前完全一致。短 id 取条目身份证，缺身份证时用 `legacyIdFor()` 派生（确定性，不依赖 `syncEnabled`）；日期取条目头部的 `[YYYY-MM-DD]`，没有则省略该字段。注入头同步新增 `snap.memorySummaryHead` / `snap.userSummaryHead`（中英），把「用 `memory action=expand+id` 加载全文」写进提示词——摘要模式下不写这句，模型会把摘要当成记忆全文。
- **`expand` 从 key 轨扩展到 `memory` / `user` 轨**：摘要注入却没有取全文的手段就是纯损失，因此 `memory` 工具的 `expand` 放开目标（此前只认 `key`，其余返回「expand 仅支持 target=key」）。id 解析与 key 轨同一套规则——优先 `[id:xxxx]`，缺身份证时 `legacyIdFor()` 派生；命中后返回**剥掉 `[id:…]` 与 `[summary:…]` 的正文**（与 key 轨一致：程序元数据不进上下文）；未命中报「未找到 id={id} 的条目」。`msg.expandKeyOnly` / `msg.expandNotFound` 两处文案随之改为三轨通用。
- **配置面板新增两个下拉（`memory` / `user` 轨渐进式披露）**：`src/client/MemoryQueueView.tsx` 的运行时配置面板加这两项，`src/client/index.ts` 补中英label 与 hint（hint 写明阈值与实测收益；user 轨注明「条目短、收益小，一般保持 off」），保存时随 `keyProgressiveDisclosure` 等一起提交 `/api/config`。宿主侧 `RUNTIME_KEYS` 与 `validateRuntimePatch` 一并放开这两个键（非法值报「必须是 \"auto\" / \"off\" / \"on\"」）。

### 测试

- `tests/progressive-disclosure.test.js` 新增 4 例（沿用同一套 `renderSnapshot` 驱动）：① 全局轨 `off`（默认）全量注入、不出摘要行、两次渲染逐字节一致；② `on` → 摘要行带日期与短 id、正文不注入、`expand` 能按 id 取回全文并剥掉元数据；③ `auto` 双阈值（小数据量全量，条目数或字符数任一超限转摘要——阈值可调小，便于用小数据集覆盖两条分支）；④ 两个开关互相独立，非法值被 `validateRuntimePatch` 拒绝。
- `tests/client-config-save.test.js` 的面板键表补 `memoryProgressiveDisclosure` / `userProgressiveDisclosure`：该用例断言「面板保存的键集合 == 宿主 RUNTIME_KEYS 的可写子集」，漏一个就红——新开关不接进去会让保存静默丢配置。


### 改进

- **`memory list` 的 `filter` 升级为三级检索语义，并新增 `rank` 参数（修掉「整句提问必然返回空」）**：旧实现是「**整串**大小写不敏感子串 → 时间正序 → limit 截断」，有两个结构性缺陷：① 只接受**一个**子串——中文整句提问（无空格）几乎必然零命中，本机 12 问实测**整句命中@3 = 0/12**，而摘要注入模式下模型恰恰只能靠这个入口找条目（`expand` 需要 id）；② 命中后**没有相关性排序**——泛词会淹没结果（`filter=ST` 命中 171/489 条，首条还是含英文 ST 的无关条目）。新语义按优先级三级：**整串子串（旧语义，命中集逐条不变）→ 多词 OR（空白分词）→ 词法相关性召回（整句兜底，最多 20 条候选）**；`rank: true` 时对命中集再做相关性排序（中文**字符二元组** TF-IDF 余弦 + 关键词覆盖加成 + 同分时新的在前），并返回 `matched`（截断前命中数）与 `filterMode` 元数据、`limit` 截断时在 message 里明说。实现落在新模块 `lib/memory-rank.js`（零依赖、无 import、稀疏索引：共享词表 + 每条例按 dim 升序的 `Int32Array`/`Float32Array`）；`lib/store.js` 的 `query()` 与归档轨的 list 分支**共用同一入口**（此前两处各写一份子串过滤，本仓库已因此出过两次事故）。两处细节是实测逼出来的：① **打分前必须剥掉条目头部的方括号 token**（日期/`[id]`/`[branch]`/`[dsh-only]`/`[summary]`/`[git]`）——日期里的数字若参与打分，两条只有日期不同的同文条目会因"词表多了几个数字"而得分不同，「同分时新的在前」永远轮不到（本机实测翻车后修正）；② **`rank: true` 时 `recent` 的反转必须让位**，否则排序被倒过来。兼容性：不传 `rank` 时旧**整串命中集**逐条不变（含空格且整串确实命中的旧调用完全不受影响），只有"旧实现返回空"的那类查询才走新兜底；空字符串/纯空白 `filter` 视作不过滤（旧实现会按空白串匹配、返回空）。**不做向量**（本机实测：本地 `nomic-embed-text` 中文命中@3 仅 2/12，低于本模块 4/12，且要引入常驻 Ollama 依赖）。实测（本机真实记忆 489 条）：整句 P@3 0/12 → **4/12**（P@1 2/12、MRR 0.257）；带关键词 + `rank:true` 时 P@1 5/12 → **7/12**、P@3 6/12 → **8/12**、MRR 0.465 → **0.642**；489 条首次查询（含建索引）< 50 ms、缓存命中 < 20 ms；索引为稀疏定长数组，全局轨**稳态（GC 后）约 3.1 MB 堆**（建索引期间的临时对象峰值约 9.1 MB；等价 `Map<token, weight>` 口径会是 34.6 MB，切忌换回去）。

### 测试

- 新增 `tests/memory-search-rank.test.js`（12 例）。关键设计：语料**内联**在测试里（不依赖 `~/.dsh/memories`，也不依赖隐藏的浮动语料），并用「不传 rank 时与旧 `includes` 逐条一致」当作**回滚安全网**——将来有人改回旧语义，这条会先红。覆盖：分词（中文二元组 / ASCII 词）、单关键词与旧语义逐条一致、整串命中时不退化、整串无命中且含空格才退化为多词 OR、中文整句走 lexical 召回且不再为空（含 20 条上限）、相关性排序与同分裁决（新的在前）与确定性、`rank:true` 时 `recent` 不反转、程序元数据（`[id:…]`）不参与打分、489 条性能与缓存、以及工具层（多词兜底 / `rank` + `limit` 的 `filterMode`/`matched`/message 提示 / 无命中时保留旧提示文案）。已验证：把 `lib/store.js` 的三级语义退回旧的纯子串过滤，12 例中 **4 例必失败**（正是 store 与工具层那四例）。

（以下两段合并自上游 PR #98，作者 @534056668）

### 修复

- **4 个模块 5 处仍直读已移除的 `Session.events`：技能 patch 永久被拒、图片转发与「最后活动」静默失效（issue #90 / #61 / #62，与 #38 / #49 同源）**：DSH 0.1.2-alpha.4 起 `Session` 不再暴露 `.events` 数组（改为 `ownEvents()` / `snapshotEvents()` / `eventAt()`）；#38 只适配了 `lib/review.js`、#49 只适配了 `lib/advisor/*`，另有 5 处读取点漏网，而且都是「读不到就静默降级/拒绝」的形态——不报错，只表现为功能不可用：

  | 位置 | 用户可见后果 |
  |---|---|
  | `lib/skills.js` `hasReadSkill()` | `skill_manage action=patch` **永久**返回「更新技能 X 前必须先读取它」，而 `create`/`read`/`list` 正常，看起来像权限问题（issue #90；#61 报告的是同一处的另一条路径） |
  | `lib/notify.js` `resolveSessionImage()` | `de_channel_send` / `de_notify` 用 `sessionImage: true` / `attachmentId` 转发本会话图片时报「无法读取本会话事件」 |
  | `lib/notify.js` `querySessionImages()` | `de_session_images` 读不到任何图片（issue #62 的症状之一） |
  | `lib/coi/attachments.js` `findImageRef()` | 返回 `null`，调用方静默跳过 |
  | `lib/session-orch.js` `#lastActiveAt()` | 会话列表「最后活动」永远为空（issue #62） |

  修法：`session.ownEvents?.() ?? session.events`——新宿主走 `ownEvents()`、老宿主退回 `.events`，两代行为一致且不抛错。**注意不能顺手补 `?? []`**：这 5 处的守卫是 `if (!Array.isArray(events))`，用来区分「读不到（会话不在本进程）」与「读得到但为空」，补 `?? []` 会把前者短路成后者——实测 `tests/notify.test.js` 立刻红 2 例（`resolveSessionImage` / `querySessionImages` 的「如实降级」断言变成「本会话没有图片」）。

### 测试

- 新增 `tests/session-own-events.test.js`（3 例）：① `hasReadSkill()` 在只有 `ownEvents()` 的会话形状下必须为 `true`（否则 issue #90 复发）、无 `ownEvents` 时退回 `.events`、两者都无时保守 `false`；② `resolveSessionImage()` 在 `ownEvents()` 形状下能读到本会话图片；③ 「读不到会话事件」与「读得到但没有图片」必须给出不同结论（钉住上面那条 `?? []` 陷阱）。
- 相关套件全绿：`skills` 13、`skills-manager` 18、`notify` 42、`notify-web` 4、`coi-attachments` 12、`session-orch` 18、`broadcast-image` 19、`plugin` 35。
## 2026-09-29

### 修复

- **记忆写入的分隔符约束只有拒绝、没有预告——模型要撞一次错才知道**：`§` 是记忆文件的条目分隔符（`lib/store.js` 的 `ENTRY_DELIMITER = '\n§\n'`），正文携带会在下次解析时**静默把一条拆成两条**，所以 `add` / `replace` / 归档重写三处一律拒绝。拒绝本身是对的，问题在**约束只出现在错误信息里**：模型在「决定写什么」的那一刻看不到它，只能写完被拒、再改写重试（实测同一会话连续两次被拒，第二次的成因还是「为了解释这条规则，把该字符本身写进了正文」）。修复＝把约束前移到**写入时刻可见的三处**：① `param.content` 参数描述（中英）写明不得包含该字符、带即整单拒绝、引用章节改写为「节 N.N」，并显式提示「解释这条规则时也不要把该字符写进正文」；② `param.entries` 补同一约束（每轮收尾的批量写是主路径）；③ 快照收尾写入指引 `snap.batchWriteDuty` 与 `snap.keyDuty` 各补一句「写入前自查」（这是模型计划本轮写什么的那一刻）。另把拒绝文案（`msg.sectionContainsDelimiter`）从「只说不能」改成「不能 + 怎么改」（删掉该字符后重试；引用章节改写为「节 N.N」）。纯文案增量、机制零变化；新增 `tests/separator-disclosure.test.js` 把「写入前可见」钉成回归契约（含注入必红负向自测）。

## 2026-09-28

### 修复

- **会话格式 v4 下插件注入消息会让接收方那一轮整轮失败（issue #68，阻塞级）**：DSH 0.1.7-rc.2 起会话持久化走 format v4，每条消息的 `source.kind` 必须由生产者自报（canonical 形态 `plugin:<包名>`，校验在 `@deepseek-ai/dsh-session-format-v3-to-v4` 的 message-sources 模块，持久化侧同规则）；v3 时代的「裸 `kind: 'plugin'` + 并列 plugin 字段」被**显式拒绝**：`format v4 message requires a producer-owned source kind`。插件有 4 处注入点仍在用旧写法——会话广播 / COI 通知（`lib/coi/index.js` 的 `deliver()`）、COI 任务状态通知（`lib/coi/scheduler.js` 的 `#deliver()`）、写冲突警告（`lib/coi/ws-coord.js` 的 `userMessage()`）与工作区活动公告板（同文件）。报错发生在**接收方会话认领该事件时**，所以症状是"注入所在的那一轮整轮失败"，而不是注入调用本身报错；又因为公告板需要活跃会话 ≥2、写冲突与 COI 通知靠事件触发，表现为"重启就好、过一阵复发"——重启只是清空了公告板基线 / 节流状态，并非修复。修复：新增 `lib/coi/source.js` 导出唯一常量 `PLUGIN_SOURCE_KIND = 'plugin:dsh-memory-evolve'`（与宿主 `producerKind()` 对未知生产者的映射一致），4 处全部改用它并删掉 `plugin` 字段。读取侧无需改动：`advisor` 用自己的 `kind: 'advisor'`，`review.js` 的 `lastTurnWasMessage()` 判 `undefined || 'user'`，新 kind 的语义不变。
- **带 `[summary:…]` 的条目在记忆 Tab 无法删除 / 编辑 / 归档，归档页也无法移回主记忆 / 删除（issue #59）**：根因是**展示层剥了程序元数据、匹配层没跟上**——`buildMemoryFiles()` 下发前会剥掉 `[summary:…]`（渐进式披露，2026-08-17 引入）与 `[id:…]`（2026-08-11 引入），前端 `MemoryTabView` 把这份展示文本当 raw 回传；而 `findExactIndex()` 只对 `[id:…]` 免疫，`peekExact()` 用 `includes()` 严格相等，归档侧 `ArchiveStore.removeExact()` 更是 `entries.indexOf()` 严格相等（**连 `[id:…]` 都不免疫**——启用 Git 同步后写入身份证的归档条目一律删不掉），`promoteArchived()` 的 `includes` 子串又被 `[summary:…]` 从中间截断。同一类问题第二次发生（第一次是 `[id:…]`），结论写进代码注释：**展示层每剥一种新元数据，匹配层必须同步扩展**。修复：`lib/store.js` 新增并导出 `normalizeForMatch(entry) = stripEntrySummary(stripEntryId(entry))`；`findExactIndex()` 改用它，并新增 `{ first }` 选项（主轨多条命中仍报歧义、保守拒绝；归档允许重复条目，取首条）；`peekExact()` 改走 `findExactIndex` 并**返回磁盘原文**（归档「先写后删」因此保留 `[id:…]` / `[summary:…]`，转正回主轨不丢元数据）；`ArchiveStore.remove()` 与 `removeExact()` 两侧统一归一化；`promoteArchived()` 的 `hits` 与随后的 `archive.remove()` **必须同一套基准**——只修 `hits` 不修 `remove` 会出现「转正成功但归档那条删不掉」→ 同一内容同时留在主轨与归档，且全程没有报错提示。
- **`runGit()` 的 30s 网络超时实际不生效——超时只杀直接子进程，Promise 可能永不 settle（issue #69，阻塞级）**：`git ls-remote` / `git fetch` 会再派生 `git-remote-https`，它**继承并持有** stdout/stderr 管道写端；Node 的 `'close'` 事件要等所有 stdio 句柄关闭才触发，而 `resolve()` 只挂在 `'close'` 上——超时回调虽然把 `git` 杀了，`'close'` 却永不触发，于是 Promise 挂死。实测（本地 TCP 黑洞，比不可路由地址更确定）：修复前 120 秒内 Promise 从未 settle；修复后 **30022 ms 返回 `{ok:false, code:null}`** 并在 stderr 末尾标注超时。影响不止"卡一次"：同步在 systemd user timer 下周期运行，一次挂死就让调用方永远拿不到失败原因，`node --test` 跑 `tests/sync-*.test.js` 也会整片挂住。修复三层一起做：① `settle()` 单次落定——超时 / error / close 谁先到谁生效、后到的丢弃，否则会出现"超时返回失败、随后 close 又翻案成成功"；② 超时**主动 resolve** 一个失败结果，不再等 close；③ 落定后 `killGitTree()` 尽力清理——`detached` 进程组 + `kill(-pid)` 连带孙进程（Windows 无进程组信号，退回 `child.kill()`），并 destroy 两路管道让 `'close'` 得以触发。顺序上必须**先落定、再清理**：反过来的话 destroy 管道触发的 `'close'` 会抢在超时结果之前 resolve 成一个假的成功。`NETWORK_TIMEOUT_MS` / `LOCAL_TIMEOUT_MS` 一并导出，供回归测试按真实阈值推进假定时器，避免测试另抄一份阈值后与实现漂移。
- **内置技能同步：`skillDir` 哨兵显式落地 + 成功/失败都不再静默（issue #67）**：issue 报告的"第二层"（`config.skillDir` 默认 `null` 未解析就传给 `syncBuiltinSkills()` 并抛 TypeError）**经复测不成立**——`resolveConfig()` 自首个提交起就有 `config.skillDir = resolve(config.skillDir ?? join(homedir(), '.agents', 'skills'))`，而 `apply()` 是先 `resolveConfig()` 再 `installCoi()`，调用点拿到的从来是字符串（实测 `resolveConfig({}).skillDir` → `C:\Users\…\.agents\skills`；本机 `~/.agents/skills` 里五个内置技能俱全，`memory-consolidate` 的落盘时间正是插件启动那一刻）。真正成立的是 #58 的第一层：调用点在 `installCoi()` 内、而 `installCoi` 由 `coiEnabled`（默认 false）门控——**默认配置下内置技能不会同步**，这一层由同批的 `e73a28e` 一并解决（见下条）。本次修的是 #67 里仍然值得修的三点：① 调用点显式兜底 `config.skillDir ?? DEFAULT_SKILL_DIR`（新增导出常量，与 `resolveConfig()` 的解析结果由测试钉成一致），`syncBuiltinSkills()` 则对非字符串入参抛**看得懂**的错（点名参数 + 指出该用 `resolveConfig()` 还是 `DEFAULT_SKILL_DIR`），不再把 Node 的 `The "path" argument must be of type string` 抛给上层；② 每次同步都落一行可见日志（目标目录 + 总数 + 更新数），`action: 'missing'`（插件包内缺该技能 = 打包事故）单独 warn，catch 打完整堆栈——此前成功路径只在有变更时 log、失败路径只有一行 warn，"技能从来没装上"只能靠反查技能目录的 mtime 才能发现；③ **顺带修掉同一路径上一个 Windows 专属缺陷**：`skillVersion()` 的 `^---\n` 只认 LF，而 Windows 上 `core.autocrlf=true` 检出的 SKILL.md 是 CRLF——源与目标都解析出 0，版本门控退化成"永远相等"，**x-version 升级在 Windows 上静默失效**（首次安装因目标不存在仍会复制，所以只有"升级不生效"这一半可见；本机 `~/.agents/skills` 里那五个技能正是这么来的）。改为 `^---\r?\n…` 后 CRLF 与 LF 解析一致。同源的 `normalizeSkillText()` 在 CRLF 下也把已有 frontmatter 误判成"没有"并叠加第二份头，一并改为按 `trim()` 比较边界行（不重写用户文本的换行）。
- **内置技能同步被 COI 开关连带关闭：默认配置下内置技能永远装不上（issue #58）**：`syncBuiltinSkills()` 的调用点原本在 `installCoi()` 内，而 `installCoi` 由 `coiEnabled` 门控（默认 `false`——本插件本职是记忆/待办/技能，调度是按需增强），于是 `memory-consolidate` 与 kimi/codex/grok/hermes 四个 CLI 使用指南在**默认配置下永远不会进技能库**；调用点又包着 try/catch 只打一行 warn，连"从来没跑过"都留不下痕迹（与 §7.5 broadcast 当初"独立子模块挂在 COI 下拆不开"是同款事故）。修复：同步提到插件主装配（`lib/index.js` 的 `apply()` 步骤 6.5），实现抽成 `lib/coi/skills-sync.js` 的 `syncBuiltinSkillsIfEnabled(config, pluginSkillsDir?)`——**判定只看 `coiSyncSkills`，代码里不再出现 `coiEnabled`**；`PLUGIN_SKILLS_DIR` 一并移过去并导出（供测试断言源头确实在包内），`installCoi()` 内的调用与模块级常量删除，该模块只剩适配器指南的写入需要 `normalizeSkillText`。`coiSyncSkills` 的语义随之明确为"启动时是否把内置技能同步到技能库"，与调度开关无关。
- **收尾的 key 建议没写明用哪个工具（issue #58 第二项）**：`snap.keyDuty` / `snap.subagentKeyTail` 只说"另向 target=key 提交 1 条建议"，而 `memory_suggest` 的 target 白名单是 `['memory','user','todo-life','todo-work','todo-project','todo-daily']`（`lib/review.js`），**不含 key**——照字面选工具即报"不支持 target=key"，会话收尾会反复踩。走待确认队列的正规通道是 memory 工具的 `add`（与 `memory_suggest` 共用 `enqueueSuggestion` 队列）。两处文案改为"另用 memory 工具 action=add 向 target=key 提交 1 条建议（走待确认队列，用户确认后写入并注入）"，中英同步。

- **适配 DSH 0.2.0-rc.1：settings 服务读接口与提交事件改名（静默降级，无报错）**：升级前机械比对新版 `packages/extensions/tool-cordis/src/api-catalog.ts`（老 0.1.5-rc.2 → 新 0.2.0-rc.1）发现两处破坏性变更——① `ctx.settings.get(ns)` **被移除**（新版改为 `describe(options?)` 返回 `SettingsDescriptor[]`，每项 `{ ns, value, schema, revision, … }`，按 `ns` 自行查找；`register`/`installSection` 同时移除）；② 提交事件 `settings/updated(ns, next, prev, source)` **改名为** `settings/document-updated(ns, revision)`。插件有四处依赖：宿主侧语言解析（`lib/i18n.js`）、`de_models` 的供应商目录（`lib/models.js`）、会话编排按模型名解析 provider（`lib/session-orch.js`）、以及 `apply()` 里跟随语言切换的监听器（`lib/index.js`）。旧代码在新宿主上不会报错——`settings.get` 不存在时被 `typeof` 守卫挡掉、未知事件名只是永不触发——表现为「语言设置要重启才生效」「供应商目录读不到配置（表格空白）」「spawn 显式传 model 时解析不出 provider」，属最难查的静默降级。新增 `lib/settings-compat.js` 统一封装：老宿主走 `get()`，新宿主用 `describe()` 建一次表再查 `ns`（`makeSettingsReader` 保证「每个 provider 一次 describe」的平方级开销不会出现），读不到一律返回 `undefined` 按未配置处理、绝不抛错；监听器同时订阅新旧两个事件名（`SETTINGS_CHANGE_EVENTS`），两代宿主都能就地跟随。`ctx.get` 本身抛错也吞掉降级（读服务不该带崩 `apply()`）。
- **同类排查结论（本次一并核对，无需改动）**：服务目录 91 项、事件 81 项、`ctx` 继承 API 9 组逐条比对——插件使用的 `tools`/`agents`/`sessions`/`sessionPersistence`/`sessionTitle`/`skills`/`llm`/`webServer`/`workspaceRegistry`/`commands`/`systemPrompt`/`fs`/`approval`/`attachments` 方法集**零删减**；被移除的 `agent/session-start`、`settings/updated` 事件与 `codeRuntime`/`e2b`/`ctx.hmr` 插件均未使用；会话格式 `SESSION_FORMAT_VERSION` 3 → 4 由宿主按「世代文件」（`session.v4.jsonl.zstd` 旁挂，v3 原文件保留）自动迁移，插件按事件 id 记录的书签锚点不受影响；客户端模块加载契约（`window.__ModuleLoader__.load({id, factory})`）、静态模块表（react / react-dom / `@deepseek-ai/dsh-client-ui-primitives`）、`ctx.slots.inject/register`、客户端 `locale.bind/register` 全部未变。`agent/created` 仅返回值类型放宽为 `undefined | Promise<undefined>`，插件监听器同步返回，兼容。
- **供应商目录读取兜底**：`de_models` 与会话编排原来直接调用 `ctx.settings.get(...)`（`lib/models.js` / `lib/session-orch.js`），新宿主上会直接抛 `TypeError`；现改走兼容层，并保留原有的「读不到就按未配置处理」语义（不改变表格与 provider 解析的行为，只换读取通道）。
- **客户端崩溃级适配一：ui-primitives 图标导出被改名（旧名不是别名、是删除）**：DSH 0.2.0-rc.1 把图标导出从**尺寸后缀**改成**字重后缀**——旧 `IconWarningOutline16` / `IconChevronDownOutline14` / `IconFolderClose16` / `IconLoadingOutline16`，新 `IconWarningOutlineRegular` / `IconChevronDownOutlineRegular` / `IconFolderCloseRegular` / `IconLoadingOutlineRegular`（另有 `…Medium` = 1.3px 描边、`…Artwork` = 单图元）。旧名在新宿主上 `git grep` 零命中，即**彻底删除**；`import { IconWarningOutline16 }` 拿到 `undefined`，React 渲染 `undefined` 组件立刻抛 "Element type is invalid"，**技能管理 Tab 与画板 Tab 整块 UI 崩掉**（只在升级后才暴露，本地测试与宿主端日志都看不到）。新增 `src/client/ui-icons.ts` 跨版本解析层：`resolveIcon(新名, 旧名)` 按「`…Regular` → 旧 `…16`/`…14` → `…Medium` → 渲染 null 的空实现」四档解析，两代宿主共用同一份 bundle；`SkillsBrowser.tsx`（12 个图标）与 `CanvasView.tsx`（2 个图标）改为从这里 import，`src/client` 下不再有任何文件直连 `@deepseek-ai/dsh-client-ui-primitives`。新旧 `…Regular` 与旧 `…16` 同为 16×16 viewBox、默认 `size=16`，视觉一致。
- **客户端崩溃级适配二：切换会话入口 `sessions.open` 被移除**：旧宿主 `ctx.sessions.open(id)`（`ClientSessions.open`，0.1.5-rc.2 的 `packages/api/session-controller/src/client/sessions/service.ts:270`）在 0.2.0 里被删掉（同文件只剩内部 `waitForOpen`/`attachOpening`），官方改走 `ctx.uiWorkspace.openSession(id)`（官方 `ui-chat/src/client/apply.ts` 同款迁移）。旧写法编译期无感、加载期不报错，**只在用户点「跳转到会话」时抛 `TypeError: ctx.sessions.open is not a function`**（站内通知铃铛跳转、画板 footer「跳转」按钮）。新增 `src/client/client-compat.ts` 的 `openSessionCompat(ctx, id)`：老宿主优先走 `sessions.open`（行为一字不变）、新宿主回退 `uiWorkspace.openSession`、两者都不可用返回 `false`；两处调用点（`src/client/index.ts`）改走它，`ctx.get` 抛错也吞掉。

### 变更

- **内置技能 `memory-consolidate` 升 `x-version: 2`（外部 PR #58 第三项，按原文摘取）**：补四类实战边界——① **同一轨的写操作串行执行**（同一个 `.md` 是读-改-写，交错执行会互相覆盖、也会撞上 drift guard；一个簇处理完再动下一个）；② **`replace` 是整条替换**：`content` 必须给完整新全文，只传增量或新句子会**静默吞掉**其余段落（2026-09-16 实证：更正一条多段记忆时只写新句子，其余段落整条丢失，靠 memories 仓库的 git 备份才找回；改写前先用 `list`、key 轨可用 `expand` 把原文读全）；③ **key 建议用 memory 工具 `add`（`target=key`）提交，不要用 `memory_suggest`**（后者 target 白名单不含 key，传入即报「不支持 target=key」）；④ 新增「四、故障处理（异常兜底）」——drift guard 报「无法解析往返」拒写时的逃生路径（先备份 → 用插件自带 `lib/store.js` 做 `serializeEntries(parseEntries(text))` 规范化并校验往返条数不变 → 回到工具流程），以及「判断条目是否粘连只认 `parseEntries(text).length`」（用正则数 `\n§\n` 会因正文里逐字引用的内容性 `§` 假阳性）。技能正文取自 PR #58 的 `d78043d`，与该提交逐字节一致。**注意：这一项只有在本版之后才真正装得上**——此前 CRLF 检出下 `skillVersion()` 解析出 0、版本门控退化成"永远相等"，Windows 上 x-version 升级是静默失效的（见上）。

### 测试

- 新增 `tests/injection-source-kind.test.js`（4 例）：① 复刻宿主 v4 准入规则并做**前提自检**——该规则必须拒绝退役写法、且通过 canonical 写法，否则后面的断言都是假绿；② `PLUGIN_SOURCE_KIND` 的形状与准入；③ 扫描 `lib/` 不得残留退役写法；④ 扫描四处注入点必须引用同一常量（防未来新增注入点时又手写一份 kind）。行为侧证据落在既有用例上：`tests/coi.test.js`（会话广播 / 房间动态 / COI 完成通知）与 `tests/ws-coord.test.js`（写冲突 `additionalContexts` / 公告板）直接断言真实构造出来的消息对象满足 `source.kind === PLUGIN_SOURCE_KIND` 且 `source.plugin === undefined`；`tests/plugin.test.js` 与两个 advisor 用例里按旧写法构造的桩数据同步更新。
- 新增 `tests/store-display-match.test.js`（12 例）。关键设计：展示文本取自**真实的 `buildMemoryFiles()`**，测试里没有复刻一遍剥离逻辑——展示层将来再剥一种新元数据时，这些用例会跟着一起红，而不是"测试全绿、线上仍坏"。覆盖：`normalizeForMatch` 只剥头部（正文里的 `[summary:…]` 字面量不动，且两条只差该字面量的条目仍分得清）；主轨删除 / 编辑（时间戳与摘要原样保留）/ 分支范围 / `[dsh-only]` 四个精确操作；`peekExact` 返回磁盘原文；归档页删除（带 summary 与**只有 `[id:…]`** 两种，后者单独钉一条）；归档重复条目取首条；`promoteArchived` 转正后**断言归档文件已清空**（防"只修 hits 不修 remove"的半吊子修复）；以及"归一化后多条命中 → 保守拒绝、一条都不动"。已验证：把 `normalizeForMatch` 退回旧的"只 stripEntryId"行为后，12 例中 5 例必失败。
- 新增 `tests/sync-git-timeout.test.js`（7 例，其中 1 例 POSIX 专属）：注入**永不 emit `'close'`** 的假子进程（等价于"孙进程占着管道"），用 `mock.timers` 按真实阈值推进，断言「未到点不得 settle」「到点必须 settle 且带超时说明与命令行」「迟到的 `'close'` 不得把结果翻案成成功」「两路管道被 destroy」「正常路径与 spawn 报错不受影响」。为避免回归退化成**挂死**——旧实现下 Promise 永不 settle，直接 `await` 会让测试进程一直挂着而不是报错——等待改用 `setImmediate` + `Date.now()` 轮询的真实时间预算，超预算直接抛出明确断言。另加一条 POSIX 专属用例：真实 detached 子进程 + 真实孙进程（正是 `git → git-remote-https` 的形态），验证 `kill(-pid)` 把整棵树清掉；Windows 没有进程组信号（也没有 SIGKILL 语义），跳过——Windows 上的保证是"调用方不再被拖住"，孙进程可能活到它自己超时。已验证：把超时回调退回旧的"只 kill 不落定"，7 例中 4 例必失败，且是**明确的断言失败而非挂起**。
- 新增 `tests/skills-sync-default-dir.test.js`（6 例）：① `DEFAULT_SKILL_DIR` 与 `resolveConfig({}).skillDir`、`resolveConfig({ skillDir: null }).skillDir` 必须一致（哨兵解析只有一处权威，防两处定义漂移），显式配置不被覆盖；② `syncBuiltinSkills(ps, null | undefined | '')` 抛的错必须点名 `userSkillsDir`、指出正确做法，且**不含** Node 的 `The "path" argument must be of type string`；③ 打包守卫——`BUILTIN_SKILLS` 每一项都必须真的在插件包 `skills/` 里且有含 name/description 的 frontmatter（把运行期静默的 `action: 'missing'` 变成红测试）；④ 用插件包真实内容同步：五项全部落盘、零 `missing`、二次全 `unchanged`；⑤ **CRLF 下 x-version 升级必须生效**（把新版正则退回 LF-only 后该例必失败——已验证）；⑥ `normalizeSkillText` 在 CRLF 下不叠加第二份 frontmatter，缺字段与未闭合仍要报错。
- 新增 `tests/skills-sync-decoupled.test.js`（8 例）：源头在包内（`PLUGIN_SKILLS_DIR` 指向仓库 `skills/` 且五项齐全）；**`coiEnabled:false` 不影响同步**（issue #58 的要害）；`coiSyncSkills:false` 是唯一关断开关（`coiEnabled:true` 也照样不同步，且连技能库目录都不创建）；`skillDir` 哨兵落到 `DEFAULT_SKILL_DIR`（用**空的内置源头**避免写入真实技能库，目标目录改由日志行断言）；同步抛错收口成一条带原因的 warn 并返回 null；每次启动都汇报结果（含最常见的"共 5 个，更新 0 个"）；源头缺失时逐个记 `missing` 并 warn；目标路径被同名文件占位时同样收口不抛。
- `tests/plugin.test.js` 新增两条**装配级**用例（跑真实 `apply()`）：`coiEnabled:false` 时五个内置技能必须落盘、`coiSyncSkills:false` 时连技能库目录都不创建。已验证「摘掉主装配调用」后第一条必失败。同文件的快照用例补上第二项的断言：key 建议必须点名 `memory 工具 action=add`，且不得出现 `memory_suggest target=key`（防止文案退化回"没写工具名"）。
- 新增 `tests/settings-compat.test.js`（13 例）：老宿主 `get()` 路径、新宿主 `describe()` 路径、服务缺失 / `get` 抛错 / `describe` 抛错 / 返回非数组 / 空 `ns` 一律 `undefined`、`makeSettingsReader` 的批量语义（新宿主只 `describe()` 一次；老宿主每次实时 `get()`）、事件名常量、`resolveLocale` 在新老两种形态下都解析出 `en`。
- `tests/plugin.test.js` 新增 1 例集成用例：`apply()` 在 get 形态与 describe 形态两种 settings 服务下、监听 `settings/updated` 与 `settings/document-updated` 两个事件名都能就地切换语言（`document-updated('models')` 不得误改语言）。
- 新增 `tests/client-icons-compat.test.js`（5 例静态护栏）：除 `ui-icons.ts` 外禁止任何 client 源文件 import ui-primitives；TSX 里禁止残留 `…16`/`…14` 旧名；shim 里旧名只能作为 `resolveIcon` 的兜底参数出现；每个 `resolveIcon(新名, 旧名)` 的新名以 `Regular` 结尾、旧名以 `16`/`14` 结尾；构建产物 `lib/client.js` 同时带新旧两套名字（证明解析分支没被静态折叠）。
- 新增 `tests/client-compat.test.js`（6 例）：`openSessionCompat` 在「有 `sessions.open`」「只有 `uiWorkspace.openSession`」「两者都无」「空 id / 抛错的 `ctx.get`」四种情形下的选择与降级；`src/client` 里禁止再出现 `ctx.sessions.open(...)` 直调（注释除外）；产物里同时含 `uiWorkspace` 与 `openSession`。该用例直接 import `src/client/client-compat.ts`（Node 22.18+ 原生剥离类型，无需构建）。
- 全量 842 例通过（840 存量 + 2 新增文件）。

---

## 2026-09-15

### 修复

- **记忆正文被同步链路持续损坏成 U+FFFD 替换字符（根因，阻塞级）**：MEMORY.md 与 daily 日志里长出 `�`（线上实证 45 处、跨四天静默累积；本机 4 个 daily 文件 11 处），格式预检（`isCanonical`/parse→serialize 往返）**照样放行**，所以一直没人发现。根因在**同步读路径**：`runGit()`（`lib/sync/repo.js`）收集子进程输出用的是裸 `String(chunk)` —— Buffer 的 `String(chunk)` 等价于 `chunk.toString('utf8')`，即**每个管道分块各自独立解码**；git 大对象按 32 KiB 块写管道，任何跨块边界的多字节字符（汉字 3 字节、emoji 4 字节）都被切成两段无效序列、各解码成一个 U+FFFD。传播链：`readTreeFiles()`（读远端 theirs / merge-base base）→ 损坏文本进场 → `mergeEntries` → 写回 → 提交 → 下次同步再把损坏读回来继续切，**逐轮累积**。法证：损坏文件所在提交的两个父提交都是 0 处损坏，合并结果却有 2 处，下一轮 2 → 3；4 个损坏文件的干净版本里，损坏字符起始字节偏移为 32766 / 32767 / 32766 / 81913 ——前三个**恰好跨越字节 32768**。修复：改为 `setEncoding('utf8')` 流式解码（Node 内部 StringDecoder 在分块边界保留半截序列、由下一块补齐）。同款问题一并修掉三处：`lib/sync/index.js`（worker 子进程 stdout/stderr，stdout 末行是 JSON，损坏会导致解析失败）、`lib/search-docs.js`（文档检索 `out += chunk`，损坏字符进检索结果）、`lib/coi/scheduler.js`（COI 任务日志，启动/恢复两条路径，损坏字符直接落进用户看的日志）。`runGit()` 顺带新增 `opts.spawnFn` 注入点（测试用，使"分块边界"可确定性复现）。
- **文档检索输出上限改按 UTF-8 字节计**：`lib/search-docs.js` 的 `maxBytes` 保护此前用 `out.length + chunk.length`（字符串 UTF-16 单元与 Buffer 字节混用）。改用 `setEncoding` 后 chunk 是字符串，沿用 `.length` 会把中文按 1/3 字节少算，故改为独立累计 `Buffer.byteLength(chunk, 'utf8')`。

### 测试

- 新增 `tests/sync-utf8-stream.test.js`（14 例）：注入假 spawn + 手动 `push` 的 Readable，把 2 / 3 / 4 字节字符在**每一个内部切点**分成两次投递（stdout、stderr 各 6 例），加逐字节最坏分块与真实子进程冒烟。每例都带"同一分块序列交给旧的逐块解码必然损坏"的**前提自检**，切点失效会直接失败而不是假绿。已验证：回退解码修复后 14/14 必失败。（第一版回归用真实子进程 + 60 ms 定时分写，经外援复核证伪为**可假绿**——父进程稍慢，两段就被合并成一个 data 事件，已改写为注入式。）

---

## 2026-09-14

### 修复

- **记忆正文里的 `{{...}}` 会把会话「毒死」（issue #53，阻塞级）**：宿主的系统提示词段渲染器把段正文里的 `{{name}}` 当模板变量解析，**未注册变量直接 throw**（宿主只注册 `provider`/`model`/`cwd`）。而 `memory:snapshot` 段把会话标题/别名、`memory`/`user` 轨、项目 KEY 轨的**原文**直接拼进去，此前只对提示词注入轨做了净化——于是记忆里出现一个字面量 `{{xxx}}`（真实案例：记录 `x-opencode-session: {{session}}` 这条事实）就等价于给所有注入该轨的会话埋雷：**该会话每一步、每一轮都起不来，且无法用 memory 工具自救**（工具调用需要回合，而回合已经起不来），只能手改记忆文件。现改为**整段快照在离开插件前统一净化**：`sanitizeSnapshotBody` 新增 `expand` 选项——注入轨保持 `expand=true`（用户写的就是待展开模板），记忆轨与整段快照用 `expand=false` **只降级不展开**（记忆里的 `{{date}}` 是用户记录的字面事实，展开会篡改内容；降级为 `{date}` 既保语义又让宿主不再解析）。`buildMemoryContext`（只喂外部 COI 执行器、不经过宿主渲染器）不做净化。渲染侧净化意味着**升级插件后已中毒会话自动恢复**，无需改动用户数据文件。
- **advisor 启用后每回合报 `TypeError: events is not iterable`（issue #49）**：与 issue #42 / PR #38 同源——DSH 0.1.2-alpha.4+ 的 `Session` 不再暴露 `.events` 数组，当时修了 `lib/review.js` 却漏了 advisor 装配层的 `session/event` 接线，监听器把 `undefined` 转给 observer，`findLastMessageTurnEnd` 对其做 `for...of` 即抛错。现沿用同款三档兜底 `session.ownEvents?.() ?? session.events ?? []`（新宿主走 `ownEvents()`，老宿主回退 `.events`，都拿不到时给空数组）。

### 新增

- **内置技能 memory-consolidate：记忆合并梳理（外部 PR #50）**：把随时间累积出的重复条目、新旧并存版本、相近分散表述，按七条标准（覆盖更新 / 相近合并 / 字面去重 / 冲突裁决 / 项目经验下沉 / 过期状态清理 / 跨轨归位）整合归档。硬边界：只走 memory 工具（`replace`/`archive`/`add`，禁直改 `.md`、禁 `remove`，保证可逆）、daily 日志与待办不参与合并、key 轨新增仍走用户确认队列。附带零依赖只读预扫脚本 `scripts/scan_memory.mjs`（`§` 条目解析 + CJK 二元组 TF-IDF 相似度 + 覆盖线索 + 冲突极性聚簇），只做候选发现、不做裁决与写操作。

### 变更

- **收尾规则改为两步式：先记记忆、再输出完整回复（外部 PR #52）**：原规则要求把完整回复与 memory 工具调用放进同一条消息，但 DSH 中**带工具调用的消息结束不了 turn**，必然逼出一条多余的收尾消息；而 `transcriptView` 默认 `compact`（折叠已完成 turn 的过程、突出最终输出）高亮的是**最后一条**消息，于是高亮到的是那条无意义收尾而不是完整回复。现改为：① 本条消息只发写入工具调用（不写正文）→ ② 下一条消息输出完整回复（无工具调用，结束 turn）。完整回复因此成为最后一条、被 compact 正确高亮。注意 `snap.turnEndHead` 文案里不出现 dtodo 字样——该行不受 `todoEnabled` 控制，待办的收尾指导由受控的 `snap.todoHint` 单独承担。
- **内置技能同步升级为「整目录复制」（外部 PR #50）**：此前同步只复制 `SKILL.md`，现改为整目录（`scripts/` 等辅助文件随技能一起分发），版本门控与用户编辑保护语义不变（目标 `x-version` 不低于内置时不覆盖）。**行为变更**：版本升级时目标目录会被先清空再复制，用户自加在内置技能目录里的文件会被删除。

---

## 2026-09-09

### 修复

- **「Memory Evolve 设置」里勾选「记忆写入看门狗」保存后刷新即失效**：`MemoryQueueView.saveConfig()` 手工拼了一个固定 patch 对象发给宿主，键列表是**手写**的——`perTurnWriteGuard`（看门狗开关）与 `writeGuardThreshold`（阈值）有控件、`draft` 绑定也在（勾选立即变化），却没进 patch，于是 POST body 里根本没有这两个键，宿主 `updateRuntime()` 收不到、`plugin-state.json` 不落盘，刷新后 GET 回显仍是默认 `false`；因为界面读的是本地 draft，保存瞬间还显示「配置已保存」，问题只在刷新后才暴露。修复：把两个键补进保存 payload（TS 源码 + 构建产物 `lib/client.js` 同步重建），并新增回归测试 `tests/client-config-save.test.js` 钉住「面板 draft 绑定键 ⊆ saveConfig 发送键」这条契约（同时断言源码与产物键集合一致，防「改了源码没重建」），已验证还原修复后该测试必失败。

---

## 2026-09-08

### 修复

- **记忆 Tab 子导航被 DSH 宽度手柄遮挡、部分元素无法点击（issue #40）**：DSH 0.1.2-rc 起会话列两侧渲染「拉宽」用的宽度手柄（absolute 全高、z-index 8、拦截点击的 col-resize 竖条，元素带 `data-width-handle`，宽度 `min(40px, (100% - --dsh-chat-content-width)/2 - 48px)`）。插件的管理 Tab 是**占满整列宽**的面板（不随 `--dsh-chat-content-width` 收窄），把对话框拉宽后手柄条正好压住顶部子导航行（指南 / 全局规则 AGENTS.md …），元素被遮挡、点击被手柄拦截。修复思路与 DSH 官方对全宽 overlay 视图的先例一致（官方在 `ConversationRoot.module.css` 用 `.root:has([data-conversation-composer-overlay]) .widthHandle{display:none}` 关掉手柄），插件侧新增 `[data-phase]:has(...) [data-width-handle] { display: none }`，**一次覆盖全部 11 个 Tab 的根容器**（`.mt-panel` 记忆/技能/待办/设置/模型/同步、`.me-panel` UI 设置/版本/指南、`.coi-root` COI、`.bb-pane` 广播、`.pm-root` 提示词、`.bm-panel` 书签）——任一插件 Tab 挂载期间隐藏手柄，切回会话等视图自动恢复；拉宽偏好（`--dsh-chat-user-width`）本身不受影响，回会话 Tab 仍可拖拽。选择器用 `[data-phase]` 属性而非 CSS-module 哈希类名（`.root` 被哈希化选不中），该属性在 DSH 里非唯一但其它持有者不含上述根容器，不会误伤。
- **子代理快照不再注入 dtodo 收尾提示（issue #43）**：`snap.todoHint`（「收尾时调用 dtodo list 检查到期……有到期未完成项就在回复末尾提醒用户」）是**面向真人会话**的职责——子代理不向用户直接交付（结果回父会话），也不该替父会话提醒待办，注入只会诱导它多调一次 dtodo 白烧 token。同一函数内 review 计数、写入看门狗、收尾标题、写入文案早已按 `isSubagent` 降级，唯独此处漏了豁免。补齐后子代理快照不含任何 dtodo 收尾指导（头部工具清单的事实陈述保留：dtodo 工具对子代理确实注册可用）。新增回归测试，已验证「还原修复后测试必失败」。
- **review 每回合报「turn-stopping 处理失败：Cannot read properties of undefined (reading 'length')」（issue #42）**：DSH 0.1.2-alpha.4+ 的 Session 不再暴露 `.events` 数组，旧代码读取得到 `undefined` 后取 `.length` 抛 TypeError，经 `turn-stopping` 的 serial dispatch 冒泡，被插件的 try/catch 隔离成一条不影响回合的告警。改用 `agent.session.ownEvents?.() ?? agent.session.events ?? []` 三档兜底（老宿主回退 `.events`）。该修复此前只存在于开发轨，**本版本首次随发布交付**——只更新到上一个发布 tag（v26082401）的用户仍会看到这条报错。
- **headless profile 无法加载：依赖仅 web 运行时提供的 workspaceRegistry 服务（issue #35）**：该服务从硬性 `inject` 列表移除，改为 `ctx.get` 按需读取 + 局部注入，headless profile 不再因缺服务加载失败。
- **会话书签星标在 DSH 0.1.1-rc.2+ 全站失效（issue #39）**：官方重构了 `data-chat-anchor-key`（`node:{seq}` → `{kind.length}:{kind}{id}`，key 不再携带 seq），星标注入/列表/跳转/分支全链路失效。改为按锚点原文通用切分 kind/id（不硬编码 kind 名）+ 会话事件日志反查 `{seq, turn}`，旧记录按 seq 回退兼容；顺带修复 fork seed 的 seq 空洞越界（seq≠数组下标导致中间轮分支退化为全量复制）。
- **全盘 dir 搜索卡死（外部 PR #32）**：WALK_IGNORE 补 Windows 系统目录、maxFiles 截断后清空 pending 队列（防数千微任务级联）、defaultRoots 盘符去重。
- **Windows 下技能采纳跨盘失败**：`memoryDir`（D:）与 `skillDir`（C:）跨盘时 `renameSync` 抛 EXDEV，降级为 `cpSync + rmSync`，其余错误照抛。
- **移动端「Memory Evolve 设置」页长文本/控件溢出（issue #31）**：配置说明等无空格长串加 `overflow-wrap: anywhere`、控件加 `max-width: 100%` + `box-sizing: border-box`（不依赖移动通道，普通移动浏览器同样修复），并补上移动通道漏掉的 `.me-todo-select` 全宽规则。

### 新增

- **MEMORY.md / USER.md 页签支持手动新建记忆条目（issue #30）**：此前各文件页签中只有项目关键记忆 KEY.md 有手动添加框，用户最想随手记的长期记忆（MEMORY.md）与用户档案（USER.md）是纯只读——想让 AI 记住某条偏好/环境只能靠反复口头交代或等自动沉淀。新增 `POST /memory-evolve/api/memory/memory` 与 `/memory-evolve/api/memory/user` 端点（与 KEY 同款 `store.add` 盖戳追加，日期前缀由程序生成），前端 MEMORY.md / USER.md 页签顶部渲染同款添加框，草稿按文件分桶（切页签不丢内容），保存后清空草稿、刷新列表并提示。

> 本版本还包含 **2026-09-04** 记录的「记忆写入看门狗」与「广播投递即唤醒（wake 参数）」两项新增（见下）。

---

## 2026-09-04

### 新增

- **记忆写入看门狗（长会话防遗忘，吸收 PR #37 特性一）**：长会话中模型对「每轮收尾写 daily/project」的固定提示词逐渐失效（指令稀释），连续多轮不写记忆且程序侧毫无反馈，遗漏被静默吞掉。新增程序侧合规追踪：按会话统计「连续完成多少个用户回合未写任何 daily/project 记忆」（`writeGapCounter`，`agent/turn-stopping` 计数、subagent 不计、进程内存态），缺口达到阈值（`writeGuardThreshold`，默认 2，可在「Memory Evolve 设置 → 配置」调整）时快照注入置顶 ⚠️ 提醒，粘性直到下一次成功写入即消（key 轨确认队列不算——看门狗只盯每轮进展日志）。提醒文案刻意静态（不嵌实时计数）+ 按实际启用的写入轨参数化（单轨关闭不命令写已关轨）。**独立开关 `perTurnWriteGuard`，默认关**（用户拍板 2026-09-04：根源是模型指令遵循能力，强遵循模型不需要；打开才启用）。
- **广播投递即唤醒（de_broadcast send wake 参数，吸收 PR #37 特性二）**：研究「为什么广播有时能唤醒会话、有时不能」——根因在 DSH 核心的投递原语：广播投递一律用 `inject`（不唤醒），接收方 **running 时同回合可见（像被唤醒）**、**idle 时消息停在收件箱直到下次自然驱动（没动静）**、**offline 直接跳过**——三种状态三种观感。新增 `wake: true`（send 可选参数，默认 false 行为不变）：idle 接收方改走 `followup` 唤醒（投递到下一回合并启动驱动，等价替用户发消息，与 de_session wake / COI wakeOnComplete 同款机制；消息体带「发送方唤醒了你」标记）；running 接收方仍 inject（不打断）；offline 跳过（收件箱 + 回来补投兜底）。回执**始终**附「已唤醒 N 个空闲接收方」计数（含 0）。投递按接收方独立容错 + Set 去重（房间/项目/显式接收者重叠不重复投递、单点失败不中断）。经 Codex 独立评审与本地 DSH 0.1.2 源码实锚验证（Agent.followup/status/wakeDriver 语义成立）后合入。

---

## 2026-08-17

### 修复

- **Code Mode 启用提示词管理器后整轮失败（issue #13）**：`de_prompts` 工具参数说明不再携带宿主可解析的双花括号语法——工具 Schema 被序列化进 `tools:sdk` 系统提示词段后，说明文字中的 date/time 模板示例会被误当作未注册的 prompt variable，触发 `unknown prompt variable "{{date}}"` 并阻断后续所有回合。说明改为单花括号写法（功能不变：用户提示词正文中的 `{{date}}`/`{{time}}` 展开不受影响）。同批清理 `de_session` 工具描述中的同类残留（`{{model}}` 示例改为纯文字）。新增回归测试确保模型可见的工具 Schema 不再泄漏该语法。

---

## 2026-08-14

### 修复

- **版本更新后「当前版本」显示旧版本号**：更新成功的设备重启后，版本页出现「当前版本」仍为旧版、状态却显示「已是最新」的冲突。根因是更新事务的 fetch 使用 `--no-tags`（新 tag 只进私有引用、不落本地 refs/tags），而本地版本标识依赖 `git describe` 只能找到最近可达的旧祖先 tag。现已改为按 commit SHA 判定：HEAD 精确匹配任一发布 commit 时直接取该 commit 的发布 tag（开发轨已包含发布版本时显示最新 tag），不再信任 describe 结果；更新事务检查点同步落盘新版本号与「已是最新」状态。
- **更新成功后远端复核失败会误留更新红点**：checkout 成功后的远端重检失败不再把状态回退为 outdated（本地版本关系已由 SHA 核验确定，重检失败只记录错误信息）。
- **缓存期内手动切换版本/恢复开发轨状态陈旧**：24h 检测缓存命中时增加本地 HEAD 校验，本地提交变化立即失效重检，不再出现最长 24 小时的状态错报或假「等待重启」提示。
- **旧缓存版本号自动自愈**：已带错误版本号缓存的设备，升级后打开版本页立即显示正确版本，无需等待自动重检。

---

## 2026-08-13

### 新增

- **无限画板**：把散落各处的文件/文本/图片/音视频集中到一块无限画布上陈列的素材工作台。本地路径引用（文件留原地）、单板+视角筛选（会话/项目/全局 + 归属徽标）、无限平移缩放（LOD/虚拟化/GPU 合成性能底座）、三种上板入口（路径/便签/真实本地搜索）、画板内直接预览/复制/引用、卡片自由拖拽与右下角缩放、AI 双向（`de_canvas` 工具：按 id 查/读、往画板中央区放便签，不注入上下文）、整板 rev 乐观锁防多会话覆盖。独立子模块 `canvasEnabled` 开关，存储 `<memoryDir>/canvas/boards.json`。
- **web 站内通知**：`de_notify` / `de_channel_send` 新增 `web` 渠道——通知直达网页右上角铃铛，支持未读徽标、弹窗列表、全文查看、附件缩略图、一键跳转对应会话。
- **COI 任务列表分页**：GUI 任务子 Tab 分页浏览，任务记录多时不再一次性全部渲染。

### 变更

- **临时信息（scratch）模块移除**：画板内便签（markdown/纯文本节点，内容存画板内）已覆盖其能力，删除「临时信息」Tab、`scratchEnabled` 开关与 `/api/scratch` 路由；已有 scratch.md 内容保留在记忆目录，未自动迁移。

### 改进

- **通知机制重构——快照不再被其他模块反复拉动重注入**：COI 任务（已发起/完成）、工作区公告板（并行开始/结束/成员变化）、会话广播（新消息/房间动态）全部从上下文快照移出，改为**独立消息投递**（不打断正在进行的回合）；快照只保留身份、记忆与纪律等稳定内容。各模块变化不再连带整段快照重复注入，上下文更干净。
- **COI 完成通知只给状态与日志路径**：任务完成/启动消息不再附带日志截取摘要（长日志时截取落在正文中段、看不出结论），直接给出完整日志文件路径，AI 用 read 读取全量输出；`de_coi_status` 只查状态/取路径。
- **工作区公告板防抖**：只在真实状态变化时通知（并行开始/结束、成员变化、备注变化），会话正常运行期间不再反复刷新。
- **记忆同步改为纯 GUI 操作**：移除 `/memory_sync` 命令与快照同步状态行——同步完全由你在「记忆同步」Tab 手动触发，AI 不再参与同步执行。
- **版本检测启动即触发**：插件启动后后台自动检测一次新版本，设置 Tab 红点不再依赖手动打开版本页。
- **通知铃铛全面打磨**：SVG 图标、位置避让、移动端适配；弹窗优化（标题颜色 / 会话名称显示 / 长文大弹窗）；列表分行布局 + 已读按钮 + 标题跳转；邮件式去重、空行折叠、拖拽吸附、配色统一。
- **兼容 DSH 0812 内测版**：适配核心服务名改名（workspace→workspaceRegistry、httpServer→webServer），对外行为不变。

### 修复

- **记忆归档安全**：归档改为「先写入归档文件、成功后再删除主轨」——归档写入失败时主记忆原样保留，不再丢数据。
- **待确认建议序号对齐**：建议队列按热度排序后采纳/拒绝仍按原始序号处理，不再误操作其他条目（误采纳/误拒绝）。
- **记忆同步可靠性**：冲突解决可安全重试（git 失败不再残留半完成状态、不重复写入条目）；远端身份校验更严格（远端分支存在但身份文件缺失/损坏时拒绝合并）。
- **会话切换不再串台**：记忆 Tab 的文件列表与页签选择按会话隔离，切换会话后不再显示上一个会话的内容。
- **待办逾期判定**：改用本地日期（东八区晚上「今天」的截止不再被误标为逾期）。
- **共享记忆库地址回显**：不再误显示主代码仓库地址（避免把共享库配置改成代码仓）。
- **模型设置入口**：关闭「支持思考」后仍可重新打开编辑器（不再无路可回）。
- **手机端工具栏**：加号/模型按钮不再因增强未就绪而永久消失。
- **COI 任务恢复**：重启后不再残留「会话忙」假锁；长任务输出扫描缓冲设上限，不再无限吃内存。
- **会话评审**：总闸关闭后停止后台每秒轮询（重开自动恢复）；重置评审员时旧评审结果不再写入已清空的新会话。
- **工具描述与实际行为对齐**：工作区锁的保留时长描述修正（30 秒 TTL）、提示词与广播参数说明修正（重复键不再覆盖语义）。
- **通知详情截断**：点开通知总是拉取全文，修复 200~8KB 中长通知显示不全。
- **会话评审开关体系**：`advisorEnabled` 改为模块总闸（设置 Tab 关闭即整体停用）；修复会话级开关刷新页面后丢失；各会话默认关闭（opt-in），总闸开启后需在悬浮面板手动启用。

---

## 2026-08-12

### 新增

- **会话评审（Advisor）模块**：每个会话挂独立评审员，实时观察用户输入与回复，按 info / nit / concern / blocker 四级给出反馈；支持五层约束（系统提示词 / 全局 / 项目 / 会话 / 评审会话）；管理面板含约束 / 实时 / 记录 / 设置四个 Tab，可指令问答、查看评审员上下文规模、一键恢复默认提示词。
- **版本检测与更新**：自动检测远端新版本（git tag），设置 Tab 新增版本页（当前版本 / 最新版本 / 更新按钮 + 红点提醒）。
- **任务完成自动唤醒**：`de_coi_dispatch` 新增 `wakeOnComplete` 参数——任务完成后自动唤醒派单会话投递完成摘要，无需用户手动触发。

### 改进

- **完成唤醒无次数限制**：用户显式要求的唤醒每次都生效，与 `de_session wake` 同语义。
- **COI 输出可追溯**：`de_coi_status` / `de_coi_wait` 输出开头直接给出完整日志文件路径，无需自行搜索。

### 修复

- **提示词注入快照不再被宿主渲染器拦截**：注入正文含 `{{date}}`/`{{time}}` 等变量时，快照段渲染侧统一展开；正文里残留的任意 `{{...}}`（未知变量、malformed 引用）也一并去模板化——宿主 system-prompt 渲染器把段文本 `{{...}}` 当模板变量解析、未注册即报 unknown prompt variable 导致整轮注入失败的问题（issue #6）彻底兜底，旧版本遗留/手动编辑的注入数据同样安全。
- **会话评审四项细节**：实时流清空、悬浮窗默认隐藏、tool-call 按序显示、中文指南文案补齐。

---

## 2026-08-11

### 新增

- **记忆同步（跨设备项目记忆共享）**：项目记忆一键同步到远端，多台电脑共享同一份记忆；三层启用开关（模块 / 项目 / 轨），逐项目 opt-in 默认关闭；条目身份证机制保证双设备合并对齐；GUI「记忆同步」Tab（状态卡片 / 初始化 / 同步 / 冲突逐条解决）。
- **共享记忆仓库**：一个私有仓库装所有项目的记忆，每个项目自动使用专属分支，互不干扰；老仓库自动识别、零迁移。
- **统一单一模式**：记忆远端模型合并——默认复用主代码仓库、也可指定共享记忆仓库，每项目一条专属分支；项目待办（TODOS.md）并入项目记忆轨同步。
- **全局记忆轨**：全局记忆 / 用户档案 / 每日日志 / 待办四轨可跨设备同步（仅共享记忆仓库可用），每轨一条独立分支。
- **图片链路五大能力**：输入框图片直发 IM 渠道（`sessionImage` / `attachmentId` 来源）；COI 派单带图（codex / kimi / grok / hermes）；`de_session` 支持 Agent 预设；`de_models` 展示模型图片输入能力；会话广播图片附件（收件箱缩略图 + 延迟保留转发窗口）。

### 改进

- **记忆同步 Tab 全面重排**：三子 Tab 化（项目 / 全局 / 记忆远端）、统一推拉按钮、设备级启用开关、状态文案「未提交」改「未推送」+ ahead 统计。
- **兼容 DSH 260810 快照**：`dsh.client` 配置迁移、Agent 预设挂载，新会话工具面完整。

### 修复

- **Windows 换行事故**：Windows Git autocrlf 将记忆文件转为 CRLF 导致解析失败——新增 `.gitattributes` 强制 LF + 存量文件无损自愈，双设备同步恢复。
- **全局轨数据安全加固**：修复凭证泄漏、跨轨冲突数据风险、非法路径上传、假 dirty 重复提交等问题；全局推送被冲突拦截后可直接在界面逐条解决。
- **spawn / wake 工具面缺失**：修复 DSH 260810 下新会话与恢复会话缺少 bash / read / write / edit 的问题。

---

## 2026-08-10

### 新增

- **memory 工具多轨批量写**：一次调用同时写每日日志 + 项目日志，收尾合并为一次工具往返。
- **情绪反馈记录**：日志条目可携带用户情绪反馈（正面 / 负面 + 原话摘录），积累后可按任务分类分析满意度。

### 改进

- **大文件保护**：project / daily 无参数查询默认返回最近 50 条并附元数据，记忆 Tab 分页展示，消除长文件截断。

### 修复

- **旧插件迁移引导**：dsh-skills-manager 残留会导致 Web 整页不可用——补充醒目迁移文档与禁用列表自动迁移。

---

## 2026-08-09

### 新增

- **工作区冲突协调**：多会话并行时声明文件 / 服务占用（`de_ws_declare` / `de_ws_status` / `de_ws_release`），写前冲突检测、占用方定向通知、活动感知快照段。
- **会话书签**：每一轮可星标命名，独立列表一键跳回；从任意已完成轮创建官方分支。
- **本地文件搜索内容检索**：`memory_evolve_search_local_files` 支持文件内容关键词检索（可选参数，默认行为不变）；新增四档模式（文件名+内容 / 仅文件名 / 仅内容 / 关闭）。
- **DSH UI 设置模块**：左侧会话列表默认只显示进行中的会话；对话区加宽（约 95%）；消息气泡加宽（约 80%）。
- **立即注入**：提示词可「当前回合立即生效」注入（快照变更 + 插话），只注入一次，不受次数 / 间隔影响。
- **会话编排模块（de_session）**：spawn 程序化创建标准会话、wake 唤醒、status / list 查询；`me` 查自身信息；`rename` 改会话名称 / 别名；新会话自动挂工作区分组。
- **会话广播收件箱**：未读 / 全部 / 已读筛选 + 搜索 + 分页；房间成员在线状态持久化（重启不丢失）。

### 修复

- **内容检索漏搜**：修复全盘上万文档时目标文件扫不到的问题。
- **工作区协调实测迭代**：活动段重复注入刷屏、会话删除后锁残留、显示完整会话 ID 等。

---

## 2026-08-08

### 新增

- **de_prompts 创建 / 修改**：模型可自行创建 / 修改提示词，与 GUI 同一套校验。
- **de_prompts 多维过滤**：按名称 / 分类 / 标签 / 简介过滤，未命中时明确提示是哪个条件没匹配。
- **提示词简介与启用状态**：每条提示词可填简介、可禁用；de_prompts 工具（列表 / 详情 / 注入）上线，AI 可选择合适提示词注入当前会话或作为子任务提示词。
- **memory 工具归档**：AI 可直接归档记忆条目（memory / user / key 三轨）并查询归档内容，可逆。
- **提示词管理器交互升级**：一键预设注入（注入一次 / 持续注入 / 自定义）；临时注入（不建提示词直接注入）；次数 / 间隔自由输入。
- **会话广播房间 / 项目群**：多会话聊天室（成员跨工作目录）+ 项目公告群（按目录可见）；30 天无活动自动清理；房间 / 项目消息保留 30 天供回看。
- **会话广播管理面板**：消息收件箱、房间管理、成员在线状态；踢人 / 解散自动发送系统通知；解散软删除可追溯。
- **会话别名**：给会话起友好名称（≤10 字），快照 / 面板 / 消息显示别名优先。
- **会话搜索（de_session_search）**：搜索本机 Codex 历史会话（按项目 / 关键词，只读扫描、零常驻状态）。
- **会话页 Tab 体系重构**：记忆 / 技能 / 待办 / Memory Evolve 设置四个独立 Tab，每个 Tab 带中英双语指南。
- **会话广播独立模块**：从 COI 调度拆出独立开关与存储目录，互不影响。

### 修复

- **注入文案去歧义**：注入结果按实际行为显示（只注入一次 / 共 N 次 / 持续注入），不再误读。
- **幽灵分类可管理**：分类树中残留的旧分类可正常改名 / 删除（提示词自动迁移）。

---

## 2026-08-07

### 新增

- **提示词管理器**：提示词库 CRUD + 分类树 + 标签 + 搜索 + 使用统计；注入执行器（次数 × 间隔，支持无限 / 一次性 / 有限次）；内置 13 个来自 GitHub 真实提示词库的完整范式。
- **COI 调度模块**：统一调度 kimi / codex / grok / hermes 等外部 CLI——非阻塞后台任务、进度可视化、会话分层管理与恢复、跨 COI 接力、任务模板、用量统计、崩溃恢复；支持自定义 CLI 适配器。
- **临时信息便签**：会话页独立 Tab，持久化 Markdown 便签（跨重启保留）。
- **本地文件搜索**：`memory_evolve_search_local_files` 按文件名搜索本机文档（默认只搜文档类型，全类型需显式开启）。
- **每日待办可查过往**：`dtodo list` 支持 past / expired 查询历史；待办子 Tab 新增「过往」页签（含过期遗留）。
- **记忆条目编辑**：五轨记忆美观视图直接编辑保存（程序标记与分隔符受保护）。
- **建议队列分类**：记忆 / 待办 / 技能建议三个独立待确认 Tab；采纳时可改目标轨（记忆三轨之间）。

### 改进

- **适配 DSH 08-06 profiles 架构**：客户端注册改用 `ctx.slots.inject`，快照提示分区更清晰。

---

## 2026-08-06

### 新增

- **技能管理并入**：独立插件 dsh-skill-browser 整体合并——技能浏览 / 搜索 / 筛选 / 一键禁用启用 / 自定义目录；旧插件禁用列表自动迁移。
- **四轨待办**：生活 / 工作 / 项目 / 每日；四象限 + 截止 + 状态 tag；`dtodo` 工具（add / list / done / update / remove）与默认智能视图。
- **key 轨确认制**：模型写入项目关键记忆先进待确认队列，用户采纳后才写入并注入。
- **项目关键记忆归档**：key 条目可归档至 KEY-archive.md，可逆（可移回主记忆）。
- **git 分支感知**：记忆按分支注入与查询，日志自动带来源分支标记。

---

## 2026-08-05

### 新增

- **初版发布**：分层记忆与自我进化插件——全局事实 / 用户档案 / 项目记忆 / 每日日志四轨记忆。
- **记忆审查机制**：后台审查 + 建议队列（采纳 / 归档 / 拒绝，支持批量）。
- **Web 界面**：设置面板「记忆管理」、会话页记忆 Tab（文件内联视图）。
- **技能自我进化**：`skill_manage` 工具（严格创建门槛 + 待确认队列）。
