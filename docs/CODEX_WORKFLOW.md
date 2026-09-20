# Codex workflow

This document defines the repeatable Stemmio workflow for Codex and other coding agents. `AGENTS.md` contains the compact mandatory rules; this file contains operational detail.

## Default completion boundary

Use the user's requested authorization level:

| Request | Default action |
| --- | --- |
| Analyze, inspect, explain, diagnose or review | Read-only; report evidence and make no changes |
| Modify or build | Create a task branch, implement, test, commit, push and open a Pull Request |
| Merge | Merge only when explicitly requested and required checks are green |
| Release | Version, tag and publish only when explicitly requested |
| Delete, rewrite history or change security/repository settings | Resolve the exact target and require explicit authorization |

An implementation PR is not a release. Merging to `main` updates the canonical source; only an immutable version tag may create an official installer.

## Task lifecycle

One lifecycle covers analysis, implementation and delivery, but every task uses
only the stages that match its type and authorization. A planning request stops
after a reviewable plan and acceptance method; a verification request runs only
the authorized checks; a review request stays read-only; implementation uses the
editing and delivery stages. Steps may be combined, reordered or omitted when
they do not apply. Permission, required verification and the definition of
complete do not become weaker as a result. Explain an omitted item only when it
limits the credibility of the conclusion.

| Stage | Judgement required | Record |
| --- | --- | --- |
| Intake | Does the user want analysis, planning, verification, implementation or later delivery, and how far may the task go? | outcome, allowed scope, behavior to preserve, completion standard, delivery authority |
| Investigation | What does current source and the owning rule actually establish? | verified facts, reasoned inferences, open questions and relevant call paths |
| Planning | What behavior must be proven through which real entry, and what would refute it? | key decisions, observable acceptance claims and verification method |
| Implementation | Is the change in the owner and no larger than needed? | focused diff plus necessary tests and edit-time checks |
| Verification | What actually ran, against which source, and what remains unproved? | version-bound result, first failure, result categories and coverage limits |
| Review | Is the actual diff correct against current contracts? | evidenced defects, unverified suspicions, suggestions and verification gaps |
| Delivery | What do the evidence and current authorization support? | actual deliverable, accessible evidence, remaining limits and delivery stage |
| Retention | What must remain to prevent a repeat? | regression test, owner-rule update or durable ADR when warranted |

Scale the record to the decision. A small task needs a few sentences, while an
asynchronous, public-interface or authority-boundary change needs the facts that
affect its behavior. Keep verified facts, inferences and open questions distinct;
source describes current behavior and accepted product or security rules define
required behavior. Check versioned third-party facts against official material.
For a significant change, state an observable acceptance claim rather than "the
tests pass", and surface a missing verification capability during planning.

Within the agreed scope, the implementer owns routine choices, necessary fixes
and proportionate retesting. When a new fact changes agreed behavior, authority,
write scope or the validity of acceptance, pause that affected part and hand it
to the task owner; unaffected work may continue. The task owner asks the user
only when a material choice or new authorization is required. Related findings
stay recorded outside scope unless the existing authorization already covers
them.

Verification and review use the rules in
[Test strategy](../tests/TEST_STRATEGY.md#改动类型与证据质量) and the applicable
review contract. Preserve the first failure and keep result categories distinct.
An ordinary implementation reaches a tested Draft PR; an explicitly authorized
later delivery continues under the existing Ready, merge, package or release
rules. Keep a regression test, owner-rule update or ADR only when it has lasting
value.

## Evidence and reports

Evidence lives in the existing carriers: the session and the Pull Request for a
simple task, `output/` reports and test artifacts for a complex one. Do not
transcribe machine-generated commands, counts and results into a second store.

Local raw evidence and reviewer-accessible evidence are different. Keep full
logs, sensitive details and large artifacts in the authorized local or CI
carrier. The Pull Request includes enough desensitized facts to check each
conclusion and links an existing CI artifact or other authorized shared carrier
when needed. A local `output/` path documents reproducibility, but does not by
itself make the material available to a GitHub reviewer and must not be the only
support for a reviewable claim.

A reader must be able to answer which source and baseline were verified, with
which method, in which environment, with which result, and how far the
conclusion reaches. When relevant uncommitted changes exist, bind the evidence
to the content actually tested instead of only `HEAD`. If a hook or another step
changes files after verification, re-check the diff and the affected evidence.

Results keep their own vocabulary: planned, discovered, executed, passed,
failed, skipped, not executed and missing are reported separately, and a missing
count is unknown rather than zero. A provider test without credentials reports
skipped, never passed.

Evidence supports its own conclusion and nothing wider. A local test pass is not
a complete CI pass, source verification is not a packaged-app verification, and
a third-party tool's own summary is not a verified result. Test counts alone do
not establish quality.

Private material follows the existing privacy rules: never commit or publish
real user HTML, attachments, project records, credentials, personal paths or raw
sensitive logs, and include only the desensitized minimum a public report needs.

## Stemmio Agent runtime boundary

Qoder and Codex both use the shared ACP runtime. Codex is discovered as an
independent user or Stemmio-managed `codex-acp` installation; the packaged
application contains neither a private Codex App Server path nor a native Codex
binary. Package verification checks that absence while the ACP catalog retains
the managed adapter/native closure and its integrity checks. 源页 Agent is a
separate `stemmio`/`http` path: Stemmio calls the user-selected OpenAI-compatible
HTTPS endpoint with a session Token and never grants the model filesystem access.

## Validation handoff and instruction scope

Worker handoffs use `CODEX_SUBAGENT_ROUTING_WORKSHEET.md` section 5.3: settle key
assumptions before delegation and pass the execution agreement in the request.
Workers handle local details without an approval round trip; the root resolves
reported blockers within existing authorization and completes agreed acceptance.

The implementing agent runs short edit-time checks and returns the tested source,
commands and results. The assigned tester owns task-level gates and version-bound
reports. The root agent reviews the diff, coverage and underlying evidence; it
reuses evidence when source, configuration, environment and validation scope still
apply, and repeats only affected checks for relevant changes, missing coverage,
failure or a specific unresolved risk. Follow the applicable session's tester routing.
`task:finish` already runs `gate:task`; do not run both as separate completion gates.
Required local, Draft, Ready and release boundaries remain distinct and mandatory.

The repository root is the single portable authority for Codex project setup:
`AGENTS.md` owns durable project guidance, `.codex/` owns project configuration
and custom agents, and `.agents/skills/` owns repository skills. A surrounding
local workspace may expose convenience symlinks to these exact paths, but must
not keep editable copies or become a source fallback. This keeps the primary
checkout, isolated worktrees, CI and fresh clones on the same configuration.

When handing off to a fresh agent, pass the applicable user constraints, checkout,
source identity including relevant uncommitted changes, scope and acceptance.
The root associates routing evidence with the task; children do not prove their
own model. Preserve
the user's root model; missing local configuration does not authorize
substitution. Do not copy the whole parent conversation.

## Standard commands

### Inspect

```bash
npm run task:status
npm run task:status -- --json
```

The command reports the repository, branch, commit, upstream, divergence from `origin/main`, changed files and clean/dirty state. Run it before editing and at implementation handoff; for read-only questions, inspect repository state only when it affects the answer.

### Start

```bash
npm run task:start -- fix/short-description
```

`task:start`:

1. verifies that the command is running at the primary Stemmio Git root;
2. refuses a dirty worktree or detached/non-`main` checkout;
3. fetches and prunes `origin`;
4. fast-forwards local `main` to `origin/main`;
5. refuses divergent `main` or an existing local/remote branch;
6. creates the requested short-lived branch in
   `.codex-worktrees/<prefix>/<name>`;
7. leaves the primary checkout on clean `main` and prints the isolated path.

It never stashes, resets, deletes or force-pushes.

Use `integration/` only for an explicit combination of multiple pending task
branches. `test/` is reserved for test infrastructure. To reopen an existing
local task branch in the standard location, run:

```bash
npm run task:attach -- fix/existing-task
```

### Finish

```bash
npm run task:finish
```

`task:finish` refuses `main` and a task with no diff. It runs:

```bash
npm run gate:task -- --base origin/main
```

The comparison base is fixed to `origin/main`; `task:finish` does not accept a custom `--base`. This prevents a newer branch ref from hiding earlier task commits from impact selection. The command covers committed, staged, unstaged and untracked task files, rejects source changes that occur while the gate is running, then prints a final repository report. It does not stage, commit, push, merge or release; the agent must still inspect and intentionally perform those actions. Do not run the same `gate:task` immediately before `task:finish`; the wrapper is the single end-of-task entry, while `gate:edit` remains available during development.

Inspect the selected task coverage without running it:

```bash
npm run gate:plan -- --base origin/main
```

Before any files have changed, query the same reading map by capability or known path:

```bash
npm run gate:plan -- --context-domain comments
npm run gate:plan -- --context-file app/lib/source-structure-edit.js
```

Those flags are plan-only. They choose the reading set from the requested
domain or path, never from mixing in the current Git diff. They never change
test selection, and `task:finish` keeps its fixed `origin/main` comparison base.
When several domains share a document, a whole-file requirement covers any
chapter requirement for that file.

The compact JSON lists changed files, matched owners, Node tests, capability canaries, estimated fan-out, and a schema-v2 capability context from `scripts/capability-context.json`. Its `defaultLevel` is `contract`: read `capabilityContext.contract.files` first; it contains only the matched entry interfaces and reports their `estimatedBytes`. Expand `implementationFiles`, `focusedTests` and `requiredDocs` (with named `sections`) only when that next class is needed. The flattened `implementation` set remains their union. `owners` remains top-level capability context metadata. Width warnings are informational. After an environment flake on the same source hash, resume with `npm run gate:task -- --resume <run-id>`; reuse requires an identical HEAD tree, dirty change-set, base, package-lock, Node version, platform, suite commands and surviving build artifacts. Ready/release/candidate/artifact complete proofs never resume.

After `gate:edit` or `task:finish` has passed for the current change, enlarge or
repeat verification only for new code, a new failure or a specific unresolved
risk. Do not rerun `npm test`, the complete Browser/Electron matrix or packaging
as extra insurance. Node passing does not prove Enter, IME, caret or iframe
continuity; keep public-behavior evidence for those paths. Packaging, merge and
release stay outside ordinary development unless the user explicitly requests
them. The installer rules in this file apply only to those authorized package
requests.

### Audit and retire

Run the read-only lifecycle audit from the primary checkout:

```bash
npm run task:audit
npm run task:audit -- --json
```

It derives state from Git worktrees, local and remote refs, divergence from
`origin/main`, file status and GitHub Pull Requests. Results distinguish the
protected primary checkout, open PRs, dirty work, local-only commits, merged
tasks ready for retirement, explicit abandonment review, detached temporary
worktrees and stale registrations. A missing `gh` session makes PR data
unavailable and therefore prevents merged-state cleanup; it never downgrades to
an unsafe ancestry guess after squash merge. A Pull Request is retirement proof
only when its recorded head OID matches the current local branch head; reusing a
historical branch name cannot make new work appear merged.

Retirement is a dry run unless `--apply` is present:

```bash
npm run task:retire -- fix/merged-task
npm run task:retire -- fix/merged-task --apply
```

Merged clean tasks may be retired after preview. An intentionally abandoned
task requires `--abandon`; discarding dirty files additionally requires
`--discard-changes`, and deleting its still-existing remote branch additionally
requires `--delete-remote`. Retirement always refuses `main`, the primary
checkout, locked worktrees and open Pull Requests. It removes the exact
worktree before deleting the local branch, then fetches and prunes `origin`.

Use `npm run task:sync-main` only from the clean primary checkout. It fetches,
prunes, switches to `main` when available, and fast-forwards without reset or
stash.

## Branch and Pull Request flow

### Mandatory P0/P1 scope-stop rule

Unless the developer explicitly requests exhaustive polish, zero remaining
findings, or a wider scope, only verified P0/P1 findings may expand a change
after the requested outcome is implemented and its applicable deterministic
gates pass. Record P2/P3 and unclassified minor findings in the Draft PR body,
review thread, or a follow-up item. Do not fix them in the current delivery, add
a new commit for them, return a PR to Draft, rerun a Ready gate, delay packaging,
or delay an otherwise authorized merge. Once no P0/P1 remains, continue the
authorized delivery lifecycle instead of starting another remaining-review
repair loop.

Classify by verified impact, not only by a review label. Data loss, wrong-file
or wrong-version writes, security or privacy boundary violations, irreversible
errors, untraceable source or installer provenance, and required deterministic
gate failures are P0/P1 blockers. This rule never grants authorization for an
external action and never bypasses exact head/base evidence, required gates,
source composition, release eligibility, or the separate authorization needed
for Ready, packaging, installation, merge, and publication.

1. Use a short-lived branch with an approved prefix.
2. Keep one coherent outcome per PR.
3. Open every PR as Draft. Draft opens, pushes and reopens run impact-selected `pr-feedback` (`gate:draft`: Node plus the selected capability canary) inside `ci.yml`.
4. The PR body follows `.github/PULL_REQUEST_TEMPLATE.md`: goal and scope, key
   decisions, verification evidence bound to the source, review and
   documentation, remaining limits and delivery state. Reference reports instead
   of pasting logs and matrices.
5. Keep the PR Draft while implementation and focused feedback converge. Batch accepted P0/P1 product fixes before promotion. The review service status, absence and unverified comments are informational. Root-agent-verified P0/P1 defects still block delivery, even when the review job and `release-gate` are green. Apply the mandatory scope-stop rule above; P2/P3 and unclassified minor findings do not require a new SHA or another repair cycle unless the developer explicitly escalates them.
6. When the head is ready, update it onto current `main` and mark the PR Ready once. That starts the complete source matrix. A PR opened already Ready also takes this path because `draft == false`. Codex review is requested automatically for that head, shown on the PR, and never included in `release-gate`.
7. Wait for the required `release-gate` and review the final GitHub diff, not only the local working diff. Do not restart already-green source lanes merely because `github.run_attempt` changed. A failed product suite on the same SHA cannot be washed green by rerunning; classify a true `ci_environment` failure first.
8. After explicit merge authorization, enable GitHub native Auto-merge for the exact head instead of polling and issuing a later manual merge. GitHub deletes the remote task branch after the squash merge; then audit and explicitly retire the local task before fast-forwarding primary `main`.

Do not use an installed app, DMG, backup folder or another checkout as a source for new edits. If the local checkout contains unrelated work, create an isolated Git worktree rather than stashing or mixing changes.

`ci.yml` is the only Pull Request workflow. Draft runs one lightweight planning job, then Ubuntu Node/Browser and any selected macOS Electron/AI canaries consume that frozen plan in parallel. Within one runtime, capability tags and changed specs are discovered together, deduplicated by project, file and full title path, and executed from one Playwright test list. The gate records planned, discovered, passed, failed, skipped and missing tests; a missing selector or planned test fails closed. Ordinary pushes never consume the complete Browser/Electron matrix. Ready runs `branch-policy`, `candidate-context`, `baseline-policy`, one Linux `linux-deps` populate and one macOS `macos-deps` populate, then Linux source build/Node/Browser and both macOS Electron lanes restore that OS/lockfile `node_modules` cache, optional credential-free `Release Dry Run`, and `release-gate`. Ubuntu Node/Browser jobs skip the Electron binary. Draft failures and cancellations upload `output/playwright` in addition to the lightweight evidence. `release-gate` verifies the baseline lockfile snapshot instead of auditing twice. `codex-review` is `continue-on-error` and is not a `needs` of `release-gate`. Returning to Draft skips the full matrix; a later commit on a Ready PR reruns the complete matrix for the new head. Opening a PR already Ready is supported. A same-run failed-job rerun reuses the successful `source-build` artifact through its run-ID-stable name and 30-day retention. Local development should normally stop at `gate:edit` and `task:finish`.

### Informational Codex review

Ready posts at most one `@codex review` comment per exact head via `scripts/request-codex-review.mjs`. `scripts/check-pr-review-policy.mjs` then writes an informational snapshot of live threads. P0/P1 comments stay visible; the review service itself does not fail the job or `release-gate`. The root agent verifies findings against the current diff and actual impact: verified P0/P1 defects block delivery, while lower-severity findings follow the scope-stop rule. There is no 30-second settle wait, no probe marker, no review-gate recovery workflow, and no weekly review-debt issue. Deterministic source fidelity, IPC, dependency, security and release checks remain hard gates in their owning tests and `baseline-policy`.

`candidate-context` classifies changed paths and calls the reusable credential-free `Release Dry Run` only when packaging, release metadata, Electron, packaged Bridge, Schema or bundled-resource risk exists. The classification reports changed-file count and scope for planning only: it never rejects a PR because it is large. The dry run crosses an unsigned App checkpoint between two clean macOS jobs, restores metadata, rebuilds the renderer oracle and launch-checks name/version/Bundle ID. The checkpoint is `releaseEligible: false`; the workflow has no secrets, signing, notarization, distributable, Candidate, tag or publication authority and cannot replace the formal post-merge flow.

Keep PR batching a judgement call rather than a repository rule. A coherent change may be large; split only when separate review, rollback or user-impact boundaries would be clearer. Local `npm run ci:health` can summarize recent `ci.yml` conclusions; it is not a merge gate.

After merge, CI authenticates the successful PR result against the exact `main`
Tree Hash. Candidate assembly, notarization, publication, failure
classification and rerun policy live in
`docs/RELEASE_PIPELINE_GOVERNANCE.md`; this file does not duplicate them.

## Latest installer source rule

Every successful installer handoff, formal or developer preview, must include
every associated Pull Request with its current GitHub status. When the user asks
for the latest installer without a source override, include the latest head of every
applicable Stemmio Pull Request that was not explicitly excluded.


开发者说“生成最新的安装包”、“生成最新的开发者测试安装包”或等价表述时，
默认范围不是“当前分支”，而是“最新 `origin/main` + 当前开发范围
内所有未被开发者明确排除的相关 PR 最新代码”。合并、开放、Draft 或关
闭未合并只是要报告的当前状态，不自动构成排除理由。

执行顺序固定为：

1. 同步 `origin/main` 并查询 GitHub 上的实时 PR 清单。
2. 记录本次应包含、明确排除和已被其他 PR 替代的项；每个排除项必须有
   可交付的理由。
3. 若存在未合并 PR，从最新 `origin/main` 建立临时 `integration/` 分支，按依赖
   顺序组合每个 PR 的最新 head OID，并去掉堆叠 PR 带来的重复提交。
4. 在这个干净、已提交的组合 Tree 上运行打包门禁。`package:developer`
   本身只打当前 Tree，不会在内部悄悄合并其他 PR。
5. 若最新 head 无法取得或存在未解决冲突，停止并报告，不得静默漏包。

只要组合 Tree 含未合并 PR，它就只能产生 `Stemmio Developer Preview`；
“生成正式安装包”不会把未合并代码冒充为正式源码，而是要求相关 PR 先通
过审查并合并，或由开发者明确排除。“只打 `main`”、“排除 #N”、“只包含
#N/#M”等说法才改变默认范围。

“给我开发者测试包”或等价的明确请求只触发可选
`Developer Preview`：干净提交、稳定 Developer ID DMG、独立数据根目录、包
内容校验和一次最小启动，不执行完整源码矩阵、公证、tag 或发布。证书缺失
或签名失败时直接停止，不生成 ad-hoc 替代包；Preview 自动更新检查与安装
关闭。“正式打包/发布”本身不隐含这一步。若开发者没有明确要求，代理不得
为了保险而自动生成测试包；若请求写明“不真实打包”，只能修改或检查流程
定义。完整操作边界见
`docs/DEVELOPER_PREVIEW_PLAYBOOK.md`。

正式安装包或开发者测试包的门禁通过后，还必须运行最后一个
package-delivery report 步骤。它把 DMG Hash 与精确 Commit/Tree、最近正式
tag 以来的提交和文件变化绑定，并从 GitHub 实时解析每个关联 PR 的开放、
草稿、合并和检查状态；未关联 PR 的直接提交不能隐藏。代理交付安装包时必须
把 `package-delivery-report.md` 的信息写进当次回复，逐个 PR 给出链接、当前
状态和一句话修改摘要，并补充打包前清单中所有排除/替代项及理由。若回复
前经过较长时间，应对同一 DMG 重新运行报告命
令以刷新可变的 PR 状态；无法取得实时 GitHub 元数据时，不得把安装包交付称
为完成。

## Documentation, decisions and retrospectives

Normative documents describe current requirements and current behavior. Planned,
accepted-but-unimplemented, implemented and retired material stay
distinguishable, and a future plan must not sit in an owner document written in
the present tense.

Comments keep the non-obvious contract: behavior, failure, timing, ownership,
exceptions and consequences. Delete a comment that restates the code, narrates
the change or repeats the architecture rationale, and keep the limit a
maintainer actually needs.

Write an ADR only for a decision with long-term value: the problem, the choice,
the alternatives that were really considered, the benefits, the costs and the
condition that would reopen it. Small mechanical changes need none. When a
related ADR already exists, do not create a duplicate: record the successor or
the current status through the [ADR curation workflow](ADR_CURATION.md), which
owns change notice, status marking, the index and archive moves and leaves an
ADR's historical rationale intact. The task owner gives the notice required by
that workflow before an ADR change and lists the actual ADR impact at delivery.
[The ADR index](decisions/README.md) is the living index.

A retrospective exists to prevent a repeat: an important escaped defect states
why the existing evidence did not catch it and which regression, rule or process
step will catch it next time. Not every small bug becomes an incident report.

History is neither disguised as a current rule nor rewritten. Superseded
material may be marked, archived or merged, but a trade-off with long-term value
must not survive only in Git history.

## Adding a workflow step

Every new workflow step states which real problem it solves, who executes it,
what useful evidence it produces and why the existing steps are not enough. If
that cannot be stated, it is not added. This applies to this document, to
`.agents/skills/`, to the templates and to automation.

## Documentation impact

Behavior and its documentation form one change. Use this routing table:

| Change | Update in the same PR |
| --- | --- |
| User-visible behavior or acceptance | `docs/INTERACTION_FLOW.md`, focused policy docs, and `CHANGELOG.md` when release-impacting |
| Product scope | `docs/MVP_PRD.md` |
| Source editing, persistence, IPC or trust boundary | `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, and an ADR for a durable architectural decision |
| Change Request, Attempt, completion, version or schema | `docs/CHANGE_REQUEST_PROTOCOL.md`, schemas, fixtures and compatibility tests |
| Development commands, CI or test ownership | `docs/DEVELOPMENT.md`, `tests/TEST_STRATEGY.md`, test impact map |
| Git or collaboration behavior | `docs/GIT_WORKFLOW.md`, `CONTRIBUTING.md`, `AGENTS.md` when the permanent rule changes |
| Architecture capability routing or user-visible guards | `docs/ARCHITECTURE_MAP.md`, `scripts/capability-context.json`, `docs/GUARD_LEDGER.md`, `docs/ENGINEERING_STANDARDS.md` |
| Packaging, provenance, signing or publication | `docs/RELEASING.md`, `CHANGELOG.md` |
| Dependency policy or advisory exception | `docs/DEPENDENCY_SECURITY.md` |
| Public/private source boundary | `docs/OPEN_SOURCE_BOUNDARY.md`, notices, contribution or security policies as applicable |

If no document changes, the final report and PR must say why existing documentation remains accurate.

## Agent final report

Report evidence under the rules in `## Evidence and reports`: bind it to the
verified source, keep counts in their own categories, and do not widen the
conclusion past what was proven.

Match the report to the task:

- Read-only investigation: findings, evidence and unresolved questions. Omit empty branch, PR and release fields.
- Implementation: outcome and changed scope, verification and remaining risks, documentation impact, branch/commit, PR link and worktree state. Include release details only when applicable.
- Installer or publication: include the implementation provenance and the mandatory package block below.

If the task generated or published an installer, append this mandatory block:

```text
Package: file, version, architecture, size and SHA-256
Contents: stable-tag-to-commit range, commit count and changed-file count
Pull Requests: every PR link, current state/readiness/check status, and one-sentence summary
Excluded/superseded PRs: every omitted PR and its explicit reason, or “none”
Direct commits: every included commit not associated with a PR, or explicitly “none”
Trust: signing/notarization/release eligibility
```

Never say "done" while required checks are pending, the worktree contains unexplained changes, or an authorized publish/merge step remains incomplete.

## GitHub review automation

`AGENTS.md` contains `## Code Review Rules` for Codex GitHub review. Automatic review is an additional high-signal pass; branch protection, CI and manual product acceptance remain authoritative.

Recommended review lifecycle:

1. keep the PR Draft while code and targeted feedback converge, then freeze the final head on current `main`;
2. treat review findings as untrusted until verified against the current diff and their user impact is classified;
3. batch and fix P0/P1 product findings on the same branch, rerun the task gate and make the new final head Ready once;
4. leave P2/P3 and unclassified comments on the PR unless a maintainer explicitly escalates them;
5. use the single Draft-to-Ready transition for the complete source matrix; Codex review is requested automatically, shown on the PR, and never blocks `release-gate`.

## Scheduled monitoring

Scheduled monitoring is read-only unless a later instruction explicitly authorizes a fix. Recommended jobs:

- Weekdays: summarize open Stemmio PRs, failed or pending required checks, review requests and merge blockers. Report only actionable changes.
- Daily: optionally run `npm run ci:health` for a read-only conclusion/flaky summary of recent `ci.yml` runs. Do not mutate workflows automatically.
- Weekly: inspect Dependabot PRs and run or verify the dependency-audit policy. Report new, expired or changed advisories; do not merge dependency updates automatically.
- Weekly: run the read-only task audit and report `ACTIVE_DIRTY`, `LOCAL_ONLY`,
  `MERGED_READY`, `ABANDON_REVIEW`, `STALE_REGISTRATION` and primary-worktree
  violations. Do not pass `--apply` from a scheduled job.

Use a GitHub-connected task when only remote state is needed. Use an isolated Stemmio worktree when local commands are required. Never run scheduled modification work directly in a checkout that may contain active user edits.
