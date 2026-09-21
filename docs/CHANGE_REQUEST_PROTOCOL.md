# Stemmio Change Request 协议

- 协议主版本：3
- 状态：当前冻结 Request 合同；只接受当前 Project File 流程
- 上位文档：[架构说明](ARCHITECTURE.md)
- 安全边界：[安全模型](SECURITY_MODEL.md)
- Schema 入口：[schemas](../schemas)
- 代表性样本：[fixtures/v3](../fixtures/v3)

本协议规定 Stemmio 与内部 AI 通过本地可见文件夹交接时的身份、目录、冻结、完成、校验、事务和恢复规则。

本文件定义当前 Project File Request 的冻结、执行、候选、版本和恢复合同。
Project v4 与 Request v3 是当前正式格式；发现其他主版本、缺失必填字段或旧
目录结构时直接返回 `UNSUPPORTED_SCHEMA_VERSION` / 无效格式错误。外部 HTML
仍可按正常导入流程建立新项目，但不会带入旧的评论、Request、Attempt 或 Version
关系。

受支持的 finalizer 入口是 `bridge/finalize-attempt.mjs --project-root`
→ `finalizeProjectFileAttempt`；supplement 入口是
`bridge/record-user-supplement.mjs --project-root`。两者都只处理当前项目目录，
不会读取旧 registry、旧 Request 或旧工作副本。

## 当前稿与手动建版

当前合同见 [ADR 0073](decisions/0073-single-current-draft.md) 和
[版本与项目文件需求](VERSION_AND_PROJECT_FILES_PRD.md)。

Project File 本地保存使用 sourceType=local-save，历史创建使用 history-copy，保留稿件
恢复使用 recovery-copy。它们不生成 AI Request/Candidate/finalizer，来源 AI
字段为 null，以 sourceOperationId 幂等绑定事务；基于版本与前序版本仍独立记录。
一个项目只维护一份当前 Working Copy，AI 采纳也更新同一身份和路径；冻结的
Request 输入、既有 Version 快照和 Candidate 校验边界保持不变。
Repository 只接受一个当前可编辑稿；历史版本是不可变快照，不存在旧多工作稿迁移。

## 1. 协议原则

1. 项目 `sourcePath` 当前指向的 HTML 是当前可编辑内容的唯一事实源。本地直接编辑修改这份文件；AI 成功先创建不可变 Version 与新工作文件，用户明确点击打开后才切换 `sourcePath`，不覆盖旧文件。
2. Request 是一次冻结快照，不随之后的本地编辑变化。
3. 系统是候选版本身份的唯一分配者。
4. 受支持 finalizer 最后原子写入的 `completion.json` 是唯一完成信号。
5. 工作台必须独立重算 Hash，不信任声明。
6. 只有带有效 `committed.json` 的 Version 才正式存在。
7. 运行时状态按项目隔离，当前项目锁不影响其他项目。
8. 所有新 JSON 使用严格 Schema，拒绝未知字段。
9. 仅打开或预览未登记 HTML 时，源文件、registry 和项目目录保持不变；第一次真实持久化或发送给内部 AI 时才建立项目身份与初始基线。

## 2. 目录

```text
项目记录/
└── projects/
    └── <displayName>__<YYYYMMDD-HHmmss>__<shortProjectId>/
        ├── project.json
        ├── PROJECT.md
        ├── runtime-state.json
        ├── edit-audit.jsonl
        ├── working/
        │   ├── <原用户文件名>-V1.1.html
        │   └── <原用户文件名>-V1.2.html
        ├── draft/
        │   ├── annotations.json
        │   └── attachments/<commentId>/<attachmentId>-<fileName>
        ├── recovery/
        │   ├── autosave.jsonl
        │   └── request-freeze/
        │       ├── <requestId>/
        │       └── <requestId>.json
        ├── transactions/
        │   └── <transactionId>/
        │       ├── transaction.json
        │       ├── recovery/source.html
        │       └── prepared-version/
        ├── versions/
        │   └── <versionId>/
        │       ├── files/index.html
        │       ├── annotations/records.json
        │       ├── version.json
        │       └── committed.json
        └── requests/
            └── <requestId>/
                ├── PROMPT.md
                ├── change-request.json
                ├── input-manifest.json
                ├── input/
                │   ├── base/index.html
                │   ├── annotations/records.json
                │   ├── attachments/<commentId>/<attachmentId>-<fileName>
                │   ├── AI_RULES.md
                │   ├── PROJECT.md
                │   └── references/
                └── attempts/
                    └── <attemptId>/
                        ├── USER_SUPPLEMENT.json
                        ├── supplement-attachments/
                        ├── candidate-assessment.json
                        ├── validation-review.json
                        ├── annotations.json
                        ├── output/<原用户文件名>-V1.x.html
                        ├── completion.json
                        └── outcome.json
```

约束：

- 每个项目拥有独立目录、runtime state、事务、Version 和 Request。
- registry 通过不可变 `storageDirectoryName` 定位当前项目目录。缺少当前
  storage identity、主版本或完整身份的记录直接拒绝，不会补写、迁移或按目录猜测。
- `PROJECT.md` 是整个项目长期使用的 AI 修改规则，不只属于某一次 Request；新项目首次打开时默认创建包含“项目目标、目标受众、内容与事实规则、视觉与表达、AI 修改边界”五段的简洁 Markdown 模板，用户也可以清空后按需填写。项目空闲时允许用户修改并由工作台自动保存，处理期间只读。Request 会把任务开始时已持久化的规则冻结到 `input/PROJECT.md`；Stemmio 通用边界只写在 `AI_RULES.md`，不预填到项目规则中。
- `runtime-state.json` 与 `edit-audit.jsonl` 是系统运行和本地直接编辑的审计文件，只建议查看，不提供普通用户编辑入口。
- `working/<原用户文件名>-V1.x.html` 是有效 AI 结果通过校验后创建的完整 HTML。它先进入“可审阅/打开”状态；审阅只读不会切换项目当前源，只有用户点击“直接打开”或在审阅页确认“打开 AI 修改后”才成为项目当前源。旧工作文件永不原地改写。
- input manifest、冻结 annotation 等可移植索引只使用项目或 Request 内相对路径。
- `PROMPT.md` 可以包含本机绝对 Attempt 路径和可直接执行的 finalizer 命令。
- `change-request.json` 的附件项可以额外包含由系统生成的 Request 内本机绝对 `localPath`，供当前电脑上的内部 AI / QoderWork 直接读取；同一项必须保留可移植的 `requestRelativePath`。
- 除受控的 Request/Attempt/output/completion/附件 `localPath` 外，结构化路径不得为绝对路径；所有相对路径不得包含 `..`，任何路径都不得通过软链接逃逸项目目录。
- output 只有一个完整 HTML，不得创建 `PROJECT.md` 或其他额外页面资产。
- Finder 在 Attempt 或 output 中生成的普通、非软链接 `.DS_Store` 只属于系统显示元数据，不参与协议也不改变状态；其他未声明条目和同名软链接仍按协议违规拒绝。

## 3. 身份

### 3.1 格式

| 对象 | 格式 |
|---|---|
| 项目 | `project_<stable-id>` |
| 文档 | `doc_<stable-id>` |
| Version | `ver_0009` |
| Request | `req_<stable-id>` |
| Attempt | `attempt_001` |
| Transaction | `txn_<stable-id>` |

### 3.2 候选身份

每个 Request 固定：

```json
{
  "basedOnVersionId": "ver_0005",
  "previousVersionId": "ver_0008",
  "candidateVersionId": "ver_0009",
  "candidateVersionOrdinal": 9,
  "candidateVersionLabel": "V9"
}
```

该 finalizer `message` 是给未知外部调用者的保守机器终态，不直接作为产品通知。复制模式
由用户手动停止外部 Agent；受管 Qoder 模式在持久取消之前已经由 Agent Bridge 停止，UI
不得再次提示“请手动停止”。

- `basedOnVersionId` 表示冻结内容的谱系基础。
- `previousVersionId` 表示时间线上最新正式 Version。
- `candidateVersionId` 是本次可能提交的下一版。
- 内部 AI 不得自行改名、递增或另建版本身份。
- 候选只有成功提交后才被占用。

协议字段使用当前严格 Schema 的 `candidateVersionLabel=V1/V2/V3`；UI 按同一 ordinal 显示“版本 1、版本 2、版本 3”。内部 AI 必须原样保留协议标签，不能把显示标签写回其他字段。

### 3.3 AI 输出文件命名

Stemmio 在冻结 Request 时一次性计算唯一输出名，内部 AI 只接收并写入
Prompt 指定的精确路径，不能自行计算、递增或改名：

```text
<原用户文件名主干>-V1.<candidateVersionOrdinal - 1>.html
```

- 原用户文件名主干来自冻结时的项目 `displayName`；移除 `.html/.htm` 与已有的 `-V1.x` 后缀，并按本地安全文件名规则规范化。
- 初始基线 `ver_0001` 对应 `V1.0`；候选 `ver_0002` 对应 `V1.1`，候选 `ver_0010` 对应 `V1.9`。
- `input/base/index.html` 只是冻结输入的机器存储名，绝不能据此把输出命名为 `index.html`。
- 同一文件名同时用于 Attempt 的 `output/` 和成功后的 `working/`；它不是严格 Schema 中的 `candidateVersionLabel`。
- 当前 Request 一律使用上述版本化名称；`output/index.html` 是无效旧格式。

## 4. 提交前冻结

### 4.1 锁定顺序

本轮提交先完成本地原生输入 checkpoint、项目登记、源内容冻结与必要保存，然后由 Bridge
持久化 `submission-receipt.v1` 的要求快照与 execution Turn。只有收到同一
submissionOperationId 的 accepted 回执，才执行服务预检；通过后建立 Request 并启动。
复制分支同样保存提交，跳过 Agent 预检，剪贴板成功仍只表示等待导入结果。

提交回执保存文档/工作副本身份、源指纹、完整评论（含修订与附件引用）、项目规则指纹、
Task Spec 和服务快照。它不授予执行权限。预检失败持久化 not-started，并保留用户要求；
提交保存失败不外发。Request 使用回执保留的 requestId，使重复 IPC 核对同一 Request。
改变要求必须使用新的 submissionOperationId；不能用同一身份替换快照。

Conversation 是不可变事实投影。提交回执先落盘，携带固定 conversationId、turnId 和
可重复推导的 messageId；投影失败重放同一回执，不启动 Agent。用户要求是一条已完成消息，
execution Turn 可以仍 queued。后续执行事实和重启恢复在 ADR 0071 / PR-4 中接通。

设置诊断不创建提交、Request 或 ticket。执行预检仍是一次性 ticket 权威，超时不应自动重发。
源字节、身份、附件与完整 HTML 的最终 Request 冻结校验保持不变。

### 4.2 冻结边界

冻结文件：

- `input/base/index.html`
- `input/annotations/records.json`
- `input/attachments/<commentId>/<attachmentId>-<fileName>`（存在时）
- `input/AI_RULES.md`
- `input/PROJECT.md`
- `input-manifest.json`
- `change-request.json`
- `PROMPT.md`

项目当前 `PROJECT.md` 不属于该冻结目录。Request 发布、提交协调结束后，用户可保存下一轮规则；执行、重试和恢复仍读取本 Request 的 `input/PROJECT.md`，采纳 Candidate 不回写当前规则。提交冻结和发布结果未确认期间仍保留规则保存协调。

冻结后这些文件不可修改。用户在内部 AI 对话中新增、修订或撤销要求时，内部 AI 必须先调用 Prompt 提供的受控 helper，把用户原话追加到当前 Attempt 的 `USER_SUPPLEMENT.json`；helper 返回成功后才能执行。原始 Request 不变。Attempt 已封存后，任何新要求都必须创建新 Request。

## 5. Change Request v3

权威 Schema：

[change-request.v3.schema.json](../schemas/change-request.v3.schema.json)

顶层结构：

```json
{
  "schemaVersion": "3.0.0",
  "status": "frozen",
  "projectId": "project_metrics",
  "documentId": "doc_dashboard",
  "requestId": "req_metrics_cards",
  "attemptId": "attempt_001",
  "createdAt": "2026-07-17T08:34:00Z",
  "frozenAt": "2026-07-17T08:34:00Z",
  "freezeCutoffRevision": 42,
  "versionIdentity": {
    "basedOnVersionId": "ver_0005",
    "previousVersionId": "ver_0008",
    "candidateVersionId": "ver_0009",
    "candidateVersionOrdinal": 9,
    "candidateVersionLabel": "V9"
  },
  "baseSnapshot": {
    "relativePath": "input/base/index.html",
    "byteLength": 4988,
    "sha256": "sha256:...",
    "comparisonSha256": "sha256:...",
    "canonicalizationVersion": "1"
  },
  "paths": {},
  "requirements": {},
  "annotations": {},
  "finalization": {}
}
```

### 5.1 `baseSnapshot`

- `relativePath` 固定为 `input/base/index.html`。
- `sha256` 是冻结字节的精确 SHA-256。
- `comparisonSha256` 是规范化算法输出的比较 Hash。
- `canonicalizationVersion` 固定解析/序列化规则。
- `byteLength` 必须与实际 UTF-8 字节数一致。

### 5.2 `requirements`

要求包含：

- `taskSchemaVersion`、`objective`、`scopePolicy`、`instructions`、
  `globalAcceptanceCriteria`、`nonGoals`、`targets` 和 `attachments`。
- 至少一条带稳定 `instructionId` 的指令。
- 每条指令引用明确 `targetRefs`。
- 每个 target 保存稳定 ID、用户可读 label、层级和定位。
- 不再写入 `legacySummary`、旧摘要兜底或 `preserveOutsideTargets`。

目标层级：

- `module`
- `subregion`
- `text`
- `insertion-point`

每个 TargetRef 必须使用 v3 的干净结构：

- `targetId`、`label`、`level`。
- 当前受管 Working Copy 目标包含 `elementId + expectedSourceSha256 + fingerprint.tagName`；标签指纹是拒绝 ID 错误迁移所需的完整性证据。`selector`、`sourceAnchor` 和其余 fingerprint 字段只供显示与审计，不是正式定位结果。
- 无 `elementId` 的历史 TargetRef 在受管 Working Copy 上正式结果为 `orphaned`。
- 选中文字时可包含 `textLocator.quote/startOffset/endOffset/affinity`；offset 是所属元素解码后代文字中的 UTF-16 位置，不扩大 AI 修改权限。
- 若包含源码锚点，只使用冻结基线中的 `sourceAnchor.startOffset/endOffset/sourceSha256`。
- 若包含指纹，使用 `fingerprint.tagName/stableAttributes/ancestorFingerprint`，可带文字前后缀。
- 面向 AI 执行的整模块 TargetRef 若文字引用超过 500 字符，`change-request.json` 省略低信息密度的 `textQuote`，仍使用 selector、sourceAnchor 和 fingerprint 精确定位；完整冻结记录中继续保留捕获时的引用用于审计。
- `resolution=exact|rebound|ambiguous|orphaned`。

`insertion-point` 的 `sourceAnchor` 必须是位于唯一父节点真实子节点边界上的零宽范围，即 `startOffset=endOffset`；不能使用旧 insertion `anchor` 对象或仅凭同级序号猜测位置。

offset 统一按 JavaScript UTF-16 code unit 计算。Request 只能把 `exact` 或 `rebound` 目标列入可执行范围；异常保留的 `ambiguous` 和 `orphaned` 评论仍保留审计记录，但不能驱动 AI 建版。当前产品不提供重新定位入口；用户需删除失联评论并在正确位置重新评论。

### 5.3 `annotations`

指向符合 [annotation-records.v3.schema.json](../schemas/annotation-records.v3.schema.json) 的冻结记录，并保存：

- 相对路径。
- 精确 Hash。
- 评论数。
- edit event 数。
- 附件数。

### 5.4 `finalization`

冻结：

- `outputRelativePath=output/<原用户文件名>-V1.x.html`，其精确值由 Stemmio 按 3.3 写入；其他输出路径直接拒绝
- `completionRelativePath=completion.json`
- `completionSchema=completion.v1.schema.json`
- 受支持 finalizer 版本
- 可直接执行的完整 finalizer 命令

Request 不定义任何基于时间窗口的成功条件。

### 5.5 Task Spec v1

系统在冻结时从已重新校验的
评论自动编译严格的 [Task Spec v1](../schemas/task-spec.v1.schema.json)：

- `objective` 忠实合并评论原文，不新增用户没有表达的目标；
- `instructions` 按评论顺序生成，每条均为 `priority=required`，并保留原始
  Target 与 attachment 引用；
- `scopePolicy` 为 `targets-only`、默认的
  `targets-plus-required-dependencies` 或 `whole-page`；页面级 `body` 评论使用
  `whole-page`，只有明确禁止修改目标外源码时才使用 `targets-only`；
- `acceptanceCriteria` 和 `nonGoals` 只复制评论中明确出现的约束，不由系统
  发明；
- `targets` 继续使用既有 Stable ID、源码 Hash 与定位证据，不生成第二套目标
  身份；
- `attachments` 只包含 Request 冻结副本，并必须由 instruction 显式引用。

`change-request.json.requirements` 只保存 Task Spec。原始 `comments` 与已经体现
在冻结 HTML 中的 `changeEvents` 只保存在 `input/annotations/records.json` 和
内部不可变 Request 记录中：前者是用户表达证据，后者是审计事实，均不是需要
再次执行的动作。新 Request 同时冻结 `taskSchemaVersion`、`policyVersion` 和
`promptTemplateVersion`。当前规则与 Prompt 模板版本均为 `2.0.0`；只接受这两个
当前版本字段。缺失字段或更早版本直接拒绝，不做原地改写、补齐、完成或取消。

## 6. Annotation records v3

权威 Schema：

[annotation-records.v3.schema.json](../schemas/annotation-records.v3.schema.json)

根记录固定：

- 项目、文档、Request、Attempt。
- `capturedAt`。
- `freezeCutoffRevision`。
- `basedOnVersionId`。
- `baseSnapshotSha256`。
- comments 与 edit events。

Comment 包含：

- 稳定 `commentId`。
- 创建/更新时间。
- `capturedRevision`。
- 正文与目标。
- `attachments[]`：稳定 `attachmentId`、图片/文件类型、文件名、媒体类型、字节数、Hash、项目相对路径、Request 相对路径和添加来源。
- `request-only` 或 `project-rule`。

附件实体保存在项目目录，草稿阶段位于 `draft/attachments/`；系统不保存用户桌面、下载目录、移动硬盘等外部原始路径。冻结 Request 时先收集并校验本轮全部评论附件，再逐个重新读取并核对字节数与 Hash，最后把实际字节复制到 staging 内的 `input/attachments/<commentId>/<attachmentId>-<fileName>`，完成整包校验后随 staging 目录一起发布。冻结副本必须是独立普通文件，不能是指向 Draft 的硬链接；复制后还要重新读取并核对字节数与 Hash。任何附件缺失、篡改、超限、目录、软链接或路径逃逸都必须在发布 `request.json` 和 Runtime authority 前终止，不能留下可被当作完整 Request 的半成品。冻结 Comment、`requirements.attachments[]`、对应 instruction 的 `attachmentRefs[]` 和 input manifest 必须引用同一组附件 ID；其中 `targetRef` 明确附件随哪条评论作用于哪个模块或子区域。

`requirements.attachments[]` 同时提供 Request 相对路径和 Request 管理文件的本机绝对 `localPath`。绝对路径只指向当前 Request 冻结快照，不得指向选择附件时的外部原文件。若项目目录整体移动，AI 应以 Request 根目录加相对路径重新定位。交接记录不得包含附件 Base64 或二进制内嵌内容。

Edit event 包含：

- 稳定 `eventId`。
- 时间与 revision。
- 发生编辑时的 `basedOnVersionId`；后续历史恢复不能改写这个事实。
- `text/style/reorder/structure`。
- 目标、摘要、before、after。

新记录没有 `committedVersionId`。本地编辑是事实审计，不通过保存变成 Version。成功的 AI Version 通过 `annotationArchive` 引用同一冻结记录；失败、取消、no-change 或冲突未采用时，Request 仍保留这些记录。

`input/annotations/records.json` 是不可变审计归档，保留评论和全部直接编辑事实，但不再作为 AI 默认执行输入。内部 AI 以 `change-request.json` 中的 instructions、targets 和 attachments 为唯一执行来源，避免重复读取同一评论和大量历史 edit events。

## 7. Input manifest

权威 Schema：

[input-manifest.v1.schema.json](../schemas/input-manifest.v1.schema.json)

Input manifest 同时包含完整冻结 Hash 清单 `files` 和 AI 执行读取子集 `readOrder`。

`files` 至少库存：

1. `PROMPT.md`
2. `input/AI_RULES.md`
3. `change-request.json`
4. `input/PROJECT.md`
5. `input/base/index.html`
6. `input/annotations/records.json`（完整审计归档）
7. 评论附件 `input/attachments/...`（存在时逐个列出，角色为 `comment-attachment`）
8. 其他明确列出的 references
每项包含相对路径、角色、媒体类型、字节数和 SHA-256。`readOrder` 默认依次只读 PROMPT、AI_RULES、change-request、PROJECT、base HTML、annotations 和评论附件；评论附件只有冻结 Request 内的 `requestRelativePath` 可读。AI 只能读取 `readOrder` 声明的执行输入，不扫描 files 中仅用于审计的条目、其他 Request、Version 或项目目录。

`input-manifest.json` 只描述冻结的原始输入。当前 Attempt 的 `USER_SUPPLEMENT.json` 是唯一允许在冻结后额外读取的动态执行记录；它不回写 manifest，也不能由内部 AI 直接编辑。

## 8. Prompt

Prompt 必须是当前 Attempt 的精简入口，只承载本轮动态信息：

- Task Spec 的 `objective`、`scopePolicy`、`instructions`、明确验收标准与
  `nonGoals`；
- `input-manifest.json`、`change-request.json`、冻结 `PROJECT.md`、冻结 HTML、
  annotations 与唯一 output 的当前本机路径；
- 有附件时，追加本轮 attachmentId、`requestRelativePath`、媒体类型、字节数和 Hash；
- 完整 finalizer 命令，并明确其在输出写入后最后执行。

跨任务不变的权威顺序、只读输入、唯一输出、Stable ID、Runtime/source
边界、范围模式、无关行为保留和副作用禁止只写在 `AI_RULES.md`。Prompt 只引用
这份通用合同，不重复 Stable ID 或 Runtime 规则，也不让 AI 猜输出文件名或版本号。

`AI_RULES.md` 的解释顺序为：`AI_RULES.md` ＞ `change-request.json` 中的显式 Task
Spec ＞ `PROJECT.md` ＞ comments/attachments/annotations 证据 ＞ 模型推断。本轮显式要求
可覆盖冲突的项目长期偏好，但不能覆盖 `AI_RULES.md`。附件只是引用它的 instruction
的证据；`annotations/records.json` 是审计与定位上下文，不是第二套指令。冻结
HTML 已包含截至 `freezeCutoffRevision` 的本地编辑，`changeEvents` 只可审计，不得重放、
撤销或重复执行。

## 9. AI 写入规则

内部 AI 可直接写 Prompt 列出的唯一文件：

- `attempts/<attemptId>/output/candidate.html`

AI 不得从 `input/base/index.html` 推导文件名，也不得用 `index.html`、自行递增的版本号或其他名称替换该路径。

`USER_SUPPLEMENT.json` 只能由受控 helper 追加，内部 AI 不得直接编辑。helper 可把内部 AI 当前对话新增的文件或图片复制到 `supplement-attachments/` 并记录字节数与 SHA-256；无法取得原件时只能写 `description-only`，历史中明确显示“原件未归档”。旧记录不可覆盖，只能通过 `add / amend / retract` 形成审计链。`add.refersTo` 可以指向它所补充的原始 `instructionId`；`amend / retract` 必须引用原始 instruction 或更早的 supplement record。所有写入、封存、建版与历史读取都使用同一组冻结 instruction 身份校验。

`amend` 会替代它引用的旧 supplement record，`retract` 会撤销它引用的 record；Prompt 和历史只消费最终仍有效的记录。有效补充与原始 TargetRef 一起解释用户想改什么，但不充当候选 Version 的逐节点授权表。身份、Hash、路径与协议仍按硬边界拒绝；脚本、handler、可执行 URL、普通正文、属性、结构和样式都是候选内容，由审阅流程确认。

finalizer 可写：

- output 中的受控版本 meta
- `attempts/<attemptId>/completion.json`
- `USER_SUPPLEMENT.json` 的封存字段与整组记录、附件 Hash

工作台事务可写：

- `transactions/<transactionId>/`
- `versions/<candidateVersionId>/`
- 真实源 HTML
- `project.json`
- `runtime-state.json`
- Attempt 的 `outcome.json`

AI 不得：

- 修改 Request 或 frozen input。
- 修改其他 Attempt。
- 写 Version 目录、commit marker、项目状态或源 HTML。
- 在 output 中创建未声明资产。
- 手写 completion。

## 10. HTML 机器元数据

finalizer 在 `<head>` 中写入或校验：

```html
<meta name="html-ai-document-id" content="doc_dashboard">
<meta name="html-ai-version-id" content="ver_0009">
<meta name="html-ai-version-label" content="V9">
<meta name="html-ai-based-on-version-id" content="ver_0005">
<meta name="html-ai-request-id" content="req_metrics_cards">
```

这些值来自冻结 Request。Version manifest 是最终身份权威；HTML meta 用于独立识别与交叉校验。

## 11. Finalizer 与 completion

### 11.1 finalizer 前置条件

finalizer 必须：

1. 解析受控 Attempt 路径。
2. 向上定位唯一冻结 Request。
3. 校验路径未逃逸项目。
4. 读取项目身份与 `runtime-state.json`。
5. 在拒绝非活动 Attempt 之前，检查当前确切 Attempt 是否已有普通文件 `cancelled.json`。
6. 若取消标记存在，校验其 Schema、project/document/request/attempt 身份、`status=cancelled` 与非空 `cancelledAt`；匹配时返回 11.4 的取消终态，身份不符或软链接等不安全标记必须失败关闭。
7. 若没有取消标记，确认 active run 身份完全匹配、状态允许完成，且未失败或被替代。
8. 校验完整 HTML。
9. 写入受控 meta。
10. 计算精确与比较 Hash。
11. 用临时文件、刷盘、原子 rename 最后写入 completion。

### 11.2 Completion v1

权威 Schema：

[completion.v1.schema.json](../schemas/completion.v1.schema.json)

```json
{
  "schemaVersion": "1.0.0",
  "finalizerVersion": "1.0.0",
  "status": "completed",
  "projectId": "project_metrics",
  "documentId": "doc_dashboard",
  "requestId": "req_metrics_cards",
  "attemptId": "attempt_001",
  "basedOnVersionId": "ver_0005",
  "previousVersionId": "ver_0008",
  "candidateVersionId": "ver_0009",
  "candidateVersionOrdinal": 9,
  "candidateVersionLabel": "V9",
  "baseSnapshotSha256": "sha256:...",
  "inputManifestSha256": "sha256:...",
  "outputRelativePath": "output/仪表盘-V1.8.html",
  "outputSha256": "sha256:...",
  "baseComparisonSha256": "sha256:...",
  "outputComparisonSha256": "sha256:...",
  "canonicalizationVersion": "1",
  "completedAt": "2026-07-17T08:40:00Z"
}
```

Completion 必须在 output 完全关闭后最后写入。完成后 output 封存；任何后续字节变化都使本次 completion 失效。

### 11.3 工作台发现 completion

工作台：

1. 只监听 `runtime-state.json.activeRun` 指向的确切 Attempt。
2. 原子读取 completion。
3. 校验 Schema 与 finalizer 版本。
4. 重新读取 runtime state，核对 active run。
5. 重读 Request 和实际 output。
6. 重算所有关键 Hash。
7. 进入 no-change、冲突或事务提交。

不扫描其他 Request，不按目录时间猜测，不复用旧 completion。
界面只根据 completion 是否已经出现显示“AI 已返回”；完成信号出现前的文件错误不得冒充 AI 返回。

### 11.4 已取消 Attempt 的 finalizer 结果

用户结束本轮后，官方 finalizer 对同一 Request/Attempt 返回成功退出的机器可读终态：

```json
{
  "ok": true,
  "status": "cancelled",
  "accepted": false,
  "retryable": false,
  "projectId": "project_metrics",
  "documentId": "doc_dashboard",
  "requestId": "req_metrics_cards",
  "attemptId": "attempt_001",
  "cancelledAt": "2026-07-29T08:40:00Z",
  "message": "本轮已在源页结束。请停止 AI Agent，不要重试。"
}
```

这是幂等的正常终态，不是 completion，也不表示候选已被接纳。finalizer 不修改 output、不写受控 meta 或 `completion.json`，工作台不创建 Version。重复执行返回同一类不可重试结果；AI Agent 必须停止，不能把它当作路径或保存故障重试。

## 12. 规范化比较

`canonicalizationVersion=1` 的合同：

1. 使用固定版本 HTML parser 解析冻结输入和 output。
2. 只删除五个明确白名单 meta：
   - `html-ai-document-id`
   - `html-ai-version-id`
   - `html-ai-version-label`
   - `html-ai-based-on-version-id`
   - `html-ai-request-id`
3. 用同一确定性 serializer 输出 UTF-8。
4. 计算两侧 SHA-256。

不得：

- 删除所有 `html-ai-*`。
- 忽略 CSS 或 JavaScript。
- 忽略正文、结构、普通属性或普通空白差异。
- 使用不同 parser/serializer 比较两侧。

比较 Hash 相同即 no-change：

- 不创建 Version。
- 不消耗候选身份。
- outcome 记录 `no-change`。
- Request、Attempt、评论和诊断保留。
- runtime state 回到 editing。

### 12.1 候选 HTML 健康与连续性评估

比较 Hash 不同不代表可以直接打开。Bridge 必须以冻结 base 和 AI output 生成：

[candidate-assessment.v1.schema.json](../schemas/candidate-assessment.v1.schema.json)

`candidate-assessment.json` 记录：

- base/output 精确 Hash 与比较 Hash，以及 Request、Attempt、候选 Version 身份；
- 完整文档、非空可显示 body 两项健康结果；
- 可见文字 shingles、稳定 id/data 锚点、class、资源引用和 title 的粗粒度重合证据；
- `ready | attention | blocked` 与稳定 issue code。

`blocked` 只用于候选无法作为正常 HTML 使用。协议、身份、Hash、路径、受管 metadata
和 completion 封存仍在 assessment 之前硬阻断。脚本、inline handler、可执行 URL 和
refresh 指令属于普通候选内容，不检测、不分级、不产生用户提示。`attention` 表示 HTML
可以打开，但系统无法充分证明它继承了上一版；Bridge 仍创建不可变候选 Version，界面必须
移除“直接打开”并要求先进入隔离对比审阅。`ready` 允许审阅或直接打开。

当前 assessment 还记录 Stable-ID impact 的 bounded Review 投影：线性计算的
`changedElementCount`、`requestedTargetCount`、`outsideTargetCount`，以及每类最多 100
个 ID 样例和 `truncated`。允许范围是每个评论目标根及其源码后代；整页 `body` 目标覆盖
页面，重叠目标取并集，目标内新增元素随 Candidate 目标根计入范围。兄弟顺序证据使用
parent ID 和前/后一个保留兄弟 ID，不使用绝对 sibling index。旧的三个无界 ID 数组
不是当前 Candidate 格式；出现时直接拒绝，不进入 Review 或源码写入边界。

当前 writer 只写完整文档、非空 body 与连续性字段，不写 `executable` 或
`health.executableSurfaceUnchanged`。这两个退役字段以及旧 Candidate 记录直接拒绝；
不会在内存中补齐、删除后继续执行或把归档 outcome 变成可打开候选。

TargetRef、评论和 supplement 继续作为生成指令与证据，但不再逐节点限制候选
Version。当前 Attempt 不生成 `scope-report.json` 或 `validation-review.json`；发现这些
退役记录时直接拒绝。`scope-validator.mjs` 已从源码删除：它不再服务直接 source patch
合同，也不得重新接入 AI Version 的接受门禁。直接编辑的岛外字节校验由
`source-patch-engine` 在提交点执行。Bridge 身份检查从 `html-source-parser.mjs`
读取 `rawStartTagAttributes`。现行候选政策（脚本改动不阻断、弱连续性只进审阅、
空 body 才阻断）由 `tests/candidate-assessment.test.mjs` 锁住；`createCandidate`
在 `tests/project-candidate-promotion.test.mjs` 证明同一政策进入持久化边界。

## 13. 校验矩阵

| 校验 | 不匹配结果 |
|---|---|
| completion Schema | `unsupported-completion` |
| finalizer 版本 | `unsupported-finalizer` |
| projectId/documentId | `identity-mismatch` |
| requestId/attemptId | `active-run-mismatch` |
| basedOn/previous/candidate | `candidate-mismatch` |
| base snapshot Hash | `base-snapshot-mismatch` |
| output 实际 Hash | `output-hash-mismatch` |
| 比较 Hash | `comparison-hash-mismatch` |
| canonicalizationVersion | `canonicalization-mismatch` |
| output 完整性 | `invalid-html` |
| output body 无可显示内容 | `HTML_BODY_EMPTY`，阻断 |
| 与上一版共同特征不足 | `PAGE_CONTINUITY_UNCERTAIN`，保留候选并强制先审阅 |
| completion 后 output 改变 | `sealed-output-modified` |
| active run 已取消/替代 | `stale-completion` |

硬校验失败不得创建 Version 或推进 latest Version。前端只把内部 error code 映射为稳定的
中文原因，不显示原始英文异常或代码串。失败与 no-change outcome 由 workspace API 作为
`recentRunOutcome` 恢复；用户返回编辑后仍可通过“上轮处理”再次打开，重启也不丢失。

`candidate-assessment.v1` 为历史记录保留可选的 `executable` 与
`health.executableSurfaceUnchanged` 只读字段；当前 producer 和 Renderer 都不生成、读取或
展示这些字段。

## 14. Current Version transaction

权威 Schema：

[current-version-transaction.v1.schema.json](../schemas/current-version-transaction.v1.schema.json)

当前 Version 创建、历史创建和 AI 采纳都使用同一份 current-version transaction。记录从创建时写齐 project/document、operation、source type、expected/after Hash、before/after Working Copy、state、draft 和 Version evidence。Repository 在每次恢复、查询和提交前重新验证这些身份与文件 Hash；缺少字段、旧状态或旧工作副本路径直接走无效事务错误，不会补齐或回放旧格式。

事务状态只有 `prepared`、`source-written`、`completed`、`aborting` 和 `aborted`。`prepared` 保存完整的 before/after 文件与 binding 证据；`source-written` 表示当前 Working Copy 已写入 after bytes；`completed` 表示 manifest、runtime 和 Version snapshot 已经以同一身份提交。中断时只恢复当前事务保存的 before/after 证据，不覆盖外部编辑。

Workspace 启动、项目打开、Version 查询和 AI 采纳都会扫描当前事务目录。相同 operation identity 的重试返回既有结果；Hash、路径、Working Copy 或 Candidate 不匹配时拒绝。当前保存中断、事务中断、超时和重复提交继续保留幂等恢复。

历史预览只读取不可变 Version snapshot。用户选择从历史创建新版本时，仍在同一 current Working Copy 上创建新的 Version，并以当前 transaction 记录替换结果；旧多 Working Copy 迁移、history activation receipt 和旧 promotion journal 不属于恢复输入。

### 14.1 Current adoption and recovery

AI Candidate 采纳由 current-version transaction 绑定 Candidate、Request、Attempt 和当前源 Hash。提交前会再次核对 Candidate evidence、source identity 和 binding；任何冲突都保留当前 HTML 并返回可重试的当前错误。重启后 `#recoverProject` 只恢复 current-version、save、source-element-identity 和当前 Request freeze 记录。

### 14.2 Commit marker

权威 Schema：

[committed-marker.v1.schema.json](../schemas/committed-marker.v1.schema.json)

Version snapshot、manifest 和 runtime 只接受当前写入方产生的身份与 Hash。旧 marker、旧事务字段和缺少私有 anchor 的记录直接拒绝；不会寻找替代证据或修改旧文件。
## 15. Version manifest v3

权威 Schema：

[version-manifest.v3.schema.json](../schemas/version-manifest.v3.schema.json)

Schema 使用 `sourceType` 常量区分严格分支。

### 15.1 Initial

只用于 V1，要求：

- 项目、文档身份。
- 固定 `ver_0001 / 1 / V1`。
- content 与 comparison Hash。
- canonicalization 版本。
- generatedAt、summary、files。

禁止出现 Request、Attempt、previous、basedOn 和 base snapshot。

### 15.2 Internal AI

要求：

- 项目、文档、Version ID/序号/显示名。
- previous 与 basedOn。
- Request、Attempt。
- 基础与最终精确 Hash。
- 两侧比较 Hash。
- canonicalization 版本。
- generatedAt、summary。
- completion 引用。
- Attempt outcome 引用。
- annotations archive，且同一个 Hash 分别指向 Version、冻结 Request 和 Attempt 中的归档路径。
- files。

新 Schema 不含 `local-editor` 或 `restore` 分支。

## 16. Project 与 runtime state

### 16.1 Project state

权威 Schema：

[project-state.v3.schema.json](../schemas/project-state.v3.schema.json)

`project.json` 保存：

- project/document 身份。
- sourcePath。
- latest Version。
- current based-on 与 exact Version。
- 当前 HTML Hash。
- 修改时间。
- 当前源文件和版本谱系 Hash。

它不允许 `activeRun` 或项目锁。

### 16.2 Runtime state

权威 Schema：

[runtime-state.v3.schema.json](../schemas/runtime-state.v3.schema.json)

`runtime-state.json` 是以下信息的唯一事实源：

- lifecycle state 与项目锁。
- edit revision 与 persisted revision。
- freeze cutoff。
- autosave 状态与恢复日志。
- 尚未写回的 `pendingWrite`：revision、预期源 Hash、目标 HTML Hash、恢复文件路径与 Hash。
- Request 尚未发布时的 `pendingSubmission`：冻结 revision、基础 Hash、预留的 Request/Attempt/候选版本身份和锁定时间；此时 `activeRun=null`。
- current/history view state。
- 当前评论和 edit event 草稿的权威文件路径、Hash、ID 与更新时间。
- active run；其中 `ready-to-open` 必须保留候选 Version 与 transaction 身份，直到用户确认打开、显式取消、确认“返回 AI 修改前”或进入可审计错误。审阅页没有退回本轮处理页的入口，因此候选不会因为“先离开审阅”而释放；确认“返回 AI 修改前”结束 active run，但已经发布的候选 Version、working HTML 与审计记录仍保留。
- `activeTransaction`：提交、AI 冲突或恢复中的唯一 transaction ID 与日志路径，禁止扫描目录猜测。
- 外部冲突。
- 事务恢复。

每个状态转换必须原子持久化。重启后不通过扫描 Request 推断。

## 17. Outcome

权威 Schema：

[attempt-outcome.v1.schema.json](../schemas/attempt-outcome.v1.schema.json)

Attempt 的 `outcome.json` 是工作台写入的严格诊断终态，不是完成信号。状态：

- `version-created`
- `no-change`
- `cancelled`
- `failed`
- `external-source-kept`

每个分支都引用 project/document/request/attempt/candidate、版本血缘、冻结源 Hash和 Attempt annotations archive。只有 `version-created` 引用正式 Version、transaction、completion 与提交时间；其他分支不得把候选版本解释为正式 Version。

`no-change` 还必须保存 input manifest Hash 和 `canonicalizationVersion`；`external-source-kept` 必须引用被终止的 transaction，证明候选没有被静默提交。

## 18. 取消

取消必须再次核对事务状态：

- `clipboard`：源页只能取消自己的 Request；若交接已确认，先提示用户外部 Agent 可能仍
  在运行，再写 durable cancel。
- `managed-agent`：Agent Bridge 先关闭 ACP mutation surface、发送取消并有界终止受管进程组；
  只有停止完成后才允许写 durable cancel 并解锁 Canvas。应用关闭走同一 dispose 边界。
  Bridge 重启后只把处理中的会话投影为不可重试的 `interrupted`，不扫描、复活或声称旧进程
  已停止。此时“结束本轮”把 durable cancel 作为旧 Request 的 authority fence，并保守提醒
  外部 Qoder 仍可能运行；同 Request 不得再启动或改为复制，只能重新发送为新 Request。

对受管 Agent，界面的“结束本轮”直接进入上述停止顺序，不弹出确认框；
按钮在 Bridge 投影 `cancelling` 时显示“正在结束…”。

- `submitting/processing/validating`：标记 Attempt 取消，恢复冻结评论，释放候选，回到 editing。
- `awaiting-conflict-resolution`：放弃未提交候选，保留源外部内容，恢复评论。
- `committing` 且 commit marker 尚未写入：按事务恢复规则完整回退或完成，不能直接删除。
- commit marker 已写入：Version 已提交，不能以“取消”撤销；候选进入只读历史并等待用户按正常“审阅对比”或“直接打开”流程处理。

迟到 completion 在取消后无效。若 AI Agent 在取消后才执行官方 finalizer，finalizer 必须返回 11.4 的 `status=cancelled`、`accepted=false`、`retryable=false` 终态，而不是通用写入失败；不得生成 completion 或 Version。取消标记身份不匹配时必须失败关闭，不能把另一个 Attempt 的取消状态套用到本轮。

## 19. 外部冲突

当源 Hash 不等于冻结 `baseSnapshotSha256`：

- 不覆盖源文件。
- 不写 commit marker。
- runtime state 进入 `awaiting-conflict-resolution`。
- transaction 保存外部、候选和基础 Hash。

采用 AI 候选时，更新事务的 `expectedSourceSha256` 为用户确认的外部 Hash，但不修改冻结 `baseSnapshotSha256` 或 basedOn 身份。

保留外部内容时，候选不提交，评论恢复，outcome 写 `external-source-kept`。

## 20. 旧格式处理

新程序必须在读取 registry、project、runtime、Request、annotations、Candidate、
Version 和事务时严格要求当前主 Schema。发现旧主版本、旧字段组合、旧回执或旧
工作副本路径必须返回清晰的 `UNSUPPORTED_SCHEMA_VERSION` / 无效格式错误，不得
推断、补字段、迁移、展示旧历史、回放旧回执或复用旧版本序号。若用户主动选择
旧 HTML，按普通外部 HTML 导入创建新项目 V1。

## 21. 完整性与安全

实现必须：

- 使用 UTF-8。
- 对结构化 JSON 使用 `additionalProperties=false`。
- 原子写 JSON 与关键 HTML。
- 拒绝路径穿越、软链接逃逸和跨项目引用。
- 校验每个声明文件的 byte length 与 SHA-256。
- 记录受支持的 Schema/finalizer/canonicalization 版本。
- 对 completion、candidate assessment、事务恢复和 commit marker 保持幂等。
- 将日志与用户内容分开，避免在诊断中泄露完整 HTML 或评论。

## 22. 协议验收

### 22.1 Request

- Request 发布前所有输入和 Hash 已冻结。
- `freezeCutoffRevision` 已追平落盘。
- basedOn、previous、candidate 三套身份明确。
- 不引用可变 current 目录。
- finalizer 命令和 completion 路径明确。

### 22.2 Completion

- output 单独存在 30 秒不触发校验成功。
- completion 缺失不建版。
- 任一身份/Hash 不匹配不建版。
- unsupported finalizer 不建版。
- completion 后 output 改变不建版。
- no-change 不建版。
- 取消后的 finalizer 可重复返回不可重试的 `cancelled` 终态，且不修改 output、不写 completion、不建版。

### 22.3 Transaction

- 无 marker 的 Version 不可见。
- prepared、source-applied、version-published、committed、cache-rebuilt 各边界可注入崩溃。
- 恢复后只能完整回到旧源或完整提交同一候选。
- 源、Version 快照和画布 Hash 一致后才报告成功。

### 22.4 Isolation 与干净切换

- A 项目 active run 不锁 B 项目。
- runtime state 不从 project state 或目录扫描猜测。
- 新运行时不读取 v1/v2 项目记录或 legacy marker。
- 旧目录和活动源切换前已有独立、只读、Hash 可校验的完整归档。
- 旧 HTML 快照只可作为普通 HTML 新建项目，不还原旧评论、Request、Attempt 或 Version 关系。

## 23. Agent delivery v2

New Request writers persist `{mode: "clipboard"}` or canonical
`managed-agent` provider/runtime, namespaced-model and reasoning selection with
`trusted-local-agent-v1`. The removed `qoder-acp` delivery shape is rejected.
Frozen requirements, recovery/status reads and the one-use ticket compare
the same selection. Unknown-provider history remains reviewable and cancellable,
but cannot start, restart, or fall back to clipboard or another provider.
Candidate and Version codecs contain no provider selection and remain unchanged;
review and adoption continue to validate their existing Request, Hash and source
authority rather than the availability of the historical provider.

For the native HTTP runtime, transport completion is not Candidate completion:
SSE `[DONE]` must follow an explicit successful model finish reason, and JSON
responses require the same success fact. Truncation, filtering, context/resource
exhaustion, abnormal stop and protocol-invalid termination publish no partial
output or completion. A truncated attempt remains the same frozen Request/Attempt
and projects `change-model`; Stemmio does not automatically resend, reduce
reasoning, switch provider or stitch partial HTML.

The Bridge-only bounded Agent event reducer may retain allowlisted HTTP transport
facts: output-parameter name/value, capability revision, transport-attempt
ordinal, normalized finish reason/category and numeric token usage. It must not
retain credentials, request/response bodies, public narration or private
reasoning in those diagnostic events, and the Renderer projection does not
expose them as conversation content.
