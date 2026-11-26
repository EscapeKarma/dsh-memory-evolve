# 安全策略 / Security Policy

## 这个插件的权限边界（重要）

`@escapekarma49/dsh-memory-evolve` 运行在 **DSH 宿主进程内**，因此它天然拥有宿主的权限：

- 读写你的记忆、技能、待办文件（`~/.dsh/memories`、`~/.agents/skills` 等）；
- 启动子进程（`git`、`taskkill`、外部 AI CLI：`codex`/`kimi`/`grok`/`hermes`、通知命令模板）；
- 打开本地文件与「打开所在文件夹」（无限画板）；
- 读取会话数据、调用 LLM 服务；
- 通过 `de_notify` / `de_channel_send` 把内容发到你配置的 IM 渠道。

**这意味着**：不要安装来源不明的插件分支，不要随意合并陌生人提交的 PR（合并 = 给你的机器执行权），也不要把不信任的目录加进画板、技能目录或外发白名单。

## 已实现的安全边界

按「攻击面 → 防护」列，括号里是实现版本：

### HTTP 接口（浏览器与本地脚本）

- **宿主准入（L0，v0.7.1）**：插件路由先经过 DSH 的 `ctx.connection.requestRejection()` —— 由宿主做 Host/Origin 栅栏（回环 / 绑定地址 / `trustedHosts`）与浏览器签名 cookie 认证。宿主返回 403 直接拒绝；返回 401（没有浏览器会话的 curl / CLI）再落到下面的插件自检，避免把本机脚本一并封死。
- **插件自检（L1–L4，v0.5.0）**：写操作必须 `application/json`（跨站表单只能发 `text/plain`，被 415 拦）；`Sec-Fetch-Site: cross-site` 直接拒；`Origin` 必须与 `Host` 同值且 **Host 必须是本机回环**（防 DNS rebinding）；无 `Origin` 时要求 TCP 对端回环。**读端点同样受保护**——否则跨站能读走全部记忆。
- **远程访问默认关闭**：局域网 / 内网穿透 / 反向代理需要显式配置 `trustedHosts`（默认空数组）。
- **写端点必须 POST**：会改状态的 `memory-sync/*` 端点不再接受 GET（v0.5.0）。

### 文件与命令

- **敏感路径拒绝**（画板 / 附件外发）：`.ssh`、`.gnupg`、`.aws`、`.git`、`.docker`、`.kube`、`.netrc`、`.npmrc`、`.config`、`node_modules`、macOS Keychain、Windows 凭据存储（Credentials / Vault / Protect / Crypto）与 PSReadLine 历史；以及 `.env*`、`*.pem`、`*.key`、`*.p12`。判定统一 POSIX 归一 + 小写，并在 `realpath` 之后**再检一次**（防符号链接 / junction 绕过）。v0.2.0 起在 Windows 上真正生效，v0.5.0 起覆盖真实路径。
- **画板只读已上板节点**：没有「任意路径读取」API，AI 只能按节点 id 取已上板的内容；「打开所在文件夹」在 Windows 上不再经过 `cmd /c start`。
- **外发目录白名单**：`channelSendRoots`（默认空 = 不限制目录，但敏感路径永远拒绝）限制 `de_notify` / `de_channel_send` 能发出的本地文件（v0.6.1）。
- **CLI 适配器白名单**：只允许内置适配器 id，运行期不再接受自定义 `binary` / `args` / `testCmd`；落盘只保留展示类覆盖项（v0.5.0）。
- **子进程环境收敛**：git 与同步 worker 只继承白名单环境变量（`PATH`、代理、git 配置等），`GH_TOKEN` / `GITHUB_TOKEN` / `*_TOKEN` / `*_SECRET` / `*_API_KEY` 一律剥离（v0.6.1）。Windows 上所有子进程都带 `windowsHide`，不弹控制台窗口（v0.4.1 / v0.5.0）。
- **原子写 + fsync**：记忆、别名、书签、模型、插件状态等落盘走「写临时文件 → fsync → rename」，进程被杀不会留下半个 JSON（v0.5.1 / v0.5.2）。

### 内容与注入

- **写入确认制**：AI 自建的记忆 / 技能 / 待办先进待确认队列，用户确认才落盘（`skillReviewEnabled` 可关，默认关）。
- **注入清洗**：外部内容进系统提示前会把行首 `#` 折成全角、把 `system:` / `assistant:` 等角色前缀与标签改写，防止伪造段落（v0.5.0）。
- **条目分隔符校验**：工具写入拒绝包含 `§` 的内容，避免一条记忆被静默拆成两条（v0.5.1）。
- **零运行时依赖**：不引入第三方 npm 运行时包，减少供应链面（Mermaid 以静态文件 vendor 进仓库）。

## 报告漏洞

**请不要开公开 issue。** 用下面任一方式：

1. GitHub 私密漏洞报告：<https://github.com/EscapeKarma/dsh-memory-evolve/security/advisories/new>
2. 或发邮件给维护者（见 GitHub 个人主页公开邮箱），标题以 `[SECURITY]` 开头。

请尽量包含：受影响的版本、复现步骤或 PoC、影响范围（能读到什么 / 能执行什么）、你建议的修复方向。

**响应预期**：业余时间维护，通常 7 天内确认收到；确认为真实漏洞后我会尽快修复并在 Release notes 里说明（在你同意的前提下致谢）。

## 支持的版本

只维护最新的 release（当前 `v0.7.1`）与 `main`。更早的 tag 不做安全回补，请升级。

---

## English summary

This plugin runs **inside the DSH host process**, so it inherits host privileges: it can read/write memory and skill files, spawn subprocesses (`git`, external AI CLIs), open local files, read session data, and send content to your configured IM channels. Do not install forks of unknown origin, and treat merging third-party PRs as granting code execution on your machine.

Implemented mitigations, by attack surface:

- **HTTP routes**: DSH host admission first (`ctx.connection.requestRejection()`, v0.7.1 — Host/Origin fence plus browser cookie auth), then the plugin's own check (v0.5.0): JSON-only writes (415), `Sec-Fetch-Site: cross-site` refused, `Origin` must equal `Host` **and** `Host` must be loopback (DNS-rebinding guard), loopback peer required when no `Origin`. Read endpoints are protected too. Remote access is opt-in via `trustedHosts`.
- **Files and processes**: sensitive-path refusal (`.ssh`, `.git`, `.env*`, `*.pem`, Windows credential stores, shell history …) normalised and lowercased, **re-checked after `realpath`**; canvas exposes only board nodes; `channelSendRoots` limits outbound attachments; CLI adapters are built-in-only; git/worker subprocesses get an allow-listed environment with tokens stripped; all Windows spawns are hidden; state files are written atomically with fsync.
- **Content**: AI-proposed writes go through a confirmation queue; injected text is sanitised against forged role/heading lines; `§` is rejected in tool writes; zero runtime dependencies.

**Reporting**: do not open a public issue. Use GitHub private vulnerability reporting (<https://github.com/EscapeKarma/dsh-memory-evolve/security/advisories/new>) or email the maintainer. Include affected version, reproduction/PoC, impact and suggested fix. Acknowledgement usually within 7 days.

Only the latest release (currently `v0.7.1`) and `main` are supported; older tags receive no security backports.
