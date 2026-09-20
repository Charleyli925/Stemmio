# State-contract round persistence evidence

This report records the M1 baseline and the single O1 experiment authorized by
that evidence. It does not replace the historical decisions in
`PERSISTENCE_PERFORMANCE_DECISION.md` or
`PERSISTENCE_PERFORMANCE_12_PR1.md`.

## Source identity and method

| Evidence | Commit | Tree / renderer | Samples |
| --- | --- | --- | --- |
| M1 baseline | `fedaa7739123d1cfa40c231760f49f394f78316f` | renderer `sha256:938518956f288814443e15f4805aeede4669856e1a95f0b6c1bf661d2564e974` | 20 effective + 1 warmup at 0.5, 1.25 and 2.5 MiB |
| O1 candidate | `ebdfebc0254ad0cd9ff0d162c14e0167220c5f2c` | tree `89db9f7e9349bb5baeb6963015c1f4584e8f51cc`; renderer `sha256:b493b9ab3e2805025a7bc1e39f1bc47a6eca9e259c0f041ac2a26b0e29faf3e9` | 20 effective + 1 warmup at 0.5, 1.25 and 2.5 MiB |

Both runs used Node v25.7.0, Electron 43.6.0, Apple M5 Pro, the same fixture
sizes and operation order, and serial execution inside the harness. The only
source difference between the measured commits is
`app/workbench/comment-model.ts` plus its focused test.

The shared `origin/main` tracking ref advanced from `6e95876f` to `6ce1c299`
between the runs. The harness records that ref when it creates each report, so
its `baseline.mainSha` fields differ even though the executed sources are the
two exact commits above. The commit and renderer identities, not the moved
tracking ref, are the comparison authority. Other Electron activity existed on
the machine during both runs; absolute timing and tail differences therefore
remain diagnostic rather than release claims.

Raw structured evidence is ignored by Git and remains under
`output/persistence-performance/`:

- M1: `2026-09-19T18-57-30-697Z.json`
- O1: `2026-09-19T19-44-13-994Z.json`

Before delivery the task branch was rebased onto `origin/main@6ce1c299` so it
would retain the already-merged surface-navigation handoff fix. The measured
harness commit `fedaa773` maps to `a57844ac` and the measured O1 commit
`ebdfebc0` maps to `ba8c0458`; `scripts/benchmark-persistence.mjs` and both O1
files are byte-identical across those respective pre-rebase and delivery
commits. The rebase therefore changes ancestry and incorporates unrelated main
work without changing the measured harness or O1 implementation.

## M1 baseline

All three fixture sizes passed external-write conflict, restart recovery and
exact-source-byte oracles. Bridge warm RSS was not strictly monotonic at any
size. The fixed budgets still exposed broad cost rather than one proven leak:

| 2.5 MiB p95 | M1 | Fixed budget | Result |
| --- | ---: | ---: | --- |
| Bridge transaction | 2648.6 ms | <= 500 ms | fail |
| Electron autosave | 5563.0 ms | <= 1250 ms | fail |
| Dirty switch | 7252.7 ms | <= 750 ms | fail |
| Dirty close | 3448.9 ms | <= 750 ms | fail |
| Clean close | 280.4 ms | <= 50 ms | fail |
| Renderer rAF gap | 1129.8 ms | <= 50 ms | fail |
| Bridge RSS delta | 6.6 MiB | <= 32 MiB | pass |
| Renderer RSS delta | 455.4 MiB | <= 32 MiB | fail |

The response full-HTML copy was not reopened as O1. The historical 12-PR1
checkpoint already reduced that response to about 1.7 KiB without significant
end-to-end improvement and withdrew the production experiment. 12-PR2 remains
outside this round's authority.

## O1: delete the no-target SourceIndex build

`DocumentWorkflow` rebinds comment and change targets after an acknowledged
write. When there are no locatable local targets, the workbench codec formerly
called `rebindCanvasSelectionTargets(nextHtml, [])`, which still parsed, hashed
and indexed the complete HTML. O1 skips that call only for the empty local
target set. Global-page targets still pass through their existing exact
normalization, and non-empty local targets retain the original rebind path.

The test-only edit-pipeline counter provides the acceptance measurement:

| Target set | Before | O1 | Behavior |
| --- | ---: | ---: | --- |
| Empty | 1 full-source index build | 0 | returns the empty set |
| Global page only | 1 full-source index build | 0 | still normalizes to the exact global target |
| Locatable local target | 1 full-source index build | 1 | still rebinds text and source Hash |

The candidate repeated all 60 effective samples and all nine safety-oracle
results passed. There was no strict monotonic Bridge RSS growth. Selected
timing comparisons are retained only as diagnostic context:

| Size | Autosave p50 | Autosave p95 | Renderer rAF p95 | Renderer RSS p95 |
| --- | ---: | ---: | ---: | ---: |
| 0.5 MiB | 1812.6 -> 1684.5 ms | 2915.1 -> 1756.7 ms | 226.4 -> 233.0 ms | 86.9 -> 86.4 MiB |
| 1.25 MiB | 2578.4 -> 2556.8 ms | 3735.1 -> 2597.1 ms | 555.1 -> 559.1 ms | 220.0 -> 182.5 MiB |
| 2.5 MiB | 4432.2 -> 4366.7 ms | 5563.0 -> 4493.2 ms | 1129.8 -> 1128.2 ms | 455.4 -> 495.6 MiB |

Unchanged Bridge code also varied materially between runs, so the p95 movement
cannot be attributed entirely to O1. O1 is retained for the deterministic
one-build reduction on a high-frequency no-target autosave path, not as a
claimed latency or memory win. No additional optimization is authorized by
this evidence.

## Stop condition

This round stops after O1. It did not weaken source identity, Hash/CAS,
same-directory atomic replacement, source history, recovery or exact-byte
checks; it introduced no cache, monitoring service or alternate save queue.
Further work requires a new narrow profile that separates renderer parsing,
Bridge cost and environmental contention, plus separate authorization for any
production change beyond the no-target rebind deletion.
