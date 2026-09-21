# 合同 fixtures

活动正例只位于 `v3/`。它们用于 Schema 校验和跨文件语义测试，不是运行时工作区，也不能被当作真实用户记录直接写入。

`targeted-change/` 的源码边界样本（SourceIndex、TargetResolver、SourcePatchEngine 和 ScopeValidator）只保留在 `tests/fixtures/targeted-change/`，覆盖 Unicode、CRLF/LF、属性引号、注释、template/table/script、样式来源与模块排序；本目录不重复存放同一份文件。

`candidate-assessment-compat/` 保存一组纯合成的旧 Developer Preview
assessment、冻结 base 与候选 output。它代表仍受 v1 Schema 支持的省略退役字段形态，
用于证明历史查询从匹配 Hash 的 HTML 重算当前文档健康与连续性结果，不让旧脚本结论
进入当前状态。

`v2/` 不是兼容合同。该目录只保留五份最小拒绝输入，用于证明 v3 主 Schema 会拒绝旧记录，而不是静默补字段或迁移：

- `annotation-records.frozen.json`
- `change-request.frozen.json`
- `project-state.current-edited.json`
- `runtime-state.ready.json`
- `version-manifest.initial.json`

废弃的 v1/v2 主 Schema、旧 positive fixtures、migration report 与 `local-editor` / `restore` legacy fixtures 已从活动源码树移除。完整旧证据只存在于切换前只读备份；新运行时不会读取这些拒绝输入。

## v3 主记录

| Fixture | Schema | 重点 |
|---|---|---|
| `annotation-records.frozen.json` | `annotation-records.v3` | v3 TargetRef、评论与 edit event 冻结边界 |
| `change-request.frozen.json` | `change-request.v3` | 冻结 revision、候选身份、目标并集与 finalizer |
| `project-state.current-edited.json` | `project-state.v3` | 当前内容基于旧里程碑但不精确等于任一 Version |
| `project-state.current-version.json` | `project-state.v3` | AI 提交后 latest/based/exact 与源 Hash 同步 |
| `runtime-state.autosave-pending.json` | `runtime-state.v3` | 可恢复的单调 pending write |
| `runtime-state.autosave-conflict.json` | `runtime-state.v3` | 无 AI active run 的源文件写回冲突 |
| `runtime-state.processing.json` | `runtime-state.v3` | 当前项目锁定、其他项目仍独立 |
| `runtime-state.ready.json` | `runtime-state.v3` | 新 Version 提交并打开后的无锁状态 |
| `runtime-state.submitting.json` | `runtime-state.v3` | Request 已同步冻结、尚未发布 active run |
| `runtime-state.awaiting-conflict-resolution.json` | `runtime-state.v3` | 外部源与 AI 候选冲突的持久状态 |
| `runtime-state.recovering-transaction.json` | `runtime-state.v3` | 部分应用后保持锁定的事务恢复状态 |
| `version-manifest.initial.json` | `version-manifest.v3` | 新 Document 的初始 V1 |
| `version-manifest.internal-ai.json` | `version-manifest.v3` | 唯一允许的后续 Version 来源 |

## 当前辅助工件

下列工件各自仍处于严格 v1；它们是当前合同，不属于旧主记录兼容层。

| Fixture | Schema | 重点 |
|---|---|---|
| `candidate-assessment.ready.json` | `candidate-assessment.v1` | HTML 健康且与上一版连续；候选脚本内容不参与评估 |
| `scope-report.pass.json` | `scope-report.v1` | 直接 Patch 与旧 Attempt 的目标范围证据 |
| `completion.valid.json` | `completion.v1` | 有效变化的强完成信号 |
| `completion.no-change.json` | `completion.v1` | 比较 Hash 相同，不得建版 |
| `input-manifest.frozen.json` | `input-manifest.v1` | AI 可读文件的完整有序 Hash allowlist |
| `attempt-outcome.version-created.json` | `attempt-outcome.v1` | 唯一可引用正式 Version 的成功终态 |
| `attempt-outcome.no-change.json` | `attempt-outcome.v1` | 不消耗候选版本的无变化终态 |
| `attempt-outcome.cancelled.json` | `attempt-outcome.v1` | 恢复评论且释放候选号的取消终态 |
| `attempt-outcome.failed.json` | `attempt-outcome.v1` | 协议、执行或 Scope 失败的诊断终态 |
| `attempt-outcome.external-source-kept.json` | `attempt-outcome.v1` | 保留外部源且不提交候选的冲突终态 |
| `committed-marker.initial.json` | `committed-marker.v1` | 初始 V1 的历史可见提交点 |
| `committed-marker.valid.json` | `committed-marker.v1` | 内部 AI Version 的历史可见提交点 |

## 跨文件不变量

- Request、annotations、completion、transaction、Version、marker 与 outcome 的 project/document/request/attempt/candidate 身份必须一致。
- `candidateVersionId`、ordinal 和 label 必须一致；失败、取消、no-change、外部保留和 Scope violation 不消耗候选版本。
- output、Version entry、marker content 与最终源 HTML 的精确 Hash 必须一致。
- completion 与 Version 的 input manifest Hash 必须一致；Version、Request 和 Attempt 的 annotation archive Hash 必须一致。
- 提交完成后 project/runtime 的 latest、based-on、exact、current view 和 rendered Hash 必须同时指向同一正式版本。
- `readOrder` 与 input manifest 的文件路径必须严格一一对应；评论和 edit event revision 不得越过冻结边界。
- 只有带有效 marker 的 Version 可以出现在历史。
- v3 TargetRef 只允许 `targetId`、`label`、`level`、`selector?`、`textQuote?`、`sourceAnchor?`、`fingerprint?` 和 `resolution`。
