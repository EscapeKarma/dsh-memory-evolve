# dsh-memory-evolve

[![CI](https://github.com/EscapeKarma/dsh-memory-evolve/actions/workflows/test.yml/badge.svg)](https://github.com/EscapeKarma/dsh-memory-evolve/actions/workflows/test.yml)
[![version](https://img.shields.io/github/v/tag/EscapeKarma/dsh-memory-evolve?label=version&color=blue)](https://github.com/EscapeKarma/dsh-memory-evolve/releases)
[![license](https://img.shields.io/github/license/EscapeKarma/dsh-memory-evolve?color=green)](LICENSE)

> **一句话**：让 DeepSeek Harness 里的 AI 拥有跨会话的长期记忆，替你管待办与技能，还能拉起一群会话、把重活派给外部 AI 代理——**越用越懂你，换会话不丢上下文**。

相关文档：[详细功能说明](README-详细说明.md) · [记忆同步](docs/记忆同步.md) · [COI 调度](docs/COI-调度.md) · [Windows 开发](docs/DEVELOPING-WINDOWS.md) · [更新日志](docs/CHANGELOG.md) · [English](README.en.md)

---

## 这个仓库是什么

原项目 [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)（800+ star）自 2026-10-30 起停止更新，11 月起 issue 无人回复。本仓库是社区维护的 fork，由 [@EscapeKarma](https://github.com/EscapeKarma) 接手，目前已完成：

| 版本 | 内容 |
| --- | --- |
| **v0.2.0** | 修 4 个阻塞级 bug（同步误判、发布包丢 worker、Cordis 4 加载失败、测试污染技能库）+ 1 个安全缺陷（画板私钥拦截在 Windows 失效）；接入 CI；Windows 开发可重复；构建不再依赖原作者本机 |
| **v0.3.0** | 并入作者停更后积压的 8 项社区修复（#102 #78 #79 #101 #70 #111 #60 #56+#89），全部保留原作者署名；另含 2 处 Windows 修复 |

- **安装地址**：`github:EscapeKarma/dsh-memory-evolve`
- **许可**：MIT（原作者版权行按许可要求保留）
- **响应预期**：业余时间维护，issue 会看、会回，但不承诺时限
- **报问题**：<https://github.com/EscapeKarma/dsh-memory-evolve/issues>（请附 DSH 版本、操作系统、复现步骤；插件相关请附 `设置 → Memory Evolve → 版本` 里的版本号）

---

## 快速开始

插件包内自带 `cordis.patch.yml`（`dsh.bundle.patch` 声明），`dsh plugin add` 装好后 **host 端自动注册，无需手动配置**。以 web profile 为例：

```sh
# 1. 安装（也可在 DSH 插件市场里搜索 dsh-memory-evolve）
dsh plugin --profile web add github:EscapeKarma/dsh-memory-evolve

# 2. 完全退出 DSH 再打开（插件在进程启动时加载，热刷页面不会加载新代码）
```

> ⚠️ **不要再往 `~/.dsh/profiles/<name>/cordis.patch.yml` 手动 insert 本插件**：bundle patch 已自动注册，重复 insert 同 id 会让加载器报 `duplicate loader entry id` 而无法启动。若你从旧文档照做过，删掉那几行即可。

**修改默认配置**（例如开启回合内记忆审查）——用 id 覆盖（顶层写法，不是 insert）：

```yaml
- id: dsh-memory-evolve
  config:
    reviewEnabled: true      # 开启回合内记忆审查（默认关）
    reviewInterval: 10       # 每 10 个用户回合审查一次
```

更常用的是**运行时配置**：DSH「设置 → Memory Evolve → 配置」，改完立即生效、不需要重启，也不用碰 YAML。

**升级**：

```sh
dsh plugin --profile web add github:EscapeKarma/dsh-memory-evolve   # 重新 add 即拉到最新
# 然后完全退出 DSH 再打开
```

想固定版本就带上 commit 或 tag：`github:EscapeKarma/dsh-memory-evolve#v0.3.0`。

**怎么知道自己有没有新版？** 打开「设置 → Memory Evolve → 版本」，它会先告诉你**安装方式**：

- `git clone` 安装（目录里有 `.git`）：可以直接点「更新到 vX.Y.Z」，走的是本地 git 切换——这是开发者路径，会改动你的工作树；
- 市场 / `dsh plugin add` 安装（目录里没有 `.git`）：一键更新**用不了，这不是故障**。页面会显示「由插件市场管理」、给出可复制的升级命令，并用一次**只读**的 GitHub 检查告诉你有没有新版（24 小时一次，只读版本号：不下载、不安装、不需要 token，断网时沿用上次结果）。

**插件导致 DSH 起不来时临时禁用**（无需卸载）：

```yaml
- id: dsh-memory-evolve
  disabled: true
```

**卸载**：`dsh plugin --profile web remove dsh-memory-evolve`。记忆与技能文件留在原目录（`~/.dsh/memories`、`~/.agents/skills`），不会删你的数据；需要彻底清理再手动删这两个目录里属于本插件的文件。

---

## 30 秒认识

装好后，会话里会多出一排能力标签：**记忆 · 技能 · 待办 · 无限画板 · COI 调度 · 会话广播 · 提示词 · 记忆同步 · 模型设置 · 书签 · 会话评审 · Web UI 设置**；插件总览、运行时配置与版本更新在 DSH 全局 **「设置 → Memory Evolve」**（三个子页：指南 / 配置 / 版本）。

AI 侧则多出这些工具：

| 工具 | 干什么 | 默认 |
| --- | --- | --- |
| `memory` | 五轨记忆读写、按 id 展开、归档、`retag` 补/改摘要 | 开 |
| `memory_suggest` | 提议写入（进待确认队列，你确认才生效） | 开 |
| `dtodo` | 四轨待办（生活/工作/项目/每日） | 开 |
| `skill_manage` | 技能库读写、新建/更新技能 | 开 |
| `de_session` / `de_ws_*` | 拉起子会话、派活、协作房间、文件锁声明 | 随 COI 调度 |
| `de_coi*` | 把任务派给外部 AI 代理（codex/kimi/grok/hermes） | 关 |
| `de_broadcast` | 会话广播（房间消息、图片附件） | 关 |
| `de_canvas` | 无限画板读/写（按 id 取素材、放便签） | 关 |
| `de_notify` / `de_channel_send` | 通知与主动推送到 IM（飞书/QQ/微信/企微/web） | 关 |
| `memory_evolve_search_local_files` | 本地文档检索（文件名 / 内容） | 关 |

一句话概括：**让 AI 记住你、替你管、替你做、互相配合做。** 多数能力默认关闭（不占 AI 的工具清单），在「设置 → Memory Evolve → 配置」里按需打开。

---

## 场景一：让 AI 真正记住你（长期记忆）

**适合谁**：所有人。这是插件的核心，也是其他一切功能的地基。

AI 的对话是「一次性」的：换项目、隔几天、开新会话就忘了你是谁。五轨记忆让它拥有跨会话的长期工作记忆：

- **用户档案**：偏好、公司、沟通习惯——每回合都能看到；
- **全局事实**：环境、工具、惯例等长期知识；
- **项目关键记忆**：当前项目的约定、决策、架构、踩坑，自动注入上下文；重要结论可标记**只在某个 git 分支生效**；
- **项目日志 / 每日日志**：每回合自动记录进展，按需读取，可追溯。

**怎么用**：

1. 正常对话即可——每回合结束它会自动把进展写进项目日志与今日日志；
2. 发现重要事实就说「**记一下：这个项目的部署端口是 8080**」，它写入项目关键记忆，**你确认后才生效**——AI 不会擅自改记忆；
3. 换个会话直接问「**查一下记忆，上次定的架构决策是什么**」；
4. 记忆多了让 AI「**把 XX 那条归档**」，归档条目不注入、可随时转回；
5. 你对结果的评价（「太好了」「怎么还没改对」）会以 `【反馈】` 行记进当日与项目日志，积累后可以让 AI「**分析最近我对哪些方面不满意**」。

**记忆检索会自动排序**（v0.3.0）：问一句「上次那个部署脚本放哪了」，`memory` 的查询会按相关度排序返回，整句话提问不再必然返回空。

**上下文紧张时可以省注入**（v0.3.0）：`keyProgressiveDisclosure` / `memoryProgressiveDisclosure` / `userProgressiveDisclosure` 设为 `on` 后，注入的从全文变成「`[日期] [短id] 摘要`」，AI 需要时用 `expand` 取全文——memory/user 轨实测可省约 **79%** 注入字符。

---

## 场景二：多台电脑共享项目记忆（记忆同步）

**适合谁**：家里和办公室两台电脑、或要和同事共享同一份项目结论的人。

**怎么用**（详见 [记忆同步](docs/记忆同步.md)）：

1. 「设置 → Memory Evolve → 配置」打开「**记忆同步**」模块开关（只是让功能可见）；
2. 在项目会话的「**记忆同步**」Tab 打开「本项目同步」，点「开始同步」——记忆远端默认用你的代码仓库，自动存进专属分支，不污染代码；代码公开但记忆想私藏？填一个**共享记忆仓库**地址，一个仓库装所有项目的记忆，每项目一条专属分支；
3. 另一台电脑 clone 后打开——**自动认亲**（同一仓库地址 = 同一项目），拉下来继续用；
4. 平时照常写记忆（实时落盘、零延迟），攒一批点一次「同步」；两台都改了同一条才会冲突，选「采用本机 / 采用远端 / 两者都要」。

**会得到什么**：项目关键记忆、项目日志、归档、项目待办跨设备一致；填了共享记忆仓库后全局记忆也能跨设备。**没开同步的项目完全不受影响。**

> 同步依赖本机 `git`。Windows 上首次推送若报「远端分支已删除」，请升级到 v0.2.0+（修了中文 locale 误判）。

---

## 场景三：多项目并行，每件事都不丢（待办 + 本地检索）

**适合谁**：同时维护多个项目、经常被「之前那个方案是怎么定的」卡住的人。

- **四轨待办**：生活 / 工作 / 项目 / 每日；「项目」轨按工作目录隔离。说「**记住，周五前把二级面板部署到手机访问实例**」，自动落成项目待办（带重要/紧急、截止日期）；每天收尾 AI 会提醒到期项；
- **项目日志**：按目录隔离沉淀，自动带 `[git main]` 分支标记；
- **本地文档检索**：说「**搜一下本机有没有写过类似的东西**」（文件名），或「**哪个文档里提过 XX**」（内容）。Windows 走 `es`→`rg`→纯 Node 三级，级级可用、一个都探测不到也不会报错。

**会得到什么**：同时开 3 个项目也不乱——每个项目的记忆、待办、文档线索各归各的目录。

---

## 场景四：一个人指挥一群 AI（内部团队）

**适合谁**：想把 AI 用成团队的人——主会话指挥美工、前端、后端、测试多个子会话。

1. **拉起团队**：「创建 4 个会话：美工负责视觉、前端负责页面、后端负责接口、测试负责验收，拉进同一个协作房间」——自动继承你的模型与工作目录，也可指定 Agent 预设；
2. **协作沟通**：谁改了什么、谁干完了全员可见；成员状态变化会收到「房间动态」；房间消息**支持图片**；
3. **派活与催活**：「现在谁在干活」→ 查看状态；「叫前端把结果发过来」→ 唤醒并派活（不会批量自动唤醒，一切由你有意识地指挥）；
4. **防冲突**：「声明一下你要改哪些文件」——其他人能看到谁在改什么，真撞车时写入方收到冲突警告；
5. **结果回传**：各成员把结果发回房间，你汇总确认。

**持续运转的前提**：主会话所在的 DSH 进程保持运行。主会话空闲或被关掉，唤醒链就停了——回来发一条消息即可重新开动。

---

## 场景五：重活派给外部 AI 代理（外援）

**适合谁**：要把大任务（视觉重设计、深度代码审查、完整功能开发）交给专用 AI 代理的人。

1. 说「**把这个任务派给 grok：移动端适配改造**」——后台异步执行，立即返回任务号，**不卡当前会话**；
2. 随时问「**任务进度如何**」，或在「COI 调度」看实时日志流；
3. 派单可带上项目记忆，外部代理也「懂项目约定」；
4. **可带图**：「把这张截图发给 grok 分析」——支持本地路径 / 远程 URL / 本会话图片；
5. 完成后摘要**自动写入项目日志与今日日志**——派出去的活变成记忆资产。

前置条件：本机装了对应 CLI（`codex` / `kimi` / `grok` / `hermes`），并在配置里打开 COI 调度。详见 [COI 调度](docs/COI-调度.md)。

---

## 场景六：内外协同——一支队伍，两种兵种

**适合谁**：任务大到单靠一边搞不定的人。完整形态是：内部会话做「需要来回打磨的活」，外部代理做「一次性重活」，两者靠记忆、房间、提示词串成流水线。

一个真实流程（产品视觉改版）：

1. **分工**：主会话 spawn 前端、测试两个内部会话进房间；同时把「全站视觉重设计」派给 Kimi；
2. **外部主刀**：Kimi 后台跑重设计（不占会话）；内部先做数据层与页面结构，不干等；
3. **接力**：Kimi 完成，摘要进项目记忆 → 主会话把结论发房间 → 前端会话读记忆拿到设计规范，开始集成；
4. **问题升级**：前端卡在一个诡异样式问题 → 主会话派 Grok 深挖 → 结论回房间 → 前端照修；
5. **验收**：测试会话跑完验收、结果回房间，你最后确认。

四个结合点自由组合：**任务接力**（外部产出自动进记忆）、**问题升级**（内部快、外部深）、**标准统一**（派活时注入你的提示词）、**状态同步**（房间 + 工作区活动 + 通知）。

---

## 场景七：让好方法变成纪律（提示词注入）

把工作方法固化成**提示词**（可分类、可搜索、可启停）：代码审查清单、调试流程、PRD 规范、测试策略……

- **AI 自选**：觉得适用就自己查库、注入自己，下一轮自动遵循，不打断回复；
- **你一键注入**：选中一条，点「注入一次 / 持续注入 / 立即注入」；
- **临时注入**：不建库，直接输入一段要求，自动存库下次复用；
- **派活带纪律**：给子会话、外部代理派活时把提示词一起带上——整个团队用同一套标准。

---

## 场景八：会话太长、太贵、容易糊（书签 + 分支 + 占用提醒）

- **书签**：任一轮点 ☆，列出全部书签（名称/轮次/时间/摘要，可搜索），**点击跳回任意一轮**；
- **任意轮分支**：官方只支持从最后一轮分支；本插件接管**中间任意轮**的分支入口，走官方通道、进官方谱系；
- **上下文占用环**：输入框圆环实时显示占用，≥30% 变黄、≥40% 变红——提醒你打书签、开分支、开新会话。

---

## 场景九：离开电脑也能用（通知 + 手机访问 + 会话筛选）

- **渠道通知**（`de_notify`）：「任务完成用飞书通知我」→ 推到飞书/QQ/微信/企微，带「这是通知」标注，可附图片/文件；
- **站内通知**（`de_notify channels=web`）：落到网页右上角铃铛——未读徽标、弹窗列表、点主题跳会话、长文大弹窗、位置记忆（可拖动吸附左右）；
- **渠道直发**（`de_channel_send`）：不带通知标注，直接把文本/图片/文件发到 IM；附件来源支持本地路径 / 远程 URL / base64 / **本会话图片**；
- **手机访问**：DSH 界面已适配手机（对话区满宽、输入栏「⋯」收纳工具栏）；
- **会话筛选**：左侧列表可只显示进行中的会话。

> v0.3.0 起，IM 发文件不再变成 `file.bin`——没给文件名时会从路径或 URL 推断。

---

## 场景十：给每个会话配一个隐形评审员（会话评审）

**适合谁**：想让 AI 有「第二双眼睛」把关、又不想逐句盯的人。

- **独立评审员**：每会话挂一个评审会话，只看界面可见对话（用户的话 + Agent 回复正文），不看思考过程与工具参数；
- **每轮实时评审**：持续会话、上下文不截断，不会「忘了前面说过什么」；
- **需要时提醒（steer）**：发现值得说的点，以**用户指令形式**注入当前会话；GUI 里显示为带 `[severity]` 前缀的折叠行；
- **四级严重度**：`info`（默认只记录）/ `nit` / `concern` / `blocker`——不是所有话都打断；
- **四层约束**：系统提示词 / 项目约束 / 会话约束 / 本次评审会话约束，越局部越优先；
- **可提问、可重置、记录可查**。

打开方式：「设置 → Memory Evolve → 配置」开启「会话评审」（`advisorEnabled`，默认关）。评审模型默认继承当前会话，也可单独配置 `advisorProvider` / `advisorModel`。

---

## 场景十一：散落的素材，一块画板装下（无限画板）

- **三种上板方式**：路径上板、便签（内容不落盘）、搜索上板（真实搜本机）；
- **一眼看见**：无限平移/缩放，卡片自由摆放与缩放，图片/音视频/文本内联预览，Office/PDF 走系统应用；
- **单板 + 视角**：物理一块板，节点带 🌐 全局 / 📁 项目 / 💬 会话 徽标，按视角筛选；
- **AI 双向（拉取式）**：`de_canvas` 按 id 查/读/放便签，**画板内容不注入上下文**，需要时才查；
- **安全边界**：AI 只能读已上板节点；敏感目录（`.ssh`、`.git`、`node_modules`、系统凭据目录等）即使上板也拒绝代理与「打开所在文件夹」。

> v0.2.0 修了一个安全缺陷：此前这套拒绝规则在 Windows 上**完全失效**（POSIX 分隔符匹配不上 `C:\...`），私钥可被读取。请务必使用 v0.2.0 及以上版本。

---

## 还有这些（一句话索引）

- **技能自我进化**：反复踩坑的方法论自动固化成技能，下次同类任务直接按流程走；
- **技能管理**：浏览/搜索/禁用/编辑全部技能、添加自定义技能目录；跨设备采纳改为逐文件拷贝（v0.3.0），中途失败不留半成品；
- **待确认队列**：AI 提议的记忆/技能/待办都在这里，采纳/拒绝只更新对应行（v0.3.0），不会整块刷新、不丢你没提交的编辑；
- **模型配置**：维护各模型启用状态、思考等级、备注，标注是否支持图片输入；
- **回合内记忆审查**：每 N 轮 AI 主动提炼值得记住的信息交你确认；
- **版本页**（v0.4.0）：显示安装方式与当前版本；`git clone` 安装可一键更新（git tag 比对，24h 最多一次），市场 / `dsh plugin add` 安装给出可复制的升级命令 + 只读的 GitHub 发布检查——不下载、不自动安装；
- **会话搜索**：搜索本机其他 AI 工具（如 Codex）的历史会话；
- **Web UI 设置**：手机窄屏适配、消息气泡加宽、Mermaid 渲染、上下文占用提醒等开关。

---

## 配置速查

运行时配置在「设置 → Memory Evolve → 配置」，也可写在 profile 的 `cordis.patch.yml`。最常改的几项：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `reviewEnabled` / `reviewInterval` | `false` / `5` | 回合内记忆审查与间隔 |
| `reviewMode` | `suggest` | `suggest`=提议走确认队列；`auto`=直接写 |
| `keyProgressiveDisclosure` / `memoryProgressiveDisclosure` / `userProgressiveDisclosure` | `off` | `off` 全量注入 / `auto` 小数据量全量 / `on` 始终摘要 |
| `summaryMinChars` | `0` | 摘要模式下正文不超过该字符数的条目保持全文，更长的才折成摘要行。`0`=关闭（与旧版一致），建议 `400`（实测省约 61%）；相邻版本 0.5.0 起可用 |
| `trustedHosts` | `[]` | 允许访问插件 HTTP 接口的额外 Host（局域网 / 反向代理场景）。默认空 = 只接受本机回环访问；跨站请求一律拒绝。0.5.0 起可用 |
| `channelSendRoots` | `[]` | 允许通过 `de_channel_send` / `de_notify` 外发的目录白名单（绝对路径）。默认空 = 不限制目录，但敏感路径（`.ssh`、`.aws`、`.env` 等）永远拒绝。0.6.1 起可用 |
| `projectInjectMode` / `dailyInjectMode` | `off` | project / daily 日志默认不注入（每写必变，会废掉前缀缓存）；`tail:N` 注入最近 N 条、`always` 全量 |
| `perTurnWriteGuard` / `writeGuardThreshold` | `false` / `2` | 写入看门狗：连续 N 轮没写日志就提醒 |
| `todoEnabled` | `true` | 待办工具与 Tab |
| `searchDocsEnabled` / `searchDocsMode` | `false` / 未设 | 本地文档检索；四档 `all`/`filename`/`content`/`off` |
| `searchDocsExts` | `['md']` | 检索扩展名 |
| `coiEnabled` | `false` | COI 外部 AI 调度 |
| `broadcastEnabled` | `false` | 会话广播（含协作房间、`de_ws_*`） |
| `canvasEnabled` | `false` | 无限画板 |
| `advisorEnabled` | `false` | 会话评审 |
| `notifyEnabled` | `false` | 通知模块（含 web 站内通知） |
| `skillReviewEnabled` | `false` | `true`=AI 建技能直接写入，不等确认 |
| `skillDir` | `~/.agents/skills` | 技能库目录 |

完整清单见 [详细功能说明](README-详细说明.md)。

---

## 常见问题

**装完没反应？**
插件在进程启动时加载：**完全退出 DSH 再打开**（关窗口到托盘不算，要从托盘/任务管理器退出）。只刷新页面不会加载新代码。

**同步一直报「worker 无输出」？**
v0.2.0 之前的发布包漏了 `scripts/` 目录（`package.json` 无 `files`）。升级到 v0.2.0+ 即可；v0.2.0 起若仍缺文件，会给出「插件安装不完整，请重装插件」的明确提示。

**中文 Windows 上第一次同步就报「远端分支已删除」？**
v0.2.0 修了：git 子进程没固定 locale，中文报错文本匹配不上英文正则。升级即可。

**热重载后整页变成没有样式的裸控件？**
v0.3.0 修了：运行时注入的 `<style>` 补了 `data-plugin` 归属。升级后刷新一次页面即恢复。

**画板打开文件时报「敏感目录已拒绝」？**
这是设计行为（`.ssh`、`.git`、`node_modules`、系统凭据目录等）。v0.2.0 之前这条规则在 Windows 上其实没生效——请升级。

**`git push` 老是失败？**
github.com 的 443 在你这边可能不稳（`Connection was reset` / `Failed to connect`）。重试 2–4 次即可；`api.github.com` 通常没问题。判断是否成功请看 `git log origin/main..HEAD` 是否为空，别用管道看退出码。

**「检查更新」按钮不起作用？**
v0.4.0 起按安装方式分流：`git clone` 的可以直接一键更新；市场或 `dsh plugin add` 安装的目录里没有 `.git`，一键更新用不了——版本页会显示「由插件市场管理」，给出升级命令，外加一次只读的 GitHub 检查告诉你有没有新版。

**插件让 DSH 起不来怎么办？**
在 profile 的 `cordis.patch.yml` 加 `- id: dsh-memory-evolve` + `disabled: true`，启动后到仓库提 issue。

---

## 开发与维护

### 环境

- Node **≥ 22.18**（测试直接 import `.ts`，靠原生类型剥离）；CI 用 Node 24
- `git`（测试会用临时仓库）
- 构建需要 `esbuild`（`devDependencies` 里已声明，`pnpm install` 即可）
- 插件包本身**零运行时依赖**（宿主侧只用 Node 内置模块；浏览器侧只用 DSH 提供的模块；Mermaid 已 vendor 进仓库）

```sh
git clone https://github.com/EscapeKarma/dsh-memory-evolve.git
cd dsh-memory-evolve
pnpm install            # 只为了构建
```

### 跑测试

```sh
pnpm test               # macOS / Linux
pnpm test:win           # Windows 必须用这个（注入 git 身份与 init.defaultBranch=main）
```

`pnpm test` 在 Windows 上会有 55 个假红（`Author identity unknown` / `src refspec main does not match any`）——不是代码问题，用 `test:win`。当前基线：**976 例 / 975 通过 / 0 失败 / 1 跳过**。Windows 专项说明见 [docs/DEVELOPING-WINDOWS.md](docs/DEVELOPING-WINDOWS.md)。

### 改客户端代码后必须重建产物

`lib/client.js` 是提交进仓库的构建产物（DSH 直接加载它）：

```sh
pnpm build              # src/client/*.tsx -> lib/client.js
git status              # 有改动就把 lib/client.js 一起提交
```

CI 的「构建产物与源码一致」job 会在 ubuntu 上重跑一遍构建并比对，忘了重建会红。客户端只能 import `scripts/build.mjs` 里 `EXTERNALS` 表内的宿主模块，否则打包会把宿主包塞进产物、运行时爆炸。

### 目录结构

```
lib/             宿主侧手写 ESM（插件入口 lib/index.js、记忆、同步、COI、画板…）
src/client/      浏览器侧 TSX（59 个文件，esbuild 打成 lib/client.js）
tests/           72+ 个测试文件，~976 例
skills/          随插件同步到技能库的内置技能（5 个）
scripts/         build.mjs（构建）、test-win.mjs（Windows 测试）、sync-worker.mjs（同步子进程）
docs/            CHANGELOG、记忆同步、COI 调度、规则、Windows 开发
vendor/          mermaid.min.js
```

### 提 PR

1. 从 `main` 切分支，改完跑 `pnpm test:win`（Windows）或 `pnpm test`；
2. 改了 `src/client/` 记得 `pnpm build` 并提交产物；
3. 提交说明请写清：**现象 / 根因 / 改法 / 测试**（本仓库历来的风格，便于回溯）；
4. PR 描述里附复现步骤与测试结果，涉及安全边界（文件访问、命令执行、鉴权）请单独说明；
5. 合并进来的社区 PR 会保留原作者署名（`cherry-pick -x`）。

**代码约定**：中文注释优先（本项目历来如此）；不新增运行时依赖；测试必须可重复（不写死 POSIX 分隔符、macOS 专属路径、固定 `setTimeout` 等待）；新增文件访问逻辑必须过敏感目录检查。

### 发版流程

版本用 **git tag** 标识（支持 `v1.2.3` 语义化与 `v26081302` 日期制），已推送的 main 提交才能打 tag。

**推送 `v*` tag 后自动发版**：`.github/workflows/release.yml` 会依次做「构建产物与源码一致性检查 → 发布包自检（打包 / 安装 / 加载 / 跑 worker）→ 打包 → 创建或复用 Release 并上传两个 tarball」，所以正常发版只需要改版本号、推 main、推 tag：

```sh
# 1. 改 CHANGELOG（docs/CHANGELOG.md 与 .en.md 两份）与 package.json 的 version
# 2. 提交并推送
git push origin main

# 3. 打 annotated tag 并推送（tag 已存在但指向旧提交时用 --force-with-lease）
git tag -a v0.6.2 -m "v0.6.2：……"
git push origin refs/tags/v0.6.2
```

推送后到仓库的 Actions 里看 `release` 这个 workflow 即可；它会把资产传到该 tag 的 Release 并校验稳定名地址返回 200。

需要**补传历史版本**（或想重跑某次发版）时，用同样的 workflow 手动触发，或在本地执行下面两条：

```sh
pnpm pack:release
gh release upload v0.6.2 dist/dsh-memory-evolve-0.6.2.tgz dist/dsh-memory-evolve.tgz --clobber
```

手动触发方式：`gh workflow run release.yml -f tag=v0.6.2`。

预构建包有两个文件：带版本号的那个方便人工下载与按版本核对；**稳定名** `dsh-memory-evolve.tgz` 是插件市场的 `tarball` 字段所指（`https://github.com/<owner>/<repo>/releases/latest/download/dsh-memory-evolve.tgz`），每次发版覆盖上传即可，目录条目不必再改。

发布后：使用者的「版本」页会看到红点并可一键更新（仅 git clone 安装）；用 `dsh plugin add` 安装的人重新 add 即可。

---

## 三条设计原则

1. **AI 只提议，你确认**：AI 自建的记忆、待办、技能先进待确认队列——会真实改变 AI 行为的写入，决定权在你；
2. **不重复造轮子**：官方已有能力不碰，只做官方没做且真实解决痛点的；
3. **内外有别、协作互补**：内部会话做需要上下文的活，外部代理做一次性重活，记忆、房间、提示词把它们串成流水线。

---

## 许可与致谢

MIT。原项目版权 `Copyright (c) 2026 dsh-external`（见 [LICENSE](LICENSE)），本 fork 追加 `Copyright (c) 2026 EscapeKarma and contributors`——MIT 要求保留原版权行。

感谢原作者 [@csyangwen](https://github.com/csyangwen) 打下这个插件的基础，以及这些把修复做出来的社区贡献者：

[@idealistichacker](https://github.com/idealistichacker)（#104 后台命令隐藏控制台）、[@wangyuanchuan2022](https://github.com/wangyuanchuan2022)（#77 spawn seed）、[@534056668](https://github.com/534056668)（#98 Session.events 兼容）、[@Kiva007](https://github.com/Kiva007)（#91 桌面端同源放行 + 超时）、[@qiyeren](https://github.com/qiyeren)（#100 加宽锚点）、[@NameLess](https://github.com/NameLess)（#102 附件名推断）、[@师忠港](https://github.com/shizhonggang)（#60 跨设备逐文件拷贝）、[@dsh-external](https://github.com/dsh-external)（#56 样式常驻）。
