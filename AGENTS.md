# Stemmio agent guidance

This repository is the complete public source boundary for Stemmio. Keep this
file short: follow the rules below, then read only the task-specific documents
listed under Progressive disclosure.

## Model and multi-agent routing

- Preserve the model and reasoning level selected by the user for the root agent. No `AGENTS.md`, skill, project default or child profile may replace, upgrade or downgrade it.
- This repository uses Codex multi-agent V2. Use the built-in read-only `explorer` and built-in `worker`; use the project-defined, model-neutral `reviewer` and `tester`. Do not create model-named role copies.

| Root selection | `explorer` / `worker` / `tester` | `reviewer` |
| --- | --- | --- |
| Sol below Ultra | `gpt-5.6-luna` / `max` | `gpt-5.6-sol`; High floor, then match XHigh or Max |
| Astra below Ultra | `gpt-5.6-luna` / `max` | `gpt-6-astra`; High floor, then match XHigh or Max |
| Sol or Astra Ultra | Codex native routing | Codex native routing |
| Any other root | Inherit root model and effort | Inherit root model and effort |

- For non-Ultra Sol/Astra, proactively delegate bounded independent work when it materially improves time or quality. Keep short, tightly coupled work or costly handoffs on the root; no fixed role pipeline.
- Before non-Ultra delegation, read `docs/CODEX_SUBAGENT_ROUTING_WORKSHEET.md` section 5 once for unchanged guidance. Send its compact task packet; every built-in worker request must include section 5.3's implementation inputs and execution agreement. Children receive only task-relevant constraints and reading.
- Non-Ultra operation allows at most three open children; Ultra retains native thread selection. Only one agent may write a worktree at a time, including test artifacts; read-only work may inspect frozen source and diffs. Leaf agents do not spawn children.
- Complete authorized implementation through agreed acceptance, including in-scope repairs and necessary retests; ask only for new authority, material requirement choices or unresolved blockers. Consultation remains read-only. The root owns steering, integration and final acceptance.

## Shared testing and independent review

- Outside native Ultra delegation, use tester for long existing test batches and reviewer for independent review when useful; short self-checks stay with the implementer/root. Follow `tests/TEST_STRATEGY.md` and, for asynchronous, harness or resource tests and failure triage, `.agents/skills/stemmio-test-reliability/SKILL.md`; the root owns coverage, gate level, failure classification and acceptance.
- `task:finish` already owns `gate:task`; never run both as separate completion gates. Reuse applicable evidence; repeat affected checks only for relevant changes, missing coverage, failure or a specific risk.
- Pass the task-specific reviewer/tester contracts: frozen source, authorized test output only, first-failure evidence and read-only review of actual code. Follow section 5's ownership transfer and acceptance rules; child summaries are not final proof.
- Verified P0/P1 defects and required deterministic gate failures block delivery; P2/P3 and unclassified minor findings follow the scope-stop rule without expanding the task. Delegation is neither a scheduler nor extra authority.

## Repository and authorization boundary

- Work only in this repository; a parent workspace is not a source fallback. GitHub `main` is authoritative; local checkouts, worktrees, installed apps, backups, `release/` and `output/` are working or generated copies.
- Preserve unrelated user changes. Never stash, overwrite, discard, reformat or stage them without explicit approval.
- Analysis, inspection, diagnosis and review are read-only. Implementation ends at a tested branch and Draft PR unless the user authorizes more.
- Do not merge, create or move a tag, publish a Release, or change repository/security settings unless the user explicitly asks.
- Never push directly to `main`, force-push a shared branch, rewrite a published tag or replace published Release assets.
- Decide ordinary local implementation choices in-scope; new authority, destructive operations, merge and release require a separate explicit request.

## Standard task lifecycle

For any implementation or delivery task, the root reads `docs/CODEX_WORKFLOW.md` sections `Task lifecycle`, `Standard commands` and `Branch and Pull Request flow`, and uses `.agents/skills/stemmio-engineering-workflow/SKILL.md` as the execution method; it reads `docs/RELEASING.md` only for packaging or release work. Children receive only the applicable steps in their task packet. The non-negotiable summary is:

1. Inspect with `npm run task:status`; work on an isolated task branch/worktree and never stash unrelated user changes.
2. Keep the diff focused. Use `gate:edit` while editing and run `npm run task:finish` once before publication; it already owns `gate:task`.
3. Review the unstaged and staged diff, stage only intended paths, then commit, push and open a Draft PR.
4. Stop at the tested Draft PR unless the user separately authorizes Ready, merge, packaging or release. After merge, audit and retire only the exact merged task.

## Product invariants

- Current HTML bytes are authoritative; Preview DOM is disposable. Visual edits use Stable ID semantic operations, with SourcePatch only as the internal materializer. Preserve unrelated bytes, source identity, native selection and IME behavior.
- Source commits fail closed on ambiguous targets, stale hashes, external writes, invalid scope, identity failures and unsafe paths; presentation or preflight uncertainty must not refuse edit entry. Privileged filesystem work stays behind narrow validated Electron/Bridge IPC.
- AI output remains untrusted until protocol, identity, hash, path and complete-HTML checks pass. Authored scripts are part of the user's requested HTML. Weak page continuity forces review instead of failing an otherwise usable candidate.
- QoderWork handoff remains clipboard-only unless the user explicitly authorizes a different product boundary. Authorized automatic paths are ADR 0032's Qoder ACP driver, ADR 0053's Codex ACP adapter, and ADR 0069's native OpenAI-compatible HTTP Agent. Anthropic is not authorized.
- Committed tests and fixtures use synthetic data only. Relevant editor/runtime/recovery changes also require real Electron acceptance using the user-designated local HTML corpus, as defined in `tests/TEST_STRATEGY.md`. Never commit real user HTML, attachments, project records, credentials, personal paths, logs or generated binaries.
- Implementation shape, ownership, testing and completion rules live in `docs/ENGINEERING_STANDARDS.md`; read only the sections relevant to the routed task.

## Locate, execute, and finish

- For code changes needing capability or ownership context, locate through `docs/ARCHITECTURE_MAP.md` and `npm run gate:plan -- --context-domain <id>` or `--context-file <path>`. Read the matched contract, owners, implementation, tests and named sections; expand only for a dependency, failure or contract change.
- If guidance conflicts, name and quote the files and state the affected decision. Use `docs/decisions/README.md` for living ADR status; do not infer current behavior from historical ADR prose.
- Enlarge or repeat verification only for changed code, missing coverage, a new failure or a specific risk. Node tests do not prove Enter, IME, caret or iframe continuity; use public-behavior evidence for those paths.
- Deliver the actual result, verification evidence and remaining limits. Do not widen the task into packaging, merge or release.

## User-facing design changes

For any change affecting what a Stemmio user sees, understands or operates, read `docs/PRODUCT_DESIGN_SYSTEM.md` and the relevant interaction contract, then use `.agents/skills/stemmio-product-design/SKILL.md`. Pure internal changes are exempt; scale evidence to the change and retain `DESIGN_LANGUAGE.md` section 5's lightweight exception for one-copy/token edits.

## Progressive disclosure

The paths below are read gates, not optional references: before the matching action, the root reads the named sections. Every fresh-context child task packet lists `required_reading`; the child reads it before acting and reports a missing source as blocked. Read no unrelated sections.

Use `ARCHITECTURE_MAP.md` and capability context when locating code ownership; read the relevant `ARCHITECTURE_CONTRACT.md`, `STATE_OWNERSHIP.md` and `SECURITY_MODEL.md` sections for module-boundary, public-interface or persistence changes. Simple documentation fixes need only their affected sources. Reuse already-read unchanged material; expand reading when source or assumptions change.

- Non-Ultra subagents: `CODEX_SUBAGENT_ROUTING_WORKSHEET.md` section 5. Testing: `DEVELOPMENT.md` and `tests/TEST_STRATEGY.md`.
- Git/task delivery: `GIT_WORKFLOW.md` and `CODEX_WORKFLOW.md`. Packaging/release: `RELEASING.md`. Dependencies or public-source boundaries: `DEPENDENCY_SECURITY.md` or `OPEN_SOURCE_BOUNDARY.md`.
- User-visible behavior: the named `INTERACTION_FLOW.md` section and focused policy. Design work additionally uses `PRODUCT_DESIGN_SYSTEM.md`, `DESIGN_REVIEW_PROTOCOL.md` and `DESIGN_LANGUAGE.md` as applicable.
- AI requests, schemas or versions: `CHANGE_REQUEST_PROTOCOL.md`, relevant schemas/fixtures and the focused AI or product PRD selected by capability context.

Repository skills live in `.agents/skills/` and provide the execution method for
their trigger; they reference the normative documents above and never restate
them. Development planning, implementation, verification and delivery:
`stemmio-engineering-workflow`. Pull Request, code or architecture review:
`stemmio-code-review`. Asynchronous test reliability and failure triage:
`stemmio-test-reliability`. Simplification, dead-code and over-design audit:
`stemmio-find-simplifications`. Engineering documents, comments, ADRs and
retrospectives: `stemmio-prose-standard`. Read only the skill that matches the
current task.

Before finishing, use `CODEX_WORKFLOW.md` section `Documentation impact`; when code makes an owner document inaccurate, update that document in the same PR. Do not duplicate a complex contract here.

## Code Review Rules

Before review, read `docs/ENGINEERING_STANDARDS.md` sections `Defense classes` (including `Validation placement`), `Asynchronous ownership and cleanup`, `Ownership and commit points`, `Requirements before mechanism`, `Where a limit must be enforced`, `Interfaces, model input and user-facing copy`, `Defaults, dependencies and compatibility`, `Tests` and `Definition of complete`, then the task-specific contracts routed above and `.agents/skills/stemmio-code-review/SKILL.md`. Apply these boundaries:

- Fail closed at irreversible filesystem, AI-adoption, identity, persistence and release boundaries; require equivalent protection and negative coverage for any change there.
- Converge or degrade automatically for reversible coordination failures. Presentation and preflight uncertainty must not block editing.
- Flag widened renderer/IPC/filesystem/AI authority, protocol drift, unsafe concurrent writes, real user data or secrets, and packages without clean source provenance.
- Verified P0/P1 findings block delivery. Review evidence complements deterministic gates and human acceptance; it does not replace them.
