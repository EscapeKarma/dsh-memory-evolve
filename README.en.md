# dsh-memory-evolve

[![CI](https://github.com/EscapeKarma/dsh-memory-evolve/actions/workflows/test.yml/badge.svg)](https://github.com/EscapeKarma/dsh-memory-evolve/actions/workflows/test.yml)
[![version](https://img.shields.io/github/v/tag/EscapeKarma/dsh-memory-evolve?label=version&color=blue)](https://github.com/EscapeKarma/dsh-memory-evolve/releases)
[![license](https://img.shields.io/github/license/EscapeKarma/dsh-memory-evolve?color=green)](LICENSE)

> **In one line**: give the AI inside DeepSeek Harness long-term cross-session memory, let it manage your todos and skills, spawn teams of sessions, and hand heavy work to external AI agents — **it gets to know you, and changing sessions no longer loses context**.

Docs: [Detailed feature reference (中文)](README-详细说明.md) · [Memory sync (中文)](docs/记忆同步.md) · [COI dispatch (中文)](docs/COI-调度.md) · [Windows development](docs/DEVELOPING-WINDOWS.md) · [Changelog](docs/CHANGELOG.md) · [中文](README.md)

---

## What this repository is

The upstream project [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve) (800+ stars) stopped being maintained in late October 2026; issues have gone unanswered since November. This is the community-maintained fork, taken over by [@EscapeKarma](https://github.com/EscapeKarma). Progress so far:

| Version | Highlights |
| --- | --- |
| **v0.2.0** | Fixed 4 blocking bugs (sync false positives, released package missing the worker, plugin failing to load on Cordis 4, tests writing into the real skill library) and 1 security defect (canvas private-key blocking silently ineffective on Windows); added CI; reproducible Windows development; build no longer depends on the original author's machine |
| **v0.3.0** | Merged 8 community fixes accumulated after upstream went quiet (#102 #78 #79 #101 #70 #111 #60 #56+#89), original authorship preserved; plus 2 Windows fixes |
| **v0.4.x** | Version page splits by install kind + read-only release check (0.4.0); snapshot no longer injects the session title (0.4.1); turn-tail star, in-page dialogs, subagent cwd bucketing (0.4.2); COI retries keep content, prompts/COI isolated per session (0.4.3) |
| **v0.5.x** | Security audit, four rounds: all 30 HTTP endpoints behind the plugin's same-origin guard, CLI adapters reduced to a built-in allowlist (0.5.0); data-correctness (0.5.1) and stability (0.5.2) hardening |
| **v0.6.x** | Frontend fixes: duplicate-submit guards, anchor escaping, per-session race guards, save-failure notice (0.6.0); outbound attachment path checks + audit groups A/B (0.6.1) |
| **v0.7.x** | Scoped package name, npm + prebuilt tarball release, tag-triggered publishing (0.7.0); HTTP routes now pass DSH's own admission check (0.7.1) |

- **Install from**: `@escapekarma49/dsh-memory-evolve` (npm, since v0.7.0) or `github:EscapeKarma/dsh-memory-evolve` (git source)
- **License**: MIT (the upstream copyright notice is kept, as MIT requires)
- **Response expectations**: maintained in spare time — issues are read and answered, but no SLA
- **Report issues**: <https://github.com/EscapeKarma/dsh-memory-evolve/issues> (please include DSH version, OS and reproduction steps; for plugin bugs also the version shown under *Settings → Memory Evolve → Version*)

---

## Quick start

The package ships its own `cordis.patch.yml` (declared as `dsh.bundle.patch`), so `dsh plugin add` registers it automatically — no manual host configuration. Example with the `web` profile:

```sh
# 1. install (or search "dsh-memory-evolve" in the DSH plugin marketplace)
dsh plugin --profile web add @escapekarma49/dsh-memory-evolve        # npm package (integrity-checked)
# or from source (same result, can pin unreleased commits): dsh plugin --profile web add github:EscapeKarma/dsh-memory-evolve

# 2. fully quit DSH and start it again (the plugin loads at process start; reloading the page is not enough)
```

> ⚠️ **Do not manually `insert` this plugin into `~/.dsh/profiles/<name>/cordis.patch.yml`**: the bundle patch already registers it, and a duplicate entry id makes the loader fail with `duplicate loader entry id`. If you followed older instructions, just delete those lines.

**Changing defaults** (e.g. enabling in-turn memory review) — override by id (top-level, not `insert`):

```yaml
- id: dsh-memory-evolve
  config:
    reviewEnabled: true      # in-turn memory review (off by default)
    reviewInterval: 10       # review every 10 user turns
```

The common way, though, is **runtime configuration**: *Settings → Memory Evolve → Configuration* in DSH. Changes apply immediately, no restart and no YAML editing.

**Upgrading**:

```sh
dsh plugin --profile web add @escapekarma49/dsh-memory-evolve   # re-add pulls the latest
# then fully quit DSH and start it again
```

To pin a version, append a tag: `github:EscapeKarma/dsh-memory-evolve#v0.7.1`, or on npm `@escapekarma49/dsh-memory-evolve@0.7.1`.

> ⚠️ **Do not pin installs to a 40-character commit** (`github:...#<sha>`): for git-installed bundles DSH renders the update target as the full commit hash, so the plugin card shows something like `更新到 v1649819a17006d…` — hard to read and it does not follow version numbers. Pin an npm version (`@escapekarma49/dsh-memory-evolve@x.y.z`) or a tag instead; if you already pinned a commit, uninstall and reinstall from the plugin marketplace to get normal version display back.

> **Upgrading from v0.6.x (package renamed to a scoped name)**: the Loader entry id stays `dsh-memory-evolve`, so profile config and data need no change; only the dependency name becomes `@escapekarma49/dsh-memory-evolve`. Marketplace/tarball installs get reinstalled by the marketplace; `github:` installs should be re-added once (the old `node_modules/dsh-memory-evolve` directory can be deleted).

**How do I know a new version exists?** Open *Settings → Memory Evolve → Version*. It first tells you **how the plugin is installed**:

- installed by `git clone` (the directory has `.git`): you can click "update to vX.Y.Z" directly — this is the developer path and it does mutate your working tree;
- installed by the marketplace or `dsh plugin add` (no `.git`): one-click update **is not available, and that is not a fault**. The page shows "managed by the marketplace", gives you a copyable upgrade command, and uses a **read-only** GitHub check to tell you whether a newer version exists (at most once per 24h; it only reads the version number — no download, no install, no token, and it keeps the last result when offline).

**Temporarily disabling** a plugin that prevents DSH from starting (no uninstall needed):

```yaml
- id: dsh-memory-evolve
  disabled: true
```

**Uninstalling**: `dsh plugin --profile web remove dsh-memory-evolve`. Your data stays (`~/.dsh/memories`, `~/.agents/skills`); delete those files by hand only if you really want them gone.

---

## The 30-second tour

After installation a session gains a row of capability tabs: **Memory · Skills · Todos · Infinite Canvas · COI Dispatch · Broadcast · Prompts · Memory Sync · Models · Bookmarks · Session Review · Web UI Settings**. Plugin overview, runtime configuration and version updates live in DSH's global **Settings → Memory Evolve** (three sub-pages: Guide / Configuration / Version).

On the AI side you gain these tools:

| Tool | What it does | Default |
| --- | --- | --- |
| `memory` | read/write the five memory tracks, expand by id, archive, `retag` to add/edit a summary | on |
| `memory_suggest` | propose a write (queued for your confirmation) | on |
| `dtodo` | four-track todos (life / work / project / daily) | on |
| `skill_manage` | read and write the skill library | on |
| `de_session` / `de_ws_*` | spawn sessions, dispatch work, collab rooms, file-lock declarations | with COI |
| `de_coi*` | hand tasks to external AI agents (codex / kimi / grok / hermes) | off |
| `de_broadcast` | inter-session messaging rooms, image attachments | off |
| `de_canvas` | read/write the infinite canvas by node id | off |
| `de_notify` / `de_channel_send` | notifications and direct pushes to IM (Feishu / QQ / WeChat / WeCom / web) | off |
| `memory_evolve_search_local_files` | local document search (by name / content) | off |

In one sentence: **it remembers you, manages for you, works for you, and works together with itself.** Most capabilities are off by default (so they don't occupy the model's tool list); enable them under *Settings → Memory Evolve → Configuration*.

---

## Scenario 1: AI that actually remembers you (long-term memory)

**Who**: everyone. This is the core of the plugin and the foundation of everything else.

Chat is one-shot: change project, wait a day, open a new session — it forgets who you are. Five memory tracks give it working memory across sessions:

- **User profile**: preferences, company, communication style — visible every turn;
- **Global facts**: environment, tools, conventions;
- **Project key facts**: conventions, decisions, architecture, pitfalls — injected automatically, optionally **scoped to a git branch**;
- **Project log / daily log**: per-turn progress, read on demand, traceable.

**How to use**:

1. Just chat — at the end of each turn it writes progress into the project and daily logs;
2. When something matters, say "**note this: the deployment port for this project is 8080**". It proposes a project key fact and **takes effect only after you confirm** — the AI never writes memory on its own;
3. Days later, in another session, ask "**check memory — what architecture decision did we settle on?**";
4. When memory grows, ask the AI to "**archive that entry**" — archived entries are no longer injected and can be restored at any time;
5. Your reactions ("great", "still not fixed") are recorded as `【feedback】` lines in the daily and project logs; later ask "**analyse what I've been unhappy about recently**".

**Retrieval is ranked** (v0.3.0): asking "where did we put that deploy script" now returns results ordered by relevance, so a full-sentence question no longer necessarily returns nothing.

**Saving injection cost** (v0.3.0): set `keyProgressiveDisclosure` / `memoryProgressiveDisclosure` / `userProgressiveDisclosure` to `on` and the injected form becomes `[date] [short-id] summary`, with full text fetched on demand via `expand` — measured ~**79%** fewer injected characters for the memory/user tracks.

---

## Scenario 2: Shared project memory across machines (memory sync)

**Who**: home + office machines, or colleagues sharing conclusions for one project.

**How** (details in [docs/记忆同步.md](docs/记忆同步.md)):

1. Enable the **Memory Sync** module under *Settings → Memory Evolve → Configuration* (this only makes the UI visible);
2. In a project session open the **Memory Sync** tab and enable *this project*, then hit "start sync" — by default memory uses your code repository and lives on a dedicated branch, so code stays clean. Public repo but private memory? Point it at a **shared memory repository**: one repository holds every project's memory, one branch each;
3. On the second machine, clone and open — it recognises the project automatically (same repository URL) and pulls the memory;
4. Write memory as usual (immediate, zero latency) and sync in batches; conflicts only appear when both machines changed the same entry — choose *local / remote / both*.

**Result**: project key facts, project logs, archives and project todos are consistent across machines; with a shared memory repository the global tracks follow too. **Projects without sync stay purely local.**

> Sync uses your local `git`. On Windows, if the first push reports "remote branch was deleted", upgrade to v0.2.0+ (Chinese-locale false positive fixed).

---

## Scenario 3: Many projects in parallel, nothing forgotten (todos + local search)

- **Four todo tracks**: life / work / project / daily; the project track is isolated per working directory. Say "**remember: deploy the secondary panel to the mobile instance by Friday**" and it becomes a project todo with importance/urgency and a due date; at the end of the day the AI reminds you;
- **Project log**: isolated per directory, tagged `[git main]`;
- **Local document search**: "**have I written something like this before?**" (by name) or "**which document mentions X?**" (by content). On Windows it tries `es` → `rg` → pure Node, so it works even when none of them is installed.

---

## Scenario 4: One person commanding a team of AIs (internal team)

1. **Spawn the team**: "create 4 sessions — design owns visuals, frontend owns pages, backend owns the API, QA owns acceptance — and put them in one room". They inherit your model and working directory; agent presets are supported;
2. **Communicate**: everyone sees who changed what and who finished; room messages **may contain images**;
3. **Dispatch and nudge**: "who is working now?" → status; "ask frontend to send the result" → it wakes that session and hands it the task (never batch auto-wakes — you stay in charge);
4. **Avoid conflicts**: "declare which files you're about to change" — others see it, and a real collision produces a warning;
5. **Collect**: members post results to the room; you confirm.

**The engine**: the main session must stay alive in a running DSH process. If it goes idle or DSH is closed, the wake-up chain stops — send one message and the team moves again.

---

## Scenario 5: Heavy work handed to external agents (reinforcements)

1. Say "**dispatch this to grok: mobile adaptation**" — it runs in the background, returns a task id immediately and **does not block the session**;
2. Ask "**how is the task going**", or watch the live log stream in the **COI Dispatch** tab;
3. Dispatch can carry project memory, so the external agent knows your conventions;
4. **Attachments work**: local paths, remote URLs or images from the current session;
5. When it finishes, the summary is **written into the project and daily logs** — outsourced work becomes memory.

Requires the corresponding CLI (`codex` / `kimi` / `grok` / `hermes`) installed locally and COI dispatch enabled. See [docs/COI-调度.md](docs/COI-调度.md).

---

## Scenario 6: Inside + outside — one team, two kinds of soldiers

The full shape: internal sessions do work that needs iteration and context, external agents do one-shot heavy lifting, and memory + rooms + prompts stitch them into a pipeline.

1. **Split**: the main session spawns frontend and QA into a room, and dispatches "full visual redesign" to Kimi;
2. **External lead**: Kimi redesigns in the background; the frontend session builds data layer and page structure meanwhile;
3. **Relay**: Kimi finishes, the summary lands in project memory → main session posts the conclusion to the room → frontend reads memory for the spec and integrates;
4. **Escalation**: frontend is stuck on a weird styling bug → main dispatches Grok to dig → conclusion back to the room → frontend fixes it;
5. **Acceptance**: QA runs the acceptance pass, posts results, you confirm.

Four composable joints: **relay** (external output becomes memory), **escalation** (internal fast, external deep), **shared standards** (inject your prompts when dispatching), **state sync** (room + workspace activity + notifications).

---

## Scenario 7: Turning good practice into discipline (prompt injection)

Turn working methods into **prompts** (categorised, searchable, enable/disable-able): review checklists, debugging flows, PRD templates, test strategies…

- **AI self-selects**: when a flow applies, it reads the library and injects it into itself for the next turn, without interrupting the reply;
- **One-click injection**: pick one and choose *inject once / keep injecting / inject now*;
- **Ad-hoc injection**: type a requirement without creating a library entry — it is stored and reusable next time;
- **Dispatch with discipline**: when handing work to sub-sessions or external agents, bring the matching prompts along.

---

## Scenario 8: Sessions that get long, expensive and fuzzy (bookmarks + branches + usage ring)

- **Bookmarks**: star any turn; the list shows name/turn/time/summary, searchable, and **clicking jumps back to that turn**;
- **Branch from any turn**: the official UI only branches from the last turn; this plugin takes over the entry point for **any middle turn**, still going through the official branch channel so it joins the official lineage;
- **Context ring**: the input box shows live context usage — yellow at ≥30%, red at ≥40% — time to bookmark, branch, or start fresh.

---

## Scenario 9: Working away from the desk (notifications + mobile)

- **Channel notifications** (`de_notify`): "notify me on Feishu when the task is done" → Feishu / QQ / WeChat / WeCom, marked as a notification, with images or files;
- **In-app notifications** (`de_notify channels=web`): land in the bell at the top right — unread badge, popover list, click to jump to the session, large detail dialog for long text, draggable/persistent position;
- **Direct channel push** (`de_channel_send`): no notification marker, sends text/images/files straight to IM; attachments from local path, remote URL, base64 or **an image from the current session**;
- **Mobile**: the DSH UI adapts to phones (full-width chat, collapsed toolbar behind "⋯");
- **Session filter**: show only running sessions in the sidebar.

> Since v0.3.0, IM file attachments no longer arrive as `file.bin` — the name is inferred from the path or URL when omitted.

---

## Scenario 10: An invisible reviewer for every session (session review)

**Who**: people who want a second pair of eyes without reading every line.

- **Independent reviewer** per session: it only sees what you see in the UI (your messages and the agent's reply text), not thinking or tool arguments;
- **Per-turn review**: it is a continuous session, so its context is never truncated;
- **Steering when needed**: when it has something worth saying it injects it **as a user instruction** into the current session, shown in the GUI as a collapsed line prefixed with `[severity]`;
- **Four severities**: `info` (record only by default) / `nit` / `concern` / `blocker`;
- **Four constraint layers**: system prompt / project / session / this review session — the more local wins;
- **Ask it questions, reset it, inspect records.**

Enable under *Settings → Memory Evolve → Configuration* (`advisorEnabled`, off by default). The reviewer model inherits the current model unless you set `advisorProvider` / `advisorModel`.

---

## Scenario 11: Scattered material, one canvas (infinite canvas)

- **Three ways onto the board**: a local path, a sticky note (content never written to disk), or search-and-add;
- **See it all**: infinite pan/zoom, freely placed and resized cards, inline preview for images/audio/video/text, Office/PDF via the system app;
- **One board, filtered views**: every node carries a 🌐 global / 📁 project / 💬 session badge;
- **AI in both directions (pull-based)**: `de_canvas` looks up, reads and adds notes by id — **canvas content is never injected**, so it costs no tokens until asked;
- **Safety boundary**: the AI can only read nodes already on the board; sensitive directories (`.ssh`, `.git`, `node_modules`, system credential stores…) are refused even if placed there.

> v0.2.0 fixed a security defect where this refusal logic was **completely ineffective on Windows** (POSIX separators never matched `C:\...`), exposing private keys. Use v0.2.0 or newer.

---

## Everything else, in one line each

- **Skill self-evolution**: methodologies from repeated pitfalls become reusable skills;
- **Skill manager**: browse/search/disable/edit skills, add custom skill directories; cross-device adoption now copies file by file (v0.3.0) so a failure leaves no half-written directory;
- **Confirmation queue**: AI proposals for memory/skills/todos land here; adopt or reject updates only the affected row (v0.3.0) without refreshing everything or dropping your edits;
- **Model settings**: per-model enabled state, reasoning effort, notes and image-input support;
- **In-turn memory review**: every N turns the AI distils what is worth remembering and asks you;
- **Version page** (v0.4.0): shows install kind and current version; `git clone` installs get one-click update (git tag comparison, at most once per 24h), marketplace / `dsh plugin add` installs get a copyable upgrade command plus a read-only GitHub release check — no download, no auto-install;
- **Session search**: search your other local AI tools' (e.g. Codex) session history;
- **Web UI settings**: mobile layout, wider bubbles, Mermaid rendering, context-usage ring.

---

## Configuration cheat sheet

Runtime settings live under *Settings → Memory Evolve → Configuration*, or in the profile's `cordis.patch.yml`. The commonly changed ones:

| Key | Default | Meaning |
| --- | --- | --- |
| `reviewEnabled` / `reviewInterval` | `false` / `5` | in-turn memory review and its interval |
| `reviewMode` | `suggest` | `suggest` = proposals go to the queue; `auto` = write directly |
| `keyProgressiveDisclosure` / `memoryProgressiveDisclosure` / `userProgressiveDisclosure` | `off` | `off` full text / `auto` full for small datasets / `on` always summaries |
| `summaryMinChars` | `0` | In summary mode, entries whose body is at most this many characters stay fully injected; longer ones fold into a one-line summary. `0`=off (same as before), `400` recommended (~61% saving); available from 0.5.0 |
| `trustedHosts` | `[]` | Extra Hosts allowed to reach the plugin HTTP API (LAN / reverse-proxy setups). Empty = loopback only; cross-site requests are always rejected. Available from 0.5.0; honoured by DSH admission as well since 0.7.1 |
| `channelSendRoots` | `[]` | Absolute directories allowed for `de_channel_send` / `de_notify` attachments. Empty = no directory limit, but sensitive paths (`.ssh`, `.aws`, `.env`, …) are always refused. Available from 0.6.1 |
| `projectInjectMode` / `dailyInjectMode` | `off` | project / daily logs are not injected by default (they change on every write, which defeats prefix caching); `tail:N` injects the newest N entries, `always` injects everything |
| `perTurnWriteGuard` / `writeGuardThreshold` | `false` / `2` | write watchdog: remind after N turns without a log write |
| `todoEnabled` | `true` | todo tool and tab |
| `searchDocsEnabled` / `searchDocsMode` | `false` / unset | local document search; `all`/`filename`/`content`/`off` |
| `searchDocsExts` | `['md']` | extensions searched |
| `coiEnabled` | `false` | external AI dispatch |
| `broadcastEnabled` | `false` | inter-session broadcast (rooms, `de_ws_*`) |
| `canvasEnabled` | `false` | infinite canvas |
| `advisorEnabled` | `false` | session review |
| `notifyEnabled` | `false` | notifications (including in-app web) |
| `skillReviewEnabled` | `false` | `true` = skills written directly without confirmation |
| `skillDir` | `~/.agents/skills` | skill library directory |

Full list: [README-详细说明.md](README-详细说明.md) (Chinese).

---

## FAQ

**Installed but nothing happened?**
The plugin loads at process start: **fully quit DSH and start it again** (closing the window to the tray does not count). Reloading the page never loads new code.

**Sync keeps reporting "worker produced no output"?**
Releases before v0.2.0 shipped without `scripts/` (`package.json` had no `files`). Upgrade; since v0.2.0 a missing file reports "incomplete plugin install, please reinstall" instead.

**On Chinese Windows the first sync says the remote branch was deleted?**
Fixed in v0.2.0: git subprocesses did not pin the locale, so Chinese error text never matched the English regex.

**After a hot reload the whole page loses its styling?**
Fixed in v0.3.0: runtime-injected `<style>` tags now carry `data-plugin` ownership. Refresh once after upgrading.

**The canvas refuses to open a file as "sensitive"?**
By design (`.ssh`, `.git`, `node_modules`, system credential stores…). Before v0.2.0 that rule did not actually work on Windows — please upgrade.

**`git push` keeps failing?**
Port 443 to github.com can be flaky for some networks (`Connection was reset` / `Failed to connect`). Retrying 2–4 times usually works; `api.github.com` is generally fine. Check `git log origin/main..HEAD` rather than a piped exit code.

**The "check for updates" button does nothing?**
It compares git tags, so it only works for **git-clone installs**; for `dsh plugin add` or marketplace installs, re-`add` to upgrade.

Since v0.4.0 the version page branches by install kind instead of showing a dead button: `git clone` keeps one-click update; marketplace / `dsh plugin add` installs show "managed by the marketplace" plus a copyable upgrade command, and a read-only GitHub check tells you whether a newer version exists.

**Are the plugin's HTTP endpoints safe?**
Two layers: DSH's own admission first (Host/Origin fence + browser session auth, since v0.7.1), then the plugin's same-origin check (JSON-only writes, cross-site Origin rejected, loopback-only Host, non-loopback peers refused; all 30 endpoints including reads since v0.5.0). Local `curl` calls without a browser cookie skip the auth layer and only face the loopback check, so scripts keep working; remote access is denied by default — opt in via `trustedHosts`.

**The plugin prevents DSH from starting?**
Add `- id: dsh-memory-evolve` + `disabled: true` to the profile's `cordis.patch.yml`, start DSH, and file an issue.

---

## Development

### Requirements

- Node **≥ 22.18** (tests import `.ts` directly and rely on native type stripping); CI uses Node 24
- `git` (tests create temporary repositories)
- `esbuild` for building (`devDependencies`, `pnpm install` suffices)
- The package itself has **zero runtime dependencies** (host side uses only Node built-ins, browser side only DSH-provided modules; Mermaid is vendored)

```sh
git clone https://github.com/EscapeKarma/dsh-memory-evolve.git
cd dsh-memory-evolve
pnpm install            # build only
```

### Tests

```sh
pnpm test               # macOS / Linux
pnpm test:win           # Windows (injects git identity and init.defaultBranch=main)
```

On Windows plain `pnpm test` produces ~55 false failures (`Author identity unknown`, `src refspec main does not match any`) — use `test:win`. Current baseline: **1121 tests / 1120 pass / 0 fail / 1 skipped**. Windows-specific notes: [docs/DEVELOPING-WINDOWS.md](docs/DEVELOPING-WINDOWS.md).

### Rebuild client artifacts after editing `src/client/`

`lib/client.js` is a committed build artifact (DSH loads it directly):

```sh
pnpm build              # src/client/*.tsx -> lib/client.js
git status              # commit lib/client.js if it changed
```

CI has a "build artifacts match sources" job that rebuilds on ubuntu and diffs; forgetting to rebuild turns it red. The client may only import host modules listed in `EXTERNALS` in `scripts/build.mjs`.

### Layout

```
lib/             host-side hand-written ESM (entry lib/index.js, memory, sync, COI, canvas…)
src/client/      browser-side TSX (59 files, bundled into lib/client.js by esbuild)
tests/           80+ test files, ~1121 cases
skills/          5 built-in skills synced into the skill library
scripts/         build.mjs, test-win.mjs, sync-worker.mjs (sync child process)
docs/            CHANGELOG, memory sync, COI dispatch, rules, Windows development
vendor/          mermaid.min.js
```

### Pull requests

1. Branch from `main`, then run `pnpm test:win` (Windows) or `pnpm test`;
2. Rebuild and commit `lib/client.js` when you touch `src/client/`;
3. Write commit messages covering **symptom / root cause / fix / tests** (this repo's historical style);
4. In the PR description include reproduction steps and test output; call out anything touching security boundaries (file access, command execution, auth);
5. Merged community PRs keep their original authorship (`cherry-pick -x`).

**Conventions**: Chinese comments preferred (as historically); no new runtime dependencies; tests must be deterministic (no hard-coded POSIX separators, macOS-only paths, or fixed `setTimeout` waits); new file-access code must go through the sensitive-path check.

### Releasing

Versions are **git tags** (`v1.2.3` semantic or `v26081302` date style) on already-pushed `main` commits:

```sh
# 1. update docs/CHANGELOG.md and docs/CHANGELOG.en.md plus package.json version
# 2. commit and push
git push origin main

# 3. create and push the annotated tag (use --force-with-lease if it must move)
git tag -a v0.4.0 -m "v0.4.0: …"
git push origin refs/tags/v0.4.0

# 4. publish a GitHub release
gh release create v0.4.0 --title "v0.4.0 — …" --notes-file notes.md
```

Afterwards git-clone users see a red dot and can update in one click; `dsh plugin add` users re-add to upgrade.

---

## Three design principles

1. **The AI proposes, you decide**: self-created memories, todos and skills go through a confirmation queue — anything that would change the AI's behaviour needs your approval;
2. **Don't reinvent wheels**: leave official capabilities alone and only build what DSH lacks and users actually need;
3. **Inside and outside are complementary**: internal sessions handle context-heavy work, external agents handle one-shot heavy lifting; memory, rooms and prompts tie them together.

---

## License and credits

MIT. Upstream copyright `Copyright (c) 2026 dsh-external` (see [LICENSE](LICENSE)); this fork adds `Copyright (c) 2026 EscapeKarma and contributors`, keeping the original notice as MIT requires.

Thanks to the original author [@csyangwen](https://github.com/csyangwen) for building this plugin, and to the contributors whose fixes made v0.3.0 possible:

[@idealistichacker](https://github.com/idealistichacker) (#104 hide background console windows), [@wangyuanchuan2022](https://github.com/wangyuanchuan2022) (#77 spawn seed), [@534056668](https://github.com/534056668) (#98 Session.events compatibility), [@Kiva007](https://github.com/Kiva007) (#91 desktop same-origin + timeout), [@qiyeren](https://github.com/qiyeren) (#100 wide-chat anchors), [@NameLess](https://github.com/NameLess) (#102 attachment name inference), [@师忠港](https://github.com/shizhonggang) (#60 cross-device copy), [@dsh-external](https://github.com/dsh-external) (#56 persistent styles).
