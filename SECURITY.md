# 安全策略 / Security Policy

## 这个插件的权限边界（重要）

`dsh-memory-evolve` 运行在 **DSH 宿主进程内**，因此它天然拥有宿主的权限：

- 读写你的记忆、技能、待办文件（`~/.dsh/memories`、`~/.agents/skills` 等）；
- 启动子进程（`git`、`taskkill`、外部 AI CLI：`codex`/`kimi`/`grok`/`hermes`、通知命令模板）；
- 打开本地文件与"打开所在文件夹"（无限画板）；
- 读取会话数据、调用 LLM 服务；
- 通过 `de_notify` / `de_channel_send` 把内容发到你配置的 IM 渠道。

**这意味着**：不要安装来源不明的插件分支，不要随意合并陌生人提交的 PR（合并 = 给你的机器执行权），也不要把不信任的目录加进画板或技能目录。

## 已实现的安全边界

- **敏感路径拒绝**（无限画板）：`.ssh`、`.gnupg`、`.aws`、`.git`、`node_modules`、`.config`、macOS Keychain、Windows 凭据存储（Credentials / Vault / Protect / Crypto），以及 `.env*`、`*.pem`、`*.key`、`*.p12`。判定统一 POSIX 归一 + 小写（v0.2.0 起在 Windows 上真正生效）。
- **画板只读已上板节点**：没有「任意路径读取」API，AI 只能按节点 id 取已上板的内容。
- **写入确认制**：AI 自建的记忆/技能/待办先进待确认队列，用户确认才落盘（`skillReviewEnabled` 可关，默认关）。
- **同步 worker 隔离**：同步在独立子进程里跑，环境里删掉 `GH_TOKEN`/`GITHUB_TOKEN`，不把宿主凭据传给 git。
- **API 同源校验**：宿主提供的 HTTP 端点校验 Origin/Host；桌面端宿主转发场景按回环地址放行（v0.3.0，`#91`），非回环一律拒绝。
- **无运行时依赖**：不引入第三方 npm 运行时包，减少供应链面。

## 报告漏洞

**请不要开公开 issue。** 用下面任一方式：

1. GitHub 私密漏洞报告：<https://github.com/EscapeKarma/dsh-memory-evolve/security/advisories/new>
2. 或发邮件给维护者（见 GitHub 个人主页公开邮箱），标题以 `[SECURITY]` 开头。

请尽量包含：受影响的版本、复现步骤或 PoC、影响范围（能读到什么/能执行什么）、你建议的修复方向。

**响应预期**：业余时间维护，通常 7 天内确认收到；确认为真实漏洞后我会尽快修复并在 Release notes 里说明（在你同意的前提下致谢）。

## 支持的版本

只维护最新的 release（当前 `v0.3.0`）与 `main`。更早的 tag 不做安全回补，请升级。

---

## English summary

This plugin runs **inside the DSH host process**, so it inherits host privileges: it can read/write your memory and skill files, spawn subprocesses (`git`, external AI CLIs), open local files, read session data, and send content to your configured IM channels. Do not install forks of unknown origin, and treat merging third-party PRs as granting code execution on your machine.

Implemented mitigations: sensitive-path refusal for the canvas (`.ssh`, `.git`, `.env*`, `*.pem`… normalised and lowercase, effective on Windows since v0.2.0), read-only access to board nodes, confirmation queue for AI-proposed writes, sync worker isolation with `GH_TOKEN`/`GITHUB_TOKEN` stripped from its environment, same-origin/loopback checks on the plugin's HTTP endpoints, and zero runtime dependencies.

**Reporting**: do not open a public issue. Use GitHub private vulnerability reporting (<https://github.com/EscapeKarma/dsh-memory-evolve/security/advisories/new>) or email the maintainer. Include affected version, reproduction/PoC, impact and suggested fix. Acknowledgement usually within 7 days. Only the latest release and `main` are supported.
