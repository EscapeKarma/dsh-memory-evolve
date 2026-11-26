# 文档索引

仓库里的说明文档都在这里，按用途分三类。

## 面向使用者

| 文档 | 内容 |
| --- | --- |
| [README.md](../README.md) | 主指南：安装/升级/禁用/卸载、11 个场景怎么用、配置速查、常见问题 |
| [README.en.md](../README.en.md) | 英文镜像 |
| [README-详细说明.md](../README-详细说明.md) | 详细功能参考手册：逐条展开每个能力的实现与用法（篇幅大，含历史设计记录） |
| [记忆同步.md](记忆同步.md) | 多台电脑共享项目记忆：远端、分支、冲突处理、四轨开关 |
| [COI-调度.md](COI-调度.md) | 把任务派给外部 AI 代理（kimi/codex/grok/hermes）：入口、适配器、会话分层、命令与工具参考 |
| [rules.md](rules.md) | 记忆与审查规则：五轨怎么工作、审查何时触发、什么该记什么不该记、哪些要你确认 |

## 面向开发者

| 文档 | 内容 |
| --- | --- |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 提 issue / PR 的流程、硬性要求、提交说明风格、代码约定 |
| [DEVELOPING-WINDOWS.md](DEVELOPING-WINDOWS.md) | Windows 开发环境：Node 版本、`pnpm test:win`（注入 git 身份与默认分支）、构建、排障速查 |
| [SECURITY.md](../SECURITY.md) | 插件的权限边界、已实现的防护、漏洞上报方式 |

## 变更与版本

| 文档 | 内容 |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) / [CHANGELOG.en.md](CHANGELOG.en.md) | 中文 / 英文更新日志（按日期倒序；社区维护版本从 `v0.2.0` 起逐版记录） |

## 想改文档

- 面向使用者改 `README.md` + `README.en.md`（两份要镜像）；
- 细节补充优先放 `README-详细说明.md`，别把主 README 撑得太长；
- 功能变更记得同时更新中英两份 CHANGELOG（同日合并到同一节，`## 未发布` 永远在最上）。
