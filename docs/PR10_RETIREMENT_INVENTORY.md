# PR10 legacy retirement inventory

Status: Active retirement contract based on `main@f88cadf9a987728425e03a62e5a844532cee1bb0`.

PR10 removes only code whose current production graph is proven to be replaced. A
name such as `legacy`, `runtime`, `snapshot`, or `SourcePatch` is not deletion
evidence. Every deletion must retain Hash/CAS, atomic save, crash recovery,
external-conflict handling, current-session Undo/Redo, sandbox/navigation/IPC
safety, and the read-only compatibility surfaces below.

## Classification

| Item | Class | Current evidence | PR10 boundary |
| --- | --- | --- | --- |
| Retired `bridge/project-context-service.mjs` closure | `DELETE` (removed) | No production import remained. PR10 removed the helper, standalone test, and package/impact-map entries; v4 Project File owns new project mutation identity. | The v4 import guard proves the user's v3 registry/project tree remains byte-identical. |
| Retired `bridge/source-history-service.mjs` and `bridge/source-transaction-service.mjs` closure | `DELETE` (removed) | Neither service had a production import. The v4 Repository owns Working Copy CAS/atomic save/recovery; the later no-op compatibility route and shared journal decoder are now retired too. | Renderer `SourceHistorySession` remains the only current-open Undo/Redo owner; normal autosave retains exact operation evidence. |
| Retired Edit Runtime paint probes, activity freeze, disk snapshot/cache, per-node provenance reconciliation, and old Review screenshot/pixel authority | `DELETE` | ADR 0065/0066 and the live disposable Runtime/source-fact Review contracts supersede these capabilities. No live module has been identified for most of this already-retired code. | Delete only an exact live symbol/file with a zero-consumer proof. `app/workbench/review/runtime-projection.ts` is current presentation code and is not in this class. |
| ID-less TargetRef fingerprint resolver branches in `app/lib/target-resolver.js` and old comment-shape decoding | `DELETE` | Official managed Working Copy location is Stable-ID-only. Record decoding no longer accepts `id` as `targetId`, missing `commentId`, DOM `id` / `data-ai-id`, or selector-only source anchors. | Do not restore selector/fingerprint/`id` as an official location. |
| v3 immutable Version projection in `app/workbench/version-model.ts` and `app/lib/version-audit-records.js` | `DELETE` (removed) | Workbench reads only schema `4.0.0` Version rows. The v3 audit-collection helper is a retired module. | Do not add a v3 Version reader. |
| Existing schema-v4 Candidate records without `identityReport` | `DELETE` | Candidate schema and Repository load require `identityReport` and `submittedOutputSha256`. | Do not reintroduce an optional identity-report branch. |
| Legacy persistent source-history route/decoder/schema | `DELETE` (removed) | No production caller used the route; current text, style and structure Undo/Redo pass through the Renderer session and normal autosave. | Retirement gates forbid the endpoint literal, schema artifact and old journal APIs from returning. |
| `app/lib/source-patch-engine.js` as semantic-operation byte materializer | `UNKNOWN` | The semantic kernel and editor still use its exact range, replay, inverse, and parse-integrity evidence. | Keep until an independently tested replacement owns all current consumers. |
| `trackedTargetRefs`, `targetMappings`, and Canvas target refresh | `UNKNOWN` | Current editor/comment/selection and session-local inverse flows still consume them. | First separate Stable-ID deterministic refresh from ID-less history compatibility; do not bulk-delete. |
| `canvas-target-rebind.js`, common rebind codecs, and fingerprint fields | `UNKNOWN` | Stable-ID deterministic refresh and historical ID-less fallback share the same modules. | Delete only an isolated heuristic branch after proving no current target consumer. |
| `app/workbench/review/runtime-projection.ts` | `UNKNOWN` | Despite its name, it currently projects frozen source-derived Review facts into isolated frames. | It is not old Runtime DOM or pixel-diff authority. Keep unless Review presentation is replaced. |
| document surface cache | `RETAIN` | Multi-document Workbench uses bounded exact HTML data plus per-tab mode, PageViewContext and scroll state. The cache never mounts a display iframe; current-draft presentation uses the verified outgoing/incoming Canvas handoff. | Data and reading-state only; never Source, persistence, Runtime or presentation authority. |
| Canvas pool and Runtime residency modules | `DELETE` | The product keeps one active `HtmlCanvasEditor`; inactive tabs retain only bounded cache data and per-tab reading state. | Retired by the third serial negative-code PR after #415. |

## Required deletion proof

Before moving an `UNKNOWN` item to `DELETE`, the same PR commit must show:

1. no production import, route registration, package entry, or runtime consumer;
2. a guard test for the new main path and any retained compatibility decoder;
3. no weakening of Stable-ID, Hash/CAS, atomic-save, recovery, or security checks;
4. Node/Browser/Electron/package/startup/release-gate coverage appropriate to the
   removed closure.

If the proof is incomplete, the item remains `UNKNOWN` in this PR.

## Batch order

1. Add the new-project guard and this inventory.
2. Remove the proven-unused v3 Bridge project-context closure.
3. Re-audit each remaining candidate independently; move it to `DELETE` only in
   the commit that supplies its proof.
4. Deleted compatibility readers stay deleted; unknown members on mutable records remain preserved.
