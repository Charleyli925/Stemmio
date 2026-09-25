# Archived Architecture Decision Records

These decisions shaped PageRoot but no longer constrain new implementation.
They are retained for historical investigation; the active index in the parent
directory is the default reading path.

| # | Title | Status | Successor / note |
| --- | --- | --- | --- |
| 0002 | [Native edit hosts are measured capabilities](0002-measured-native-edit-hosts.md) | Superseded | ADR 0004 |
| 0005 | [Project identity is separate from its readable storage directory](0005-readable-project-storage-directories.md) | Superseded | ADR 0022 |
| 0009 | [Canvas undo uses one persistent exact-Patch journal](0009-persistent-source-patch-history.md) | Superseded | ADR 0063 |
| 0013 | [Edit runtime visuals are disposable source-host bitmap projections](0013-edit-runtime-visual-projection.md) | Superseded | ADR 0017 |
| 0015 | [Safe host fallback and exact direct-text-node editing](0015-safe-host-fallback-and-direct-text-nodes.md) | Superseded | ADR 0004 |
| 0016 | [Review Runtime Snapshot owner](0016-owner-controlled-review-runtime-capture.md) | Superseded | ADR 0017 |
| 0017 | [Review-only runtime snapshot owner](0017-shared-runtime-snapshot-owner.md) | Superseded | ADR 0046 |
| 0018 | [Autosave and source history share one SourceTransaction kernel](0018-source-transaction-kernel.md) | Superseded | ADR 0063 |
| 0021 | [Review runtime visual comparison separates visible text from raster noise](0021-review-runtime-visual-comparison-noise-tolerance.md) | Superseded | ADR 0046 |
| 0023 | [Exact legacy V4 Registry metadata completion](0023-exact-legacy-v4-registry-migration.md) | Superseded | ADR 0028 |
| 0025 | [Edit runs the author program once in the final visible iframe](0025-edit-direct-one-shot-runtime.md) | Superseded | ADR 0065 |
| 0029 | [Review runtime visual comparison uses a tri-state verdict](0029-review-runtime-visual-tri-state-verdict.md) | Superseded | ADR 0046 |
| 0030 | [Review runtime projection tolerates authored host mutation](0030-review-runtime-projection-tolerates-host-mutation.md) | Superseded | ADR 0046 |
| 0031 | [Review capture serves allowlisted chart scripts from frozen bytes](0031-review-capture-frozen-chart-scripts.md) | Superseded | ADR 0046, Review portion |
| 0036 | [A discussion turn may show bounded visible Agent text, and that text never carries authority](0036-discussion-visible-text.md) | Superseded | Discussion product retired |
| 0041 | [Stage Codex through direct App Server preflight](0041-codex-app-server-execution-staging.md) | Superseded | ADR 0053 |
| 0042 | [Codex App Server execution stops at Candidate authority](0042-codex-app-server-candidate-execution.md) | Superseded | ADR 0053 |
| 0043 | [Enable packaged Codex Candidate execution](0043-enable-packaged-codex-candidate-execution.md) | Superseded | ADR 0053 |
| 0050 | [Review paints authored content before optional runtime evidence](0050-review-first-paint-before-runtime-evidence.md) | Superseded | ADR 0046 |
| 0055 | [Edit uses one bounded ECharts isolated-capture handoff](0055-edit-one-shot-author-runtime.md) | Superseded | ADR 0025 |
| 0056 | [Qoder ACP v1 synthetic spike](0056-qoder-acp-v1-spike.md) | Superseded | ADR 0032 |
| 0058 | [Bounded Canvas and SVG programs may complete the visible Edit document](0058-bounded-canvas-svg-edit-runtime.md) | Superseded | ADR 0065 |
| 0076 | [Tab display pages existed only during an explicit handoff](0076-transient-tab-display-handoff.md) | Superseded | ADR 0077 |

The archive preserves the original rationale. Collision-renamed files carry a
single renumbering note beneath their H1; no other historical body text was
rewritten.
