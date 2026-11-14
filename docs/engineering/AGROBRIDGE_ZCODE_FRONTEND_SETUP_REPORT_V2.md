# AgroBridge — Z Code Enterprise Frontend Engineering Environment · Setup Report V2

- **Execution date/time:** 2026-11-12, 00:44–01:20 (+06:00, machine local clock)
- **Executor:** ZCode Desktop, acting as Principal Frontend Platform Engineer / Setup Orchestrator
- **Master prompt:** `AgroBridge_ZCode_Enterprise_Frontend_Setup_Master_Prompt_V2.md` (executed in dependency order; no phase skipped silently)
- **Companion artifact:** `AGROBRIDGE_SETUP_CHANGE_LEDGER.md` (kept in the setup workspace, outside the repo — see §K)
- **Status vocabulary:** per master prompt §3. Every claim below is tagged by evidence level: **directly verified** (command output in this run), **reported by a tool**, or **not determined**.

---

## A. Executive summary

**Overall status: PARTIALLY READY — ready for scoped enterprise frontend audit/design/QA work; implementation-ready with one verification gap.**

Completed and verified: host identification, repository identity, git safety baseline, full capability inventory, three new project skills + three reusable commands + a verified frontend-conventions source-of-truth document, 91/91 artifact validation checks, green baseline quality gates (typecheck, 276 web + 749 API unit tests, lint, i18n, build, preflight), and a live browser acceptance pass on `/login` + `/register` with screenshots.

Not completed: repo-scope skill/command **host discovery and trigger behavior** could not be observed from this session (it was not rooted in the repository — see §D/AT-05/AT-06); Playwright E2E and Lighthouse runs were NOT RUN (port/scope constraints); the in-app browser could not deliver clicks to React handlers (documented as unresolved harness-vs-product). None of these block starting scoped audit or implementation work; each has an exact verification step in §O.

**This is not a certification.** Nothing here claims WCAG conformance, production readiness, or an audited supply chain.

## B. Environment and repository baseline

| Item | Value | Evidence |
|---|---|---|
| Host | **ZCode Desktop 3.17.2.9661** (Electron), win32 10.0.26300 x64, Git Bash shell | `Get-Item ZCode.exe VersionInfo` — directly verified |
| Runtimes | Node **v24.19.0**, npm 11.17.0 ambient; **project pins Node 22** (`.nvmrc`); no nvm installed | direct; results on v24 are disclosed as **not transferable** per repo AGENTS.md §2 |
| Repository | `C:\Users\DST\projects\Agro bridge app`; remote `https://github.com/tanviruchahs2580/AgroBridge.git` (exact match); npm workspaces monorepo (`apps/api`, `apps/web`) | `git remote -v`, manifests |
| Git at baseline | branch `docs/release-record-1.4.2` @ `bf0dc1f5`, clean tree, no stash | `git status --porcelain` empty |
| Git at end | branch `main` @ `f8551fa7` — **moved by concurrent user work** (commits `5d66344` 00:08, `f8551fa` 00:48 by tanviruchahs2580; touched CI, API, docs — zero overlap with setup files). Setup changes sit cleanly on top. | `git log`, `git diff AGENTS.md` |
| Web stack (verified) | React 18.3.1, react-router-dom 7.18.2, TypeScript 5.7.2 (strict), Vite 6.4.5, Tailwind 3.4.17, framer-motion 13.1.1, lucide-react, Capacitor 8.5.0, Vitest 4.1.12, Playwright 1.62.1 + @axe-core/playwright 4.13.0, eslint 8.57.1 + jsx-a11y 6.10.2 | `apps/web/package.json` |
| Package manager | npm (only `package-lock.json`; root `postinstall` = `scripts/generate-prisma.mjs`) | lockfile inventory |
| Ports | API 4000, web dev **5173 `strictPort`** (shared with sibling project "Bangla GPT" — was occupied during this run; override `-- --port 5373` used), preview 4173 | repo AGENTS.md §3 + live `netstat` |
| Instruction files | Repo `AGENTS.md` (238 lines, current, authoritative); user `~/.zcode/AGENTS.md` (portfolio-wide) | read in full |

## C. Capability inventory

`Capability | Type | Source | Scope | Before | Action | Final | Verification | Notes`

- **Skills (host capability)** — native | ZCode | user+workspace | present | inventoried; 3 added | 7 repo-scope + 22 user-scope | parse-validated 91/91; discovery NOT VERIFIED for repo scope (§D) | workspace skills load when a session is rooted in the repo
- **Commands** — native | ZCode | user+workspace | none anywhere | **3 created** | `/frontend-audit`, `/frontend-enhance`, `/frontend-verify` | schema-validated vs `diagnosing-commands` rules; discovery NOT VERIFIED (same scope caveat)
- **Subagents** — native | ZCode (`~/.zcode/agents/*.md`) | user | 11 agents exist (incl. frontend-engineer, qa-engineer, security-reviewer, principal-architect; the three Bangla GPT-scoped `frontend-*` agents were renamed `bangla-gpt-frontend-*` and workspace-guarded on 2026-11-12 — see the two-project isolation audit in the setup workspace) | reused; roles mapped (§G); no new files | all roles covered | agent file format inspected directly | workspace-scope agent file location is not documented by the host guide → no repo-scope agents attempted (no guessed schema)
- **Plugins** — native marketplace | `~/.zcode/cli/config.json` | user | 11 enabled (browser-use, computer-use, github×2, context7, frontend-design, sentry, prisma, document-skills, zcode-mcp-app-dev, bangla-gpt-frontend-studio) | kept; no changes | enabled | user-config structure read (keys only) | **conflict noted:** `bangla-gpt-frontend-studio` skills carry Bangla-GPT-specific policies (plain CSS + React Query) that contradict AgroBridge's stack; repo instructions + new skills must win in-repo — flagged in risk register
- **MCP servers** — native | user config | user | 5 configured: figma, context7, playwright, chrome-devtools, shadcn | none added/removed | context7 **INVOKED + VERIFIED** this run (read-only React Router library lookup); playwright/chrome-devtools/figma/shadcn **NOT CONNECTED in this session** (no tools exposed) — presence verified in config only | see §F
- **Hooks** — native | user/repo config | — | none configured | **decision: NOT CONFIGURED** (rationale in §H) | — | — |
- **Browser control** — native (browser-use plugin, IAB) + repo Playwright | plugin | user+repo | available | used for acceptance | VERIFIED (2 routes, snapshots, 2 screenshots, navigation) with a click-delivery limitation (§J/AT-12) |
- **Quality gates** — repo tooling | repo | repo | comprehensive | none added; documented | all runnable gates green on v24 (§I) | second browser stack, new test runners, new deps: **NOT REQUIRED** (existing coverage is complete for the workflow) |

## D. Skills inventory

`Skill | Source | Scope | Before | Action | Final | Discovery test | Activation test`

Pre-existing repo skills (kept, unchanged — all parse-valid, well-formed, domain-accurate):

| Skill | Scope | Final | Discovery | Activation |
|---|---|---|---|---|
| money-idempotency-integrity | repo `.zcode/skills` | kept | parse-valid (validator) | NOT VERIFIED (session not repo-rooted) |
| prisma-postgres-safety | repo | kept | parse-valid | NOT VERIFIED (same) |
| pwa-capacitor-release | repo | kept | parse-valid | NOT VERIFIED (same) |
| rbac-review | repo | kept | parse-valid | NOT VERIFIED (same) |

Created by this run (all in `repo/.zcode/skills/` — note `.zcode/` is **deliberately gitignored** (`​.gitignore:85`), so these are machine-local, consistent with the 4 pre-existing skills):

| Skill | Purpose | Final | Discovery | Activation |
|---|---|---|---|---|
| agrobridge-frontend-system | web change workflow: routing wrappers, useResource/invalidate, sessionManager, offlineQueueRules allow-list, i18n ratchet, fail-closed role gates, gate commands | created + validated | parse-valid | NOT VERIFIED (see below) |
| agrobridge-design-system | token single-source discipline, raw-hex ban, dark-mode both-values rule, Bangla fonts, ui.tsx reuse, drift list | created + validated | parse-valid | NOT VERIFIED (same) |
| agrobridge-frontend-visual-qa | QA matrix (route/role/state/viewport), axe no-exclusion convention, console checks, evidence format | created + validated | parse-valid | NOT VERIFIED (same) |

User-scope skills relevant to this workflow (loaded and used during this run — **activation VERIFIED** for these): `zcode-configuration-guide`, `diagnosing-commands`, `diagnosing-hooks`, `control-browser` (all loaded via the Skill tool and followed); plus relevant available ones inventoried: `react-best-practices`, `composition-patterns`, `web-design-guidelines`, `webapp-testing`, `api-contract-change`, `verification-before-completion`, `shared-engineering-gates`.

**Honest limit — discovery/trigger:** workspace-scope skills are discovered by the host **from the current directory upward to the repository root**. This session ran in a draft workspace, so host discovery of the repo-scope skills was not observable. Frontmatter/name/description format was validated against the verified schema and matches the four working repo examples. **Verification step:** open a ZCode session rooted in the repo root, open the `/` menu (Commands group) and Settings → Skills, and confirm `frontend-audit`/`frontend-enhance`/`frontend-verify` and the three `agrobridge-*` skills appear; then invoke `/frontend-audit /login` as the trigger test. This is a 2-minute user step (§O).

## E. Plugins/extensions inventory

`Plugin | Publisher | Installed | Enabled | Permission scope | Data access | Invocation test | Decision`

| Plugin | Publisher | Enabled | Notes |
|---|---|---|---|
| browser-use | zcode-plugins-official | yes | **USED + VERIFIED** — IAB backend drove the acceptance browser pass (in-session) |
| zcode-guide | zcode-plugins-official | yes | **USED + VERIFIED** — configuration-guide + diagnosing-commands/hooks loaded and followed |
| computer-use | zcode-plugins-official | yes | not needed — NOT USED (native browser sufficed) |
| context7 | claude-plugins-official | yes | MCP verified (§F) |
| github (×2 publishers) | official | yes | not used; no Git-host writes performed |
| frontend-design | claude-plugins-official | yes | generic guidance; superseded in-repo by agrobridge-design-system skill (no conflict: different names; precedence documented in skill) |
| sentry / prisma / document-skills | official | yes | not needed for frontend setup — NOT USED |
| bangla-gpt-frontend-studio | dev marketplace | yes | **conflict risk** — its skills encode another project's stack policies; see risk register R3 |

No plugin was installed, removed, or reconfigured. Enable/disable state untouched.

## F. MCP inventory

`Server | Source/version | Transport | Purpose | Configured | Connected | Safe invocation | Security notes`

| Server | Transport | Purpose | Configured (user scope) | Connected this session | Safe invocation | Notes |
|---|---|---|---|---|---|---|
| context7 | http | library documentation lookup | yes | yes (tools exposed) | **VERIFIED** — `resolve-library-id "React Router"` returned candidates; read-only; no project data sent | keep |
| playwright | stdio | browser automation MCP | yes | no tools exposed this session | NOT VERIFIED | **overlaps** native browser-use + repo Playwright; per master prompt §9.3 do not add duplicates — already present, left untouched; candidate for user-level pruning (user decision) |
| chrome-devtools | stdio | browser inspection MCP | yes | no tools exposed this session | NOT VERIFIED | same overlap note |
| figma | http | design file access | yes | no tools exposed this session | NOT VERIFIED | AgroBridge design-file access was never authorized/verified; no placeholder connection created; token-bearing config values were **not read** (structure only) |
| shadcn | stdio | component registry | yes | no tools exposed this session | NOT VERIFIED | AgroBridge does not use shadcn/ui; documented as unused for this project |

No MCP server was added. None of the five was removed or edited (removal of overlapping pre-existing servers is a user decision, not a setup action). Workspace `.zcode/config.json` declares no MCP servers (its `skill` disable-overrides for 4 user-scope skills were left as-is).

## G. Subagent architecture

Host supports user-scope agents (verified: 11 files in `~/.zcode/agents/`, frontmatter `name/description/color/thoughtLevel/tools`; roles appeared live in this session's agent registry). **The master prompt's specialist team is already covered by existing agents; no new agent files were created** because the host guide documents agent files only at user scope and via plugins — a workspace-scope agent-file schema is not verifiable from official material, and guessing schemas is prohibited (§13.2 analogue, master prompt stop-condition).

Role mapping (orchestrator = the session itself, accountable):

| Master-prompt role | Existing agent | Permission boundary |
|---|---|---|
| frontend-engineering-lead | session orchestrator (+ `principal-architect` for decomposition/ADR ownership) | orchestrates; single writer of plan docs |
| ui-ux-architect | `bangla-gpt-frontend-design-lead` (renamed + Bangla GPT-scoped 2026-11-12; no AgroBridge-specific counterpart — spec visual work via the design-system skill) | read-only (no Edit/Write tools in its tool list — verified in file) |
| frontend-engineer | `frontend-engineer` (generic) · `bangla-gpt-frontend-implementer` is Bangla GPT-scoped only | writes only `apps/web/**` (verified in file text) |
| accessibility-reviewer | `bangla-gpt-frontend-visual-reviewer` (Bangla GPT-scoped only) — in AgroBridge use `qa-engineer` + the `agrobridge-frontend-visual-qa` skill checklist | read-only reviewer (verified: Read/Grep/Glob/Bash) |
| frontend-security-reviewer | `security-reviewer` | read-only by construction |
| frontend-qa | `qa-engineer` | writes tests/evidence, never product fixes |

**Delegation executed this run:** two read-only Explore subagents produced the design-system and architecture inventories (§H sources) with zero source edits — demonstrating the read-only parallel-review pattern (§10.8). **Known limitation:** the existing user-scope agents reference Bangla-GPT plugin skills in their method steps; in an AgroBridge session those step lists are partially inapplicable. Mitigation shipped: the new repo skills + conventions doc carry the AgroBridge-specific method and are cwd-discovered; agent bodies remain generic. Handoff contract format is embedded in the three commands (objective/scope/read-write/files-owned/must-not-change/output — §12 of the master prompt).

## H. Project instructions and custom assets

| File | New/Modified | Purpose | Scope | Backup | Validation |
|---|---|---|---|---|---|
| `docs/engineering/frontend-conventions.md` | **new** | single source of truth for web-layer engineering: stack table, routing/shell wrappers, data/auth/offline patterns, token+dark-mode rules, ui.tsx inventory, UI-state contract, i18n hard ratchets, test/a11y/QA infra, gate commands, deliberate decisions, **verified documentation-drift list (7 items)** | repo (versionable) | n/a (new) | 91/91 validator; citations re-spot-checked at final HEAD; 2 patched |
| `AGENTS.md` | **modified: +3 lines** (one §4 bullet pointing to the conventions + tokens docs) | wires the new doc into the existing instruction hierarchy without creating a competing file | repo | workspace `backups/AGENTS.md.pre-setup-20261112.bak` + git history | `git diff` = exactly 3 insertions |
| `.zcode/skills/agrobridge-frontend-system/SKILL.md` | new | see §D | machine-local (gitignored) | n/a | validator |
| `.zcode/skills/agrobridge-design-system/SKILL.md` | new | see §D | machine-local | n/a | validator |
| `.zcode/skills/agrobridge-frontend-visual-qa/SKILL.md` | new | see §D | machine-local | n/a | validator |
| `.zcode/commands/frontend-audit.md` | new | read-only audit workflow (§12.1 of master prompt) | machine-local | n/a | schema-validated (flat frontmatter, name regex, `$ARGUMENTS`) |
| `.zcode/commands/frontend-enhance.md` | new | scoped implementation workflow (§12.2) | machine-local | n/a | schema-validated |
| `.zcode/commands/frontend-verify.md` | new | independent QA workflow (§12.3) | machine-local | n/a | schema-validated |

**Hooks — decision record (NOT CONFIGURED):** configuration-file hooks require `hooks.enabled: true` and a documented events/matcher/output schema (verified via `diagnosing-hooks`). Two pieces could not be verified from official material: (1) the hook **stdin payload schema** (needed to know which file a PreToolUse/PostToolUse event touched), and (2) reliable repo-relative **script path resolution** for a committed hook (`${CLAUDE_PROJECT_DIR}` scoping when a session starts in a subdirectory). The master prompt forbids guessing payloads/paths (§13.2), and the repo's enforced gates (`i18n:check` hard-zero, `preflight` raw-hex/dead-class/CSP/budget bans, lint-warning budget 0, CI) already cover the candidate guardrails. A ready-to-review recipe (process-type hook, `Edit|Write` matcher, exit-0-tolerant warn-only script) is kept in the ledger workspace for a future approved change.

## I. Baseline and final quality checks

`Check | Command (cwd) | Baseline result @ bf0dc1f5 | Final result @ f8551fa | Exit | Status`

| Check | Command | Baseline | Final | Status |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` (root) | PASS | PASS (re-run) | **PASS** (Node v24 — not transferable to pinned Node 22, disclosed) |
| Web unit | `npm run test:unit` (apps/web) | 42 files, **276/276 passed** | not re-run (no web-source change) | **PASS** (baseline commit) |
| Web lint | `npm run lint` (apps/web) | 0 errors/0 warnings | PASS (re-run) | **PASS** (budget 0 holds) |
| i18n | `npm run i18n:check` (apps/web) | 386 ref / 538 declared / 0 missing; 0 inline ternaries | identical counts (re-run) | **PASS** |
| API eslint | `npx eslint src tests` (apps/api) | 0 errors, 120 warnings | not re-run | **PASS** (budget 143 holds) |
| Web build | `npm run build` (apps/web) | built 13.47 s; entry gzip 130.07 kB | not re-run | **PASS** |
| Preflight | `node scripts/preflight.mjs` (apps/web) | ALL PASS: entry 126.8/132 kB, JS 208.5/225, CSS 11.5/15, fonts 486.3/520, images 1771.4/2600 (gzip); no raw hex (1 allowlisted); 151 Tailwind classes resolve; CSP + vercel parity OK | not re-run | **PASS** |
| API unit | `npm run test --workspace apps/api` | 134 files; **749 passed + 1 skipped** | not re-run | **PASS** |
| Web E2E | `npm run test:e2e` | — | — | **NOT RUN** — 5173 occupied by sibling project's dev server; requires local API+DB; mitigation: repo's own suite unchanged and documented |
| Lighthouse | CI job | budgets verified statically by preflight (`pessimistic`, a11y ≥ 0.9, FCP 3 s, LCP 5 s, TBT 500 ms, CLS 0.1) | — | **NOT RUN** (live) / budgets VERIFIED (static) |
| Accessibility scan | `e2e/a11y.spec.ts` (axe, no exclusions, critical/serious=0, incl. dark) | conventions verified in source | — | **NOT RUN** live; manual semantic review of /login done (§J) |
| Android/Capacitor | CI-only builds | machine has no java/gradle/adb (repo AGENTS.md §10) | — | **NOT APPLICABLE** locally |
| Artifact validation | `node validate-setup-artifacts.mjs` (workspace) | — | **91/91 PASS** | **PASS** |

## J. End-to-end acceptance test (no product change)

Task executed: read-only audit of `/login` per the `/frontend-audit` command steps, on a local dev server started with the repo's documented port override (5373 — 5173 was occupied by the sibling project's server, which was identified by PID command line and left untouched).

| ID | Criterion | Status | Evidence |
|---|---|---|---|
| AT-01 | Host/version identified | **PASS** | ZCode Desktop 3.17.2.9661 (VersionInfo) |
| AT-02 | Repository identified | **PASS** | remote exact match + structure match |
| AT-03 | Git/user changes protected | **PASS** | baseline clean; concurrent user commits detected, documented, untouched; ending diff = setup-owned only; no stash/reset/checkout by this run |
| AT-04 | Repo instructions discovered | **PASS** | AGENTS.md read + applied throughout |
| AT-05 | Relevant skills discovered | **PARTIAL** | user-scope skills observable + used; repo-scope discovery NOT VERIFIED (session not repo-rooted) — verification step in §O |
| AT-06 | Skill behavior validated | **NOT VERIFIED** | trigger behavior unobservable for repo scope; user-scope skill activation VERIFIED (4 skills loaded and followed) |
| AT-07 | `/frontend-audit` equivalent invoked | **PASS** | executed as a real run: scope→instructions→source inspection→browser evidence→structured findings (below) |
| AT-08 | UX read-only role demonstrated | **PASS** | 2 read-only Explore subagents produced inventories; zero source edits by them |
| AT-09 | Frontend engineer scope understood | **PASS** | scope encoded in skills/commands/conventions doc; no product edit made |
| AT-10 | Accessibility review demonstrated | **PASS (with documented limit)** | representative findings from source + live DOM: labelled controls (`aria-label` on icon buttons, label/id association for phone+password), 44–48 px touch targets measured from rendered rects, visible focus tokens (`--ring-color`), reduced-motion kill switches, axe no-exclusion spec verified; **full axe scan NOT RUN** (needs full stack) |
| AT-11 | QA workflow invoked | **PASS** | gate matrix §I executed with exit codes (frontend-verify steps 2–3, 5) |
| AT-12 | Browser workflow verified | **PASS** | 2 local routes opened (390×844), DOM snapshots + 2 screenshots (dark theme active — boot-script path verified), direct navigation interaction; server stopped after; **limitation:** 4 click-delivery attempts failed in IAB (lang toggle, register link) — recorded UNRESOLVED harness-vs-product, authoritative check = repo's `e2e/english-mode.spec.ts` (NOT RUN) |
| AT-13 | MCP verified where configured | **PARTIAL** | context7 INVOKED+VERIFIED (read-only); other 4 servers configured-but-not-connected this session (§F) |
| AT-14 | New config/docs parse correctly | **PASS** | 91/91 validator (frontmatter, name regex, refs, flat keys) |
| AT-15 | No application source changed | **PASS** | final `git status`: `M AGENTS.md` (+3 lines, instruction file) + `?? docs/engineering/` (new docs dir); `.zcode/*` gitignored-local; zero `apps/**` diffs |
| AT-16 | Report complete and sanitized | **PASS** | this report; no secret values, no `.env` contents, no credential material (structure-only config reads) |

**Audit findings from the acceptance run (read-only, evidence-based):**

1. `/login` and `/register` render correctly in Bangla (default), with correct page titles, labelled fields, placeholder guidance, and an explained disabled state on the register submit button (consent required) — consistent with the repo's own UI-state and no-dead-control conventions.
2. Dark theme rendered correctly end-to-end in a real browser (attribute-based `data-theme` path).
3. **Unresolved:** language-toggle and link clicks did not reach React handlers in the in-app browser (4 attempts, three delivery methods; `document.documentElement.lang` unchanged). Direct URL navigation worked. Cannot distinguish IAB click-delivery limitation from a product defect from this evidence; the repo's `e2e/english-mode.spec.ts` and `farmer-journey.spec.ts` are the authoritative harnesses and were NOT RUN here.
4. `i18n:check` reports unused declared keys (e.g. `splashStatus*`, `svcFilter*`, `roleSERVICE_PROVIDER` — informational, exit 0); note as future cleanup, untouched per no-scope-creep.
5. Documentation drift (7 verified items) recorded in `frontend-conventions.md` §11 — e.g. shadow values, dark-mode description, surface hexes, stale `ui.tsx:17` comment citing a nonexistent `lib/tokens.ts`.

## K. Git and change safety

- **Starting status:** clean tree @ `bf0dc1f5` (branch `docs/release-record-1.4.2`), no stash.
- **Concurrent event:** user moved to `main` @ `f8551fa` mid-run (commits 00:08/00:48 by tanviruchahs2580). Setup files never conflicted; nothing of the user's was staged, stashed, reset, checked out, or reverted by this run.
- **Ending status:** ` M AGENTS.md` (+3 lines) + `?? docs/engineering/` (1 new file). `.zcode/` additions machine-local (gitignored by the repo's own deliberate rule — untouched).
- **Created:** 7 repo files (§H) + workspace ledger/validator/backup. **Modified:** 1 (`AGENTS.md`, backed up first). **Untouched:** all product source, CI, `.gitignore`, pre-existing skills/config.
- **Confirmation:** no application feature, backend, auth, database, deployment, PWA, or offline behavior was changed; **no commit, push, merge, PR, release, or deploy was performed by this run**; the only process started (vite on 5373) was stopped and the port verified freed; the sibling project's server on 5173 was never touched.

## L. Security and privacy review

- **New tooling and scopes:** 7 instruction-layer files inside the repo/workspace; zero new dependencies, zero new executables, zero new network endpoints, zero MCP/plugin changes. Attack surface added: none.
- **External data flows:** one read-only Context7 documentation lookup (public library docs query; no source code sent). Browser test hit only `localhost:5373`. No source code, telemetry, screenshots, or private material sent anywhere.
- **Secrets handling:** user-level MCP/plugin config was read **structurally only** (key names/types, no values). No `.env*` read. No secret values appear in this report or the ledger. The seeded e2e test account is referenced **by pointer** (`e2e/a11y.spec.ts`), not by value.
- **Supply-chain:** nothing installed → nothing to verify; the existing devDependency set was inventoried, not modified.
- **Unverified claims remaining:** repo-scope skill/command host discovery (§O step 1); MCP servers not connected this session (§F); the /login click behavior question (§J-3).

## M. Risk register

`Risk | Impact | Likelihood | Evidence | Mitigation | Owner | Status`

| # | Risk | Impact | Likelihood | Evidence | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | Repo-scope skills/commands are machine-local (`.zcode/` gitignored) — teammates/other machines don't get them | Medium | Certain | `.gitignore:85`; `git status` shows no `.zcode` entries | Decide: un-ignore `.zcode/skills` + `.zcode/commands` (repo policy change, needs owner approval) or document manual sync | User | OPEN |
| R2 | Setup artifacts not yet host-verified in a repo-rooted session | Medium | Certain (unobserved, not failing) | §D honest limit | Run §O step 1 (2-minute check) | User | OPEN |
| R3 | Bangla-GPT plugin skills + user agents carry another project's stack policies; may mislead a future AgroBridge session | Medium | Possible | plugin skill descriptions + agent method steps reference Bangla GPT paths/policies | In-repo precedence documented (AGENTS.md → conventions doc → skills). Optionally scope plugin per-project if the host gains project-level enablement | User | OPEN |
| R4 | /login click behavior unresolved in IAB (dead control cannot be excluded) | Low-Med | Unresolved | §J-3 evidence | Run `e2e/english-mode.spec.ts` + manual browser check; do not treat IAB result as a defect verdict | QA (next session) | OPEN |
| R5 | Baseline gates ran on Node v24, project pins 22 | Low | Certain | `.nvmrc`=22; no nvm on machine | Install/use Node 22 for release-affecting verification; treat v24 results as indicative only | User | OPEN |
| R6 | MCP overlap (playwright/chrome-devtools/shadcn) and unconnected figma server linger in user config | Low | Certain | §F | User-level prune/scope decision; none urgent | User | OPEN |
| R7 | Doc-vs-code drift (7 verified items) can mislead future editors | Low | Certain | conventions doc §11 | Fix docs in a scoped change when those areas are next touched | Frontend Eng | OPEN |

## N. Final readiness assessment (evidence-backed, no numeric scores)

| Area | Status | Basis |
|---|---|---|
| Z Code host/config readiness | **READY** | host version verified; config schemas verified via official plugin; all artifacts schema-valid |
| Skills readiness | **PARTIAL** | 7 repo skills parse-valid + 22 user skills available; repo-scope discovery/trigger unverified (R2) |
| Plugin/integration readiness | **READY** | existing plugins inventoried; browser-use verified live; no changes needed |
| MCP readiness | **PARTIAL** | context7 verified; 4 configured servers not connected this session; overlap documented |
| Subagent/orchestration readiness | **READY** | role coverage complete via existing agents + new commands embed handoff contracts; read-only delegation demonstrated |
| Frontend design/UX readiness | **READY** | conventions doc + design-system skill + verified token source of truth with drift list |
| React/TypeScript engineering readiness | **READY** | frontend-system skill + gates all green |
| Accessibility readiness | **PARTIAL** | conventions + axe infrastructure verified; live axe scan not run this session |
| Browser/visual QA readiness | **READY (with caveat)** | IAB verified for navigation/snapshot/screenshot; click delivery caveat documented (R4); repo Playwright is the authoritative stack |
| Bangla/localization readiness | **READY** | i18n ratchet verified green; fonts/shaping conventions documented and visually confirmed |
| Mobile/PWA/offline regression readiness | **PARTIAL** | conventions documented (kill switch, offlineQueue rules, Capacitor CI-only); local Android verification impossible by machine constraints (documented) |
| Frontend security/privacy readiness | **READY** | CSP/preflight/security-reviewer wiring documented; no secrets touched; client-side-auth-is-UX-only rule encoded |
| Quality-gate readiness | **READY** | every applicable gate ran green with exit codes; NOT RUN items honestly separated |

## O. Exact next steps

**User actions required (each is a specific decision or 2-minute check):**

1. **Verify host discovery of repo artifacts:** open a ZCode session rooted at the repository root; check the `/` menu Commands group for `frontend-audit` / `frontend-enhance` / `frontend-verify`, and Settings → Skills for the three `agrobridge-*` skills; then run `/frontend-audit /login` once. If anything is missing, consult the `diagnosing-skills` / `diagnosing-commands` skills (paths are verified correct per schema).
2. **Decide team-sharing for `.zcode/` artifacts** (R1): either approve un-ignoring `.zcode/skills` + `.zcode/commands` in `.gitignore` (a repo policy change — explicitly not done without approval), or accept machine-local scope.
3. **Decide Node 22 availability** (R5): install nvm/Node 22 or accept the v24 disclosure for local runs; CI already enforces the pinned runtime.
4. **Optional user-config pruning** (R6): playwright/chrome-devtools/shadcn MCP servers and the figma server (never verified for AgroBridge) — keep, scope, or remove via Settings → MCP. No setup action taken.

**Agent actions completed this run:** everything in §C–§H and §J; gates in §I; report + ledger written; workspace clean of repo pollution.

**Agent actions blocked (with exact blockers):** live Playwright E2E + axe scan + Lighthouse run (need ports 5173/4000 + API/DB stack; 5173 occupied by sibling project during this run); repo-scope skill discovery observation (session not repo-rooted — user step 1 resolves); Android builds (CI-only by repo policy).

**Future work outside this setup's scope:** fix the 7 documentation-drift items in a scoped docs change; evaluate the unused i18n keys list; resolve R4 via the repo's own e2e suite; ADR for any locked-pattern change (per conventions doc §10).

---

*Prepared by the ZCode setup orchestrator run of 2026-11-12. Companion ledger (workspace): `AGROBRIDGE_SETUP_CHANGE_LEDGER.md`. No commit, push, merge, release, or deployment was performed by the setup run.*
