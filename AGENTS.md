# AGENTS.md

Fork workflow for `pkradioman/9router`. Read `CLAUDE.md` first for architecture and
`open-sse/AGENTS.md` before touching the router engine. This file covers what is
specific to this fork, how it is built, and how upstream is merged.

Last updated: 2026-11-25

## Local copy

- Repo root: `D:\Repos\ai\tools\gateway` (the session cwd may be a scratch folder; open this path).
- Installed app: `%LOCALAPPDATA%\Programs\9Router`; data: `%APPDATA%\9router`.

## Remotes and branches

| Remote | Repo | Role |
|---|---|---|
| `origin` | `pkradioman/9router` | fork, default branch `fork/main` |
| `upstream` | `decolua/9router` | source of truth for upstream code |

| Branch | Role | Rules |
|---|---|---|
| `master` | mirror of `upstream/master` | fast-forward only, no fork commits, not built |
| `fork/main` | shipped code | long-lived, what gets built and installed |
| `fork/<topic>` | one change | branch from `fork/main`, merge back |

`fix/provider-thinking-format` is the pre-`fork/main` history; it is frozen, do not
build from it.

## Upstream sync

```bash
git fetch upstream --tags
git checkout master && git merge --ff-only upstream/master
git checkout fork/main && git merge --no-ff upstream/master
```

- Merge, never rebase published commits. Merge at upstream **release tags**, not per commit.
- Tag before and after: `pre-upstream-merge-<oldver>`, `fork-v<newver>`.
- Known conflict: `package.json`. Resolution is always the same —
  version = fork build number, deps = upstream except `electron`/`electron-builder`,
  scripts = union of both (keep `desktop:*`, `repair:usage-costs`).
- After a merge the current-tree copies of the five heavily edited files must be
  spot-checked: `open-sse/providers/pricing.js`, `src/lib/db/repos/usageRepo.js`,
  `open-sse/utils/stream.js`, `open-sse/utils/streamHandler.js`, `open-sse/handlers/chatCore.js`.
  Everything else in the fork is additive files + thin hooks.

## Versioning

- `package.json` version is monotonic and ahead of upstream: `0.5.124`, `0.5.125`, …
- On collision with a future upstream release: `max(upstream, fork + 1)` after merging.
- Tag every installed build `fork-v<version>`. Rollback = checkout tag → rebuild → install.
- `electron-builder` artifacts: `dist-electron/9Router-<version>-setup.exe`, `-portable.exe`.

## Build → install

Run from the repo root. The Linux sandbox `rerun-build` (boxd) is the build host; Windows
packaging and installation happen locally.

```bash
# 1. push the exact commit first
git push origin fork/main

# 2. build on the sandbox (npm ci is required when deps/lock change)
boxd machine start rerun-build
boxd machine exec rerun-build --timeout 3000 -- bash -lc '
  cd ~/9router &&
  git fetch -q && git reset -q --hard origin/fork/main &&
  rm -rf desktop-dist desktop-app .next &&
  npm ci --no-audit --no-fund 2>&1 | tail -2 &&
  NEXT_DIST_DIR=desktop-dist NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=8192 npm run build 2>&1 | tail -5 &&
  node scripts/desktop-prepare.mjs 2>&1 | tail -1 &&
  cd desktop-app && tar czf /tmp/desktop-app.tgz . && sha256sum /tmp/desktop-app.tgz'
boxd machine stop rerun-build

# 3. copy back, verify sha256, extract (desktop-app/ is gitignored)
cmd /c 'boxd machine cp rerun-build:/tmp/desktop-app.tgz - > desktop-app.tgz'
tar -xzf desktop-app.tgz -C desktop-app

# 4. package on Windows
npm run desktop:pack:win

# 5. install (silent) and start
dist-electron\9Router-<version>-setup.exe /S
"%LOCALAPPDATA%\Programs\9Router\9Router.exe"
```

Rules:
- Never edit `%LOCALAPPDATA%\Programs\9Router` or its `app.asar`/runtime. Fix the repo,
  rebuild, reinstall.
- Do not restart or replace the app while clients are using it; confirm it is idle.
- `desktop-app/` and `desktop-dist/` are build outputs; never commit them.

## Verification after an install

| Check | Expected |
|---|---|
| `GET /api/health` | `{"ok":true}` |
| `GET /api/version` | installed version |
| served page chunk | matches the installed build (see route-cache below) |
| one real request | `usageHistory` row written, cost components sum to total |
| `%APPDATA%\9router\desktop\desktop.log` | `healthy`, no `route cache check failed` |

`/api/token-saver/stats` and `/api/usage/stats` need the local CLI token header
(`x-9r-cli-token`; derivation in `src/dashboardGuard.js`, salt `9r-cli-auth`) when called
outside the dashboard.

## Runtime paths and state

| Path | Contents |
|---|---|
| `%APPDATA%\9router\db\data.sqlite` | connections, nodes, keys, `usageHistory`, `usageDaily`, kv |
| `%APPDATA%\9router\desktop\` | Electron userData, `desktop.log`, `route-cache-build-id` |
| `%LOCALAPPDATA%\Programs\9Router\` | installed app; `resources\app\runtime` = Next standalone |
| `%LOCALAPPDATA%\Programs\9Router\resources\app\runtime\desktop-dist\server\route-cache` | Next prerender cache (see below) |

- Take a DB backup before any backfill: `scripts/repair-usage-costs.mjs` also does this
  automatically (`data.sqlite.bak-<stamp>`).
- DB driver falls back `better-sqlite3 → node:sqlite → sql.js`; the packaged runtime
  normally logs `better-sqlite3 unavailable` and uses `node:sqlite`. That is expected.
- `npm install` may block `better-sqlite3`/`electron-winstaller` install scripts; approvals
  are pinned in `package.json` → `allowScripts`. Re-approve and `npm rebuild better-sqlite3`
  if the native binding is needed.

## Route-cache invariant (do not remove)

Next writes prerendered HTML/RSC into the install dir and that cache survives upgrades.
Stale entries reference the previous build's chunks, so the dashboard then runs the old UI
and shows the old version while `/api/version` reports the new one.

- `electron/main.js` deletes `route-cache` when `desktop-dist/BUILD_ID` differs from
  `userData/route-cache-build-id`.
- `electron/installer.nsh` deletes it on every install.
- Symptom to recognise: UI version ≠ `/api/version`. Fix: clear the cache (or reinstall)
  and hard-refresh the tab (`Ctrl+Shift+R`).

## Fork-specific behaviour (keep these contracts)

- **Pricing:** custom `openai-compatible-*` nodes resolve by identity chain
  `uuid → node prefix → baseUrl host → exact canonical model id`. Model-name globs are
  never used for custom nodes. Rates live in Settings → Pricing (kv scope `pricing`).
- **Reasoning cost:** reasoning tokens are part of `completion_tokens` for OpenAI-shaped
  APIs; only Gemini-style `reasoning_separate` usage is charged on top.
- **Cost storage:** each usage row stores `meta.costComponents`; `usageDaily` aggregates
  them. Rows with no resolvable rate keep their stored cost and are marked `priced:false`.
- **Stream termination:** peer socket closes (`TypeError: terminated`, `UND_ERR_SOCKET`,
  `other side closed`) are logged as `⚡ upstream closed`, not `✗ ERROR`. Real failures still
  use `ERROR`.
- **Aborted requests:** a stream cut before a terminal event writes an estimated usage row
  (`status:"aborted"`, `meta.estimated`) instead of disappearing.
- **Token-saver measurement:** every request writes `meta.saver.v = 1` with RTK
  before/after bytes + per-filter bytes and the caveman level (`null` = off). `v` is how the
  dashboard excludes pre-instrumentation rows; do not drop it.
  Dashboard: `/dashboard/token-saver`, API `/api/token-saver/stats?period=24h|7d|30d|all`.
- **Desktop shell:** Electron tray app, NSIS per-user install, Ctrl+Q quits, closing the
  window keeps the tray alive, gateway binds `0.0.0.0:20128`.

## Tests

The suite is not all-green on a plain checkout (see `CLAUDE.md`). Use the alias config for
anything that imports `@/` or `open-sse/`:

```bash
npx vitest run --config <alias-config> \
  tests/unit/usage-costs.test.js tests/unit/stream-termination.test.js \
  tests/unit/token-saver-stats.test.js tests/unit/content-chunks.test.js \
  tests/unit/param-support.test.js tests/unit/thinking-format-override.test.js \
  tests/unit/mistral-claude-stream.test.js tests/unit/mistral-large-context.test.js
```

Alias config body (`test.resolve.alias`): `^open-sse/` → `<repo>/open-sse/`,
`^@/` → `<repo>/src/`.

Known red and not ours: `unit/openai-to-claude.test.js` (upstream regression),
`cached-token-e2e` / `request-details-tab` on Windows (`EBUSY` temp DB),
`headroom-responses-format` (V8 OOM).

## Commit style

Conventional Commits, one concern per commit. Fork commits should name the area
(`fix(stream)`, `feat(token-saver)`, `fix(desktop)`).

## Current state

- Version **0.5.125**, branch `fork/main`, upstream merged at `5ae63d22` (v0.5.123).
- Installed and running on this machine; data dir `%APPDATA%\9router`.
- Pending, not started: caveman OFF cohort needs a comparable window before the Token Saver
  comparison is meaningful; RTK effectiveness should be read after ~1–2 weeks of traffic.
