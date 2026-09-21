# Workbench 应用编排收口执行计划

- 状态：**历史基线（2026-08-11 至 2026-08-12），不是当前施工清单。PR-1 至 PR-7b 及 PR-7 最终 Composition/hard-gate 已合并；最终 hard-gate 提交 `e913d652`（PR #160）是 `main` 当前祖先链的一部分，2026-09-20 已核对。**
- 规划基线：`main@37bba7779b27c0a42a52f98ec84a377b964bf4eb`
- 基线 Tree：`0e074849493e5f9db9e89621e0a1c1a4910b8fa1`
- 基线日期：2026-08-11
- PR-7 实施基线：`origin/main@8fffb0529239b537f25fc0463921325babdf167f`
- 目标边界：Renderer Workbench 与现有 Application Sessions 之间的应用编排
- 明确不属于本计划：大文件 Patch transport、Bridge 路由或持久 Schema 重写、UI 改版、全仓 TypeScript 迁移、打包与发布

> 本文保留为历史施工合同与设计理由，不是生产实现授权或待办列表。日常定位应先读取
> `docs/ARCHITECTURE_MAP.md`、`docs/STATE_OWNERSHIP.md`、`docs/ARCHITECTURE_CONTRACT.md`、
> `docs/decisions/README.md` 与 `docs/CODEX_WORKFLOW.md`；只有需要了解当时约束或失败经验时才回看本文。
>
> 历史边界说明：本文中的 clipboard-only / 不控制 QoderWork 约束描述的是该次编排重构
> 的范围，已由 ADR 0032 的 Bridge-owned Qoder ACP Agent Bridge 产品决策取代。剪贴板
> Port 仍作为 fallback 保留；Request/Candidate/Review owner 约束继续有效。

## 1. 执行结论

本计划不重写 PageRoot 的安全内核，也不引入 Redux、Zustand 或第二套全局
Store。现有 `ProjectSession`、`DocumentSession`、`CommentSession`、
`DraftSession`、`RunSession`、`VersionSession`、`SourceHistorySession` 等继续是
各自事实的唯一 owner。

本次要解决的是另一层问题：`app/workbench.tsx` 虽然已经把事实放进 Session，
但仍亲自拼装 Bridge IO、定时器、重试、未知结果恢复、Drain、跨 Session 发布
顺序和 UI 反馈。因此一个业务动作仍可能同时跨越多个 Session、Bridge 调用和
React effect。

目标是在 Application 层引入一个薄的 `WorkspaceController` facade，并在其内部
按用例组合若干 workflow。Workbench 最终只做四件事：

1. 将 Canvas、文件选择、桌面 IPC、剪贴板等宿主能力适配为窄 Port；
2. 订阅一个只读 `WorkspaceControllerSnapshot`；
3. 把用户意图转换为 Controller command；
4. 把结构化 Outcome/Event 映射为 Drawer、Toast、焦点和视觉状态。

最终生产改动拆为 7 个 PR，生产代码按依赖**串行开发收口、串行 Ready、串行合并**。
测试设计、fixture 准备和只读审计可以并行，但不能让两个实现 PR 同时改写
`app/workbench.tsx` 后再机械合并。

## 2. 背景和目标

### 2.1 背景

ADR 0011 已经确认：Workbench 是 composition root，Session 是 mutable fact
owner，迁移不得双写、不得按行数随意拆分、不得一次性重写。当前实现完成了
“事实所有权”拆分，但没有完成“应用用例编排”拆分。

这使 Workbench 同时承担：

- project registration、workspace hydration 和 canonical source publication；
- autosave debounce、single-flight、恢复日志、SourceHistory acknowledgement；
- project open FIFO、switch fence、close handshake 和 Canvas reconciliation；
- comment/draft/attachment 事务与补偿清理；
- Request freeze、unknown POST reconciliation、run polling 和取消；
- candidate review、Version activation、history navigation 和冲突恢复；
- Drawer、Toast、焦点、评论 rail、键盘、文件输入等纯 presentation 行为。

其中后一组属于 Workbench；前六组属于可脱离 React 测试的 Application workflow。

### 2.2 用户目标

- 编辑后立即切换、关闭或发送时，不因旧异步结果覆盖当前项目；
- 评论、附件和 Request 的 UI 成功状态与真实持久状态一致；
- AI 后台轮询、取消、冲突和版本激活只更新其完整项目/Request 身份；
- 失败后提供同一恢复入口，不因 effect 重挂载或 callback 变化重复执行副作用；
- 本轮重构不改变任何可见控件、文案、顺序或正常交互结果。

### 2.3 工程目标

- `app/workbench.tsx` 中 `bridgeClient.*` 从 30 处收敛为 0；
- Workbench 不再拥有业务 debounce、poll interval、single-flight Promise、
  unknown-outcome reconciliation 或 Drain obligation；
- 每个跨 Session command 有稳定 operation identity、完整 ProjectContext、显式
  Outcome 和 stale-result fence；
- Workbench 不再直接 import `app/application/bridge-client.js`；
- Architecture gate 从“检查若干字符串和 owner 实例存在”升级为“拒绝 View 层
  Bridge 调用、拒绝 Controller 反向 import React/Component/Desktop”；
- 业务 workflow 可以用 Node unit test 注入 fake Bridge、fake clock、fake scheduler
  和 fake host port，不渲染整个 Workbench；
- 行数下降是预期结果，不是机械验收条件。若 Workbench 最后仍因 UI 渲染较大，
  另开 presentation extraction 计划，不能为了达到行数目标移动 owner。

## 3. 事实与根因

### 3.1 可复现基线事实

在规划基线运行：

```bash
wc -l app/workbench.tsx
rg -o 'bridgeClient\.[A-Za-z0-9_]+' app/workbench.tsx | wc -l
rg -o 'useEffect\(' app/workbench.tsx | wc -l
rg -o 'useCallback\(' app/workbench.tsx | wc -l
```

得到：

| 事实 | 基线值 | 解释 |
| --- | ---: | --- |
| `app/workbench.tsx` | 12,123 行 | 同时包含业务编排和 presentation |
| `bridgeClient.*` | 30 处 | View composition root 直接执行 Application IO |
| `useEffect(` | 74 处 | 包含业务 timer、observer、close/poll 等生命周期 |
| `useCallback(` | 122 处 | 多个大型跨 Session use case 被 React dependency graph 驱动 |

Bridge 调用基线分布：

| 方法 | 次数 | 当前主要 owner 候选 |
| --- | ---: | --- |
| `workspace` | 6 | registration/project/run workflow |
| `source` | 6 | document/project/version workflow |
| `versionFile` | 3 | version workflow |
| `resolveConflict` | 2 | document/run workflow，各一条 |
| 其余 11 个方法 | 各 1 | 对应 workflow |

### 3.2 规范与实现之间的缺口

`docs/ARCHITECTURE_CONTRACT.md` 要求：

```text
React views
  -> application sessions and coordinators
    -> domain state and pure transition functions
      -> typed Bridge client
```

并明确规定 View 只渲染 Snapshot、派发用户意图，Application module 拥有请求
generation、mutation outcome、recovery 和 orchestration。

当前 `app/workbench.tsx`：

- import 并在模块级构造 `createRuntimeBridgeClient()`；
- 构造所有 Session，同时保留 `autosaveTimerRef`、
  `historyActionPromiseRef`、`projectRegistrationPromiseRef`、
  `attachmentUploadCountRef`、`draftRecoverySequenceRef`、
  `navigationOperationRef`、`closeLifecycleRef` 等业务 ref；
- 直接调用 Bridge，并在 callback 内决定跨 Session 的写入和恢复顺序；
- 通过多个 effect 注册 Drain obligation、close 事件和 run poll timer。

现有 `scripts/check-architecture.mjs` 能拒绝 raw `fetch`、裸 endpoint、部分已退休
owner 和错误依赖方向，但没有拒绝 Workbench 调用 typed Bridge client。它还通过
搜索 `workbench.tsx` 中特定字符串证明 registration、freeze、Request 等约束，导致
门禁与巨型函数的物理位置绑定。

### 3.3 关键调用链和证据

#### A. 项目登记

```text
durable user action
  -> ensureProjectRegistered()
  -> bridgeClient.workspace() / ensureProject()
  -> validate epoch + IDs + canonical HTML + SHA
  -> ProjectSession.register()
  -> DocumentSession.publishAuthority()/update()
  -> VersionSession.hydrate()
  -> Comment target rebind
  -> DraftSession.replaceAuthority()
  -> SourceHistorySession.activate()
```

证据：`ensureProjectRegistered` 同时读取和写入 Project、Document、Version、Comment、
Draft、SourceHistory 六个 owner；single-flight 由 Workbench 的
`projectRegistrationPromiseRef` 拥有。

#### B. 编辑与自动写回

```text
HtmlCanvasEditor.onChange
  -> handleCanvasChange()
  -> enqueueAutosave()
  -> DocumentSession.beginEdit()
  -> VersionSession.markSourceEdited()
  -> SourceHistorySession.record()
  -> recoveryStore.write()
  -> Workbench 700ms timer
  -> flushAutosave()
  -> ensureProjectRegistered()
  -> bridgeClient.autosave()
  -> validate exact content/SHA/revision/history ack
  -> rebind Comment targets
  -> publish Document/Version/History acknowledgement
```

证据：`flushAutosave` 本身约 350 行；timer、audit pending/in-flight、recovery identity
和 write reconstruction 分散在 Workbench ref 与 Session 之间。

#### C. 切换与关闭

```text
open/recent/external/close intent
  -> prepareProjectSwitch() or html-ai:prepare-close
  -> DrainCoordinator.inspect()/drain()
  -> Canvas fence/freeze
  -> Document reconciliation / optional Bridge source reread
  -> ProjectOpenQueue (main process)
  -> ProjectApplicationSession FIFO
  -> applyProject() + refreshWorkspace()
  -> synchronous Project/Document/Version publication
  -> Canvas render acknowledgement
```

证据：Drain obligation 在 Workbench effect 中拼装；close listener 直接读取几乎所有
Session 和 workflow ref；`prepareProjectSwitch` 在 drain 前后多次核对 revision、
pending write、history action、Canvas Hash 和 project identity。

#### D. 评论、Draft 与附件

```text
comment/file intent
  -> ensureProjectRegistered()
  -> bridgeClient.saveAttachment() [optional]
  -> CommentSession mutation
  -> browser recovery record
  -> DraftSession.queue()/drain()
  -> attachment compensation delete on stale target/cancel/failure
```

证据：附件 upload count 是 Workbench ref；upload 完成后必须再次核对 comment/edit
session identity；删除、取消编辑和 stale completion 都可能触发补偿清理。

#### E. Request 与 Run

```text
generateRequest()
  -> native edit fence
  -> validate saved/locatable comments
  -> RunSession.beginSubmission()
  -> ensureProjectRegistered()
  -> synchronous Canvas freeze
  -> DrainCoordinator.drain("submit")
  -> exact persisted revision/SHA/TargetRef checks
  -> bridgeClient.createRequest()
  -> on unknown outcome: bridgeClient.workspace() reconcile
  -> RunSession track/freeze/uncertain/release
  -> clipboard handoff
  -> timer polling status / cancel / conflict resolution
```

证据：`generateRequest` 同时拥有 freeze cutoff、Drain、Bridge mutation、unknown POST
恢复、RunSession transition、Drawer 和 clipboard side effect。

#### F. Version 与历史

```text
status ready
  -> review candidate or activate
  -> bridgeClient.versionFile()/activateReadyVersion()/source()
  -> validate project/document/request/attempt/version/SHA/time
  -> prepareGeneratedSourceTransition()
  -> synchronous Project/Document/Version publication
  -> Canvas verification
  -> Draft reset / Run transition
```

证据：`openCommittedVersion`、`activateReadyResult`、`viewHistoryVersion`、
`returnToCurrent` 分别维护 operation lock、previous view rollback、Canvas fence 和
完整身份核对，但其生命周期仍由 Workbench callback/ref/effect 管理。

### 3.4 根因

根因不是“Session 太多”，而是迁移只完成了一半：

1. Session 已拥有 mutable fact，但部分 Session 仍以 setter/state-container 为主；
2. 跨 Session 用例没有独立 Application command owner；
3. React callback 为了读取最新值又保留 Promise、timer、generation 和恢复 ref；
4. UI presentation 与业务 Outcome 没有稳定的结构化边界；
5. architecture gate 证明了若干局部代码形状，却没有证明 View 层不执行 IO。

## 4. 目标架构与接口合同

### 4.1 目标依赖方向

```text
app/workbench.tsx
  -> WorkspaceController commands + snapshot + events
    -> ProjectWorkflow / DocumentWorkflow / CommentWorkflow
    -> RunWorkflow / VersionWorkflow
      -> existing Sessions (sole mutable-fact owners)
      -> typed BridgeClient
      -> narrow host ports

Workbench host adapters
  -> Canvas handle / desktop picker / close event / clipboard / Object URL
```

`WorkspaceController` 是 facade，不得成为新的巨型 Store。业务事实继续留在现有
Session；workflow 只拥有 operation identity、single-flight、timer、reconciliation
和跨 Session publication sequencing。

### 4.2 目标所有权

| 事实 | 最终 owner | Workbench 可见形式 |
| --- | --- | --- |
| project/document/comment/run/version 等业务事实 | 现有对应 Session | Controller aggregate snapshot |
| autosave timer、flush、history action、recovery write | `DocumentWorkflow` | persist projection/outcome |
| registration single-flight、hydration、switch、close | `ProjectWorkflow` / Controller | transition snapshot/outcome |
| Draft flush、attachment upload/compensation | `CommentWorkflow` + `DraftSession` | comment/draft projection |
| Request submission、unknown outcome、poll timer | `RunWorkflow` + `RunSession` | run projection/event |
| activation/history navigation operation | `VersionWorkflow` + `VersionSession` | version projection/event |
| Drawer、Toast、焦点、rail geometry、input element、About/update UI | Workbench | React state/ref |
| source bytes、Hash、revision、pending write | `DocumentSession` | read-only snapshot |
| durable source/Version/Request/Draft | Bridge repositories | decoded acknowledgement |

### 4.3 Controller 最小接口

最终接口可调整命名，但语义必须保持：

```ts
type WorkspaceController = {
  getSnapshot(): WorkspaceControllerSnapshot;
  subscribe(listener: (snapshot: WorkspaceControllerSnapshot) => void): () => void;
  subscribeEvents(listener: (event: WorkspaceEvent) => void): () => void;

  ensureRegistered(input?: RegistrationInput): Promise<CommandOutcome<ProjectContext>>;
  applyCanvasChange(input: CanvasChangeInput): CommandOutcome<{ revision: number }>;
  flushDocument(input?: FlushInput): Promise<CommandOutcome<void>>;
  performSourceHistory(input: HistoryActionInput): Promise<CommandOutcome<void>>;

  prepareProjectSwitch(input: ProjectSwitchInput): Promise<CommandOutcome<void>>;
  openProject(input: ProjectOpenInput): Promise<CommandOutcome<void>>;
  prepareClose(input: CloseInput): Promise<CommandOutcome<void>>;
  abortClose(input: CloseAbortInput): void;

  commitComment(input: CommentCommand): Promise<CommandOutcome<void>>;
  uploadAttachments(input: AttachmentCommand): Promise<CommandOutcome<void>>;
  flushDraft(): Promise<CommandOutcome<void>>;

  submitRequest(): Promise<CommandOutcome<void>>;
  cancelRun(input: CancelRunInput): Promise<CommandOutcome<void>>;
  resolveRunConflict(input: RunConflictInput): Promise<CommandOutcome<void>>;

  prepareReview(input: ReviewInput): Promise<CommandOutcome<ReviewCandidate>>;
  activateVersion(input: ActivateVersionInput): Promise<CommandOutcome<void>>;
  viewHistory(input: HistoryViewInput): Promise<CommandOutcome<void>>;
  returnToCurrent(): Promise<CommandOutcome<void>>;

  dispose(): void;
};
```

不要求实现为一个大文件。Facade 内部必须按 workflow 分文件；只有 facade 向
Workbench 暴露 API。

### 4.4 Outcome 合同

所有 command 必须返回显式 outcome，不能以“catch 后静默 return”表达未知状态：

```ts
type CommandOutcome<T> =
  | { status: "succeeded"; value: T }
  | { status: "blocked"; code: string; reason: string; recovery?: RecoveryIntent }
  | { status: "rejected"; code: string; reason: string }
  | { status: "unknown"; operationId: string; reason: string }
  | { status: "stale"; identity: OperationIdentity };
```

- `blocked`：本地前置条件未满足，未发送 durable command；
- `rejected`：权威端明确拒绝；
- `unknown`：mutation 可能已提交，必须查询 authority 后才能重试；
- `stale`：完整 identity 已不再 current，结果不得写入当前 UI/Session；
- UI 文案和按钮由 Workbench 根据 code/recovery intent 映射，Controller 不 import
  React component 或操作 Drawer DOM。

### 4.5 Host Ports

Application 层不得直接访问 React ref 或 `window.*`。Controller 通过窄 Port 使用：

- `CanvasAuthorityPort`：fence、freeze、unlock、render acknowledgement、select/clear；
- `ProjectOpenPort`：desktop dialog/recent/external opaque request，不接收任意 IPC；
- `CloseCoordinationPort`：只由 Workbench 同步注册事件，Controller 计算 readiness；
- `HandoffPort`：clipboard write + readback，不扩展为自动控制 QoderWork（本计划的历史范围；产品 Agent Bridge 现由 ADR 0032 单独拥有）；
- `RecoveryStorePort`：现有 browser recovery store；
- `HashPort`：SHA-256；
- `ClockPort` / `SchedulerPort`：`now`、timeout、interval、cancel，测试可控；
- `AttachmentBinaryPort`：把用户手势取得的 `File` 转为受限 upload input；
- `WorkspaceEvent`：结构化 presentation intent，不直接 set Toast/Drawer。

## 5. 全局边界条件

以下行为在所有 PR 中必须保持不变：

1. 当前 Source HTML 字节仍是唯一持久化权威；Preview/Edit DOM 不得被序列化回源。
2. 所有编辑仍只来自已接受的 SourcePatch；Selection、IME、TargetRef 和未命中范围
   字节保持现有 oracle。
3. Hash、CAS、expected revision、SourceTransaction、同目录原子替换、fsync、
   Renderer source history 和 restart recovery 不得弱化。
4. `/autosave`、`/draft`、`/request`、Version、Attachment
   的路由、payload、响应、错误码和存储 Schema 不变。
5. mutation 网络失败仍是 unknown outcome；不得自动重放同一无新前提 POST。
6. registered mutation 必须捕获完整
   `epoch + projectId + documentId + sourcePath`，迟到结果不得更新新项目。
7. close、switch、submit、history 继续使用同一 `DrainCoordinator` 语义。
8. Project、Document、Version 和 Canvas generation 的最终 publication 无 `await`，
   不得暴露半个 transition。
9. AI output 仍不可信，只有完整身份、Hash、协议和完整 HTML 校验后可审阅/激活。
10. Review 不激活 Version；Candidate 只有用户明确采用后才进入当前 HTML。
11. QoderWork handoff 在本计划范围内仍为 clipboard-only；不自动打开、控制或粘贴（该历史产品边界已由 ADR 0032 取代）。
12. browser preview 仍是只读弱能力；不得因 Controller 存在而获得本地持久权限。
13. 用户可见控件、文案、顺序、默认模式和正常结果不变。
14. 不增加新 npm dependency，不修改 Electron/Bridge 权限，不迁移用户数据。
15. 不以行数为由合并 owner，不在 renderer 建立 temporary dual-write。

明确不改：

- `bridge/workspace-bridge.mjs` 的路由和 SourceTransaction 实现；
- `desktop/main.mjs`、preload 和项目打开主进程队列的协议；
- `HtmlCanvasEditor` 的 SourcePatch/Editable Island 内核；
- AI review 分析性能与动态加载；
- 大文件 Rope/Piece Table/Patch transport；
- 评论 rail、Version UI、通知视觉和 CSS；
- 全仓 JS → TS。新 Application 模块沿用当前可被 Node 22 直接测试的 JS + 必要
  `.d.ts` 边界；类型迁移另立计划。

## 6. PR 拆分与执行编排

### 6.1 依赖图

```text
PR-1 Controller contract + registration seam
  -> PR-2 Document persistence + source history
    -> PR-3 Project switch + hydration + close
      -> PR-4 Comment + Draft + attachment
        -> PR-5 Request + Run lifecycle
          -> PR-6 Version activation + history navigation
            -> PR-7a Source rename transition workflow
              -> PR-7b Project rules workflow
                -> PR-7 Final composition cleanup + hard architecture gate
```

### 6.2 Bridge 调用收敛预算

PR-1 在 architecture gate 中建立临时、精确、只减不增的迁移 allowlist。它不是
永久例外；PR-7 必须删除 allowlist 并改成绝对禁止。

| 阶段 | Workbench 允许剩余的 `bridgeClient.*` 上限 | 主要移除调用 |
| --- | ---: | --- |
| Baseline | 30 | — |
| PR-1 | 28 | registration 的 `workspace`、`ensureProject` |
| PR-2 | 20 | `autosave`、history、document source/reconcile |
| PR-3 | 16 | project workspace/source、project file/folder |
| PR-4 | 13 | attachment read/save/delete |
| PR-5 | 6 | request、status、run reconcile/cancel/conflict |
| PR-6 | 0 | Version read/activate、history/current source |
| PR-7 | 0，删除迁移 allowlist | 禁止 import 和调用 |

若实际基线因更早 PR 变化，不能机械修改数字通过门禁；必须重新列出每一个现存调用、
owner 和迁移 PR，并更新本文后汇报。

### 6.3 串行与并行规则

生产实现：

- PR-1 至 PR-7 严格串行建立最终候选和合并；若 §13.6 发现遗漏 owner，必须先插入
  独立前置 PR，再回到 PR-7；
- 后一个 PR 必须从前一个已合并的最新 `origin/main` 创建；
- 不建立七层长期 stacked PR；
- 每个 PR 独立 Draft、独立测试、独立回滚；Ready/合并仍需授权；
- 同一 PR 的 Node、Browser、Electron 测试可在同一 frozen SHA 并行。

可并行的非生产工作：

- PR-1 API 冻结后，可以并行准备 PR-2/PR-4/PR-5 的 fake Bridge fixture、表驱动
  outcome test 和调用链清单；
- 不允许并行修改 `app/workbench.tsx`、Controller public contract、
  `scripts/check-architecture.mjs` 或 `tests/test-impact-map.json`；
- 并行准备物必须在目标 PR 开始时 rebase、重新审计，不能直接视为可合并代码。

## 7. PR-1：Controller 合同、Session 注入与项目登记

### 7.1 背景和目标

建立唯一 Application facade 和测试 seam，先迁移所有 durable action 共同依赖的
项目登记流程。此 PR 不追求 Workbench 大幅缩短；目标是证明 Controller 能在不
复制 Session、不改变行为的情况下拥有一个真实跨 Session command。

### 7.2 事实与根因

关键文件和符号：

- `app/workbench.tsx`
  - module-level `bridgeClient`；
  - `projectSessionRef`、`documentSessionRef`、`commentSessionRef`、
    `draftSessionRef`、`versionSessionRef`、`sourceHistorySessionRef`；
  - `projectRegistrationPromiseRef`；
  - `ensureProjectRegistered`、`prepareProjectRecords`。
- `app/application/project-session.js`：locator/registered identity 和 query fence；
- `app/application/draft-session.js`：durable Draft authority；
- `app/workbench/record-model.ts`、`comment-model.ts`、`version-model.ts`：Bridge record
  到 renderer model 的 pure codec。

根因：registration 是六个 Session 的联合 transition，却由 React callback 和 ref
拥有 single-flight；Application 层没有稳定 command owner。

### 7.3 修改清单

- 新增 `app/application/workspace-controller.js`
  - 接受现有 Session、BridgeClient、codec、Hash/Recovery/Clock Port；
  - 实现 `ensureRegistered()` 和 registration single-flight；
  - command 捕获 epoch/source/hash，校验 Bridge 返回后同步发布
    Project/Document/Version/Draft/History；
  - stale result 返回 `status: "stale"`，不触碰当前 Session；
  - 暂时允许 Workbench 注入同一组 Session，禁止创建第二份 Session。
- 新增 `app/application/workspace-controller.d.ts`
  - 定义 Controller、Snapshot、Outcome、Event、Port 和 migration-only construction
    contract；
  - 不引入 persisted schema 类型变化。
- 新增 `app/application/workspace-controller-codecs.js`
  - 若现有 Workbench codec 不能被 Application 安全 import，则通过注入组合 pure
    codec；不得复制一套不一致 decoder；
  - 若需要移动 codec，保留原 re-export，且同 PR 删除旧 owner。
- 修改 `app/workbench.tsx`
  - 构造 Controller 并注入现有 Session；
  - 删除 `projectRegistrationPromiseRef` 和本地 `ensureProjectRegistered`；
  - `prepareProjectRecords`、autosave/comment/submit 调用 Controller registration；
  - Workbench 继续拥有 presentation state。
- 修改 `scripts/check-architecture.mjs`
  - 建立上述 28 调用的临时精确迁移预算，拒绝任何新增/回流；
  - 拒绝 Controller import React、`app/components`、`desktop` 或 `app/workbench`；
  - registration contract 从 Workbench 字符串检查迁到 Controller 检查。
- 新增 `tests/workspace-controller.test.mjs`
  - fake Bridge 覆盖成功、single-flight、stale epoch、身份不一致、canonical HTML
    Hash 不一致、Draft rebind、无 duplicate Session。
- 修改 `tests/architecture-boundaries.test.mjs`
  - 证明依赖方向和迁移预算。
- 修改 `tests/test-impact-map.json`
  - 新增 `workspace-controller` owner，至少选择 typecheck、Browser smoke、Electron
    smoke 和新 Node tests。
- 新增 `docs/decisions/0019-workspace-controller-orchestration.md`
  - 记录 facade、Session 唯一 owner、无 global store、无 dual-write、分阶段迁移；
  - ADR 0011 保持有效，0019 是其后续而非替代。
- 修改 `docs/ARCHITECTURE_CONTRACT.md`、`docs/STATE_OWNERSHIP.md`
  - 区分 fact owner 与 workflow owner；
  - 标记迁移期与最终态，不能把临时 allowlist 写成永久合同。
- 更新本文状态表，记录 PR head、实际偏差和剩余 Bridge 调用。

### 7.4 边界条件

- lazy project registration 时机不变；打开未登记 HTML 不创建项目记录；
- registration response 必须同时绑定 Project 和 Draft authority；
- canonical source adoption 只允许当前 Document clean 且完整 Hash 校验通过；
- Comment target rebind 语义不变；
- 不修改 Bridge `/project/ensure`、`/workspace`；
- 不让 Controller import Workbench model；只能移动 pure codec 或注入它；
- 不把 Drawer/Toast/焦点放进 Controller。

### 7.5 验收标准

命令：

```bash
node --test \
  tests/workspace-controller.test.mjs \
  tests/project-session.test.mjs \
  tests/draft-session.test.mjs \
  tests/document-session.test.mjs \
  tests/version-session.test.mjs \
  tests/source-history-session.test.mjs
npm run architecture:check
npm run typecheck
npm run test:browser:smoke
npm run task:finish
```

预期：全部通过，无新增 skip/quarantine；Workbench Bridge 调用不超过 28。

关键回归场景：

- 首条 global/local comment 触发 lazy registration，V1 和 Draft 只创建一次；
- 同时触发附件和 autosave，只共享一个 registration Promise；
- registration 返回前切换项目，旧结果不改变新项目；
- Bridge 返回错误 project/document ID 或错误 Hash 时 fail closed；
- 现有已登记项目 DraftSession inactive 时从 workspace 权威恢复，而不是新建身份。

### 7.6 停止条件

- 需要修改 Bridge payload/schema 才能建立 Controller；
- 发现 registration 还依赖未列出的持久 owner；
- 出现第二个 Project/Document/Draft Session 实例或任何临时 dual-write；
- pure codec 不能移动/注入而必须反向 import Workbench；
- Browser 与 Electron 的 lazy-registration 结果不同。

遇到任一项，停止 PR，报告新依赖、替代边界和更新后的拆分，不扩大当前 PR。

### 7.7 未决风险

- 当前 codec 位于 `app/workbench/`，是否可以无行为变化地移动到 Application/pure
  model 需要实现前逐函数确认；
- Controller 初期注入现有 Session 而不是自己构造，可能暴露 migration-only
  access；PR-7 必须删除，不能成为永久 API；
- Session 目前多为单 observer，aggregate snapshot 的最终切换可能需要 PR-7
  调整 observer wiring，但不能在 PR-1 顺手扩成事件框架。

### 7.8 实施记录（2026-08-11）

- `refactor/workspace-controller-registration` 的实现已以
  `main@9f6ad44e2350c18c7a8c2eb741456dd68ef71fe5` 合并。PR-1 不再作为本轮候选；
  后续 PR 仍须独立冻结、Ready 和合并，不能沿用 PR-1 的授权。
- 实际新增 `workspace-controller.js/.d.ts` 和
  `workspace-controller-codecs.js/.d.ts`。Controller 只接收 Workbench 已有的
  Project、Document、Comment、Draft、Version、SourceHistory Session；没有创建
  第二套 owner 或全局 Store。
- `ensureRegistered()` 现在返回显式 `succeeded / blocked / rejected / unknown /
  stale` outcome，持有 single-flight、`epoch + sourcePath + expectedSourceSha256 +
  operationId` 围栏，并在 Bridge 结果仍 current 时同步发布 Session authority。
  当前 source Hash 在等待期间变化也会返回 `stale`，不会写入 Session。
- Workbench 已删除 `projectRegistrationPromiseRef` 和
  `ensureProjectRegistered`，登记调用统一委托 Controller；仅把
  `registration-published` event 映射回 `projectRecordsPath`、`projectName` 等
  presentation state。Controller 在 `useLayoutEffect` 中创建和释放，避免 render
  期间读写 ref；现有 pure codec 保持注入，未反向 import Workbench。
- 直接 Workbench Bridge 调用从 30 降至 28：已移除 registration 的 `workspace`
  和 `ensureProject`。剩余预算已由 architecture gate 精确锁定为 `workspace` 5、
  `source` 6、`versionFile` 3、`resolveConflict` 2，及
  `activateReadyVersion`、`attachment`、`autosave`、`cancelActiveRun`、
  `createRequest`、`deleteAttachment`、`openFolder`、`projectFile`、
  `saveAttachment`、`status` 各 1。
- 未发生计划外 Bridge payload、desktop/IPC、persisted schema、依赖或 UI 变更；
  Canvas invalidation 以窄 Port 注入，保留 canonical source adoption 的现有行为。
- 已通过：PR-1 指定 Node 回归 34/34、`npm run architecture:check`、
  `npm run typecheck`、`npm run gate:edit`，以及 `npm run test:browser:smoke`
  28/28；最终 `npm run task:finish` 通过（60 项定向 Node、28 项 Browser、8 项
  Electron、2 项 AI smoke）。
- 后续：PR-2 已在隔离分支完成，仍未 Ready 或合并；PR-3 至 PR-7 未获授权，不能
  提前实施。

## 8. PR-2：Document 持久化、恢复与 Source History Workflow

### 8.1 背景和目标

把 autosave debounce、pending write reconstruction、single-flight、recovery log、
SourceHistory command 和 source reconciliation 移出 React。`DocumentSession` 继续
拥有 source bytes/revision/write state，`SourceHistorySession` 继续拥有 history
intent；新 `DocumentWorkflow` 只拥有异步编排。

### 8.2 事实与根因

关键符号：

- `flushAutosave`、`enqueueAutosave`、`clearAutosaveTimer`；
- `persistRecoveryLog`、`auditPendingRef`、`auditInFlightKeysRef`；
- `historyActionPromiseRef` 与 Renderer history orchestration；
- `ensureCurrentDocumentCanvas`、`reloadCurrentSource`；
- close 内 `DocumentSession.reconcilePersistedBoundary()` 的 Bridge source callback；
- `bridgeClient.autosave`、`source`、source conflict
  `resolveConflict`。

根因：DocumentSession 已拥有 pending write 和 flush Promise，但创建 Promise、timer、
Bridge command、ack validation、recovery 和跨 Comment/Version rebind 仍在 Workbench。

### 8.3 修改清单

- 新增 `app/application/document-workflow.js`
  - `enqueueEdit`、`flush`、`performHistoryAction`、`reloadAuthority`、
    `reconcileBoundary`；
  - 注入 Scheduler/Hash/Recovery/Canvas Port 和现有 Sessions；
  - 拥有 autosave timer、audit pending/in-flight、history single-flight；
  - 每个 mutation 捕获完整 ProjectContext 和 operation ID；
  - exact acknowledgement、unknown outcome 和 stale result 返回结构化 Outcome。
- 在 `workspace-controller.js` 中组合 DocumentWorkflow；Controller facade 转发命令，
  workflow 不向 Workbench 暴露 Session setter。
- 修改 `app/workbench.tsx`
  - `handleCanvasChange` 只构造 CanvasChangeInput；
  - 删除上述 timer/Promise/recovery refs 和大型 callback；
  - close/switch/submit 通过 Controller flush/reconcile，不自行读 Bridge；
  - 保留 Canvas ref adapter 和 UI 错误呈现。
- 仅在必要时修改 `app/application/document-session.js/.d.ts`
  - 可增加原子 command-oriented 方法，但不得新增第二份 pending/flush authority；
  - 禁止为了方便暴露可任意写 Snapshot 的 generic setter。
- 仅在必要时修改 `app/application/source-history-session.js/.d.ts`
  - 保持 renderer outbox 与 Bridge durable cursor 的现有边界。
- 新增 `tests/document-workflow.test.mjs`
  - fake timer、coalescing、reconstruction、unknown outcome、stale context、ack validation、
    target rebind、history forward/reverse。
- 更新 `tests/test-impact-map.json`、`tests/TEST_STRATEGY.md`、architecture gate 的剩余
  调用预算（不超过 20）。
- 更新本文实际状态。

### 8.4 边界条件

- 700ms debounce 产品语义不变；显式 flush 取消等待并等待同一队列；
- HTML 仍全量提交给现有 `/autosave`，不引入 Patch transport；
- exact content/SHA/revision/source-history acknowledgement 校验不变；
- 外部修改继续进入 conflict，内存内容和 recovery record 保留；
- SourcePatch history 的 forward/inverse/hash chain 不变；
- autosave ack 后 Comment TargetRef rebind 和 Version exactness 失效顺序不变；
- recovery storage 写失败不得把 durable write 伪装成成功或失败；
- 不修改 Bridge SourceTransaction。

### 8.5 验收标准

```bash
node --test \
  tests/document-workflow.test.mjs \
  tests/document-session.test.mjs \
  tests/recovery-store.test.mjs \
  tests/source-history-session.test.mjs \
  tests/source-history.test.mjs \
  tests/audit-events.test.mjs
npm run test:bridge
npm run test:electron:full
npm run architecture:check
npm run typecheck
npm run task:finish
```

预期：全部通过；Workbench Bridge 调用不超过 20；无新增 timer/flush/history Promise
owner 留在 React。

关键回归场景：

- 连续编辑合并为最新 write，较早 ack 不清除较新 pending write；
- 未登记 HTML 首次 autosave 先登记再写入，revision/Hash 不倒退；
- autosave POST 超时后不盲重试，workspace/source reconciliation 确认结果；
- external write 冲突冻结 Canvas，原字节和 recovery 均保留；
- source-history undo/redo 与 HTML 在同一恢复事务中 exact once；
- dirty switch、dirty close、显式 flush 都等待同一 DocumentWorkflow。

### 8.6 停止条件

- 需要改变 `/autosave` schema；
- 无法在不复制 pending write/flush authority 的情况下实现 workflow；
- target rebind 需要把 DOM/React state 引入 Application；
- Electron exact-byte、restart recovery 或 rapid switch/close 任一 oracle 退化；
- 发现性能问题必须通过 Patch transport 才能解决。

最后一项属于另一个条件项目；停止并汇报，不在本 PR 扩大性能范围。

### 8.7 未决风险

- Workbench 的 audit event 与 Comment TargetRef rebind 是 Document ack 的跨域副作用，
  需要明确由 workflow 调用 Session，还是发内部 domain event；实现前不能假设可以
  完全纯化；
- Browser recovery store 的 quota failure 时序需要 fake store 和真实 Browser 双重
  验证；
- 历史 action 与 autosave 共用 source authority，但现有两个 renderer Session 是否
  需要一个更窄的内部 queue，要以测试证明，不能先合并 owner。

### 8.8 实施记录（2026-08-11）

- 隔离分支：`refactor/document-workflow`，基于
  `main@9f6ad44e2350c18c7a8c2eb741456dd68ef71fe5`；本记录时尚未 Ready 或合并。
- 新增 `document-workflow.js/.d.ts` 与纯注入的
  `document-workflow-codecs.js/.d.ts`。Workflow 接收现有 Session 和
  Scheduler/Hash/Recovery/Canvas Port，拥有 700ms autosave、pending/in-flight
  audit、history single-flight、unknown-result authority reconciliation；没有创建第
  二份 Document 或 SourceHistory owner。
- `WorkspaceController` 组合并转发 Document command；Workbench 仅构造
  CanvasChangeInput、保留 Canvas adapter 与 UI event 映射。已删除 React 中的
  autosave timer、recovery/audit/history Promise refs 和对应 Bridge 编排 callback。
- Workbench 的直接 Bridge 调用由 28 收敛至 20；architecture gate 对 20 个调用的
  精确 allowlist 和禁留 timer/flush/history owner 都已锁定。未改变 `/autosave`、
  Bridge SourceTransaction、persisted schema 或 Patch
  transport。
- 新增 Node workflow 回归覆盖 700ms 合并、较早 ack 不覆盖较新 write、未登记首次
  写入、recovery reconstruction、stale race、ack 失配、unknown autosave authority
  reconciliation 与 Renderer history action 的保存失败恢复。
- 已通过 8.5 的指定 Node 集、`npm run test:bridge`、`npm run architecture:check`、
  `npm run typecheck`、`npm run task:finish`（79 Node、28 Browser、8 Electron、2 AI
  smoke），以及 `npm run test:electron:full` 19/19。Draft PR #150 已建立；不进入
  Ready、合并、版本或发布流程。

## 9. PR-3：Project Hydration、Switch、External Open 与 Close

### 9.1 背景和目标

把项目打开、已接收项目 FIFO、hydration、switch fence 和 close readiness 变成
Controller command。主进程 `ProjectOpenQueue` 继续拥有 durable open ordering；
Renderer workflow 只拥有接受结果后的安全 publication。

### 9.2 事实与根因

关键符号：

- `applyProject`、`refreshWorkspace`、`prepareProjectSwitch`；
- `applyAcceptedProject`、`enqueueAcceptedProject`；
- `openProject`、`openExternalProject`、deferred resume；
- `projectHydratingRef`、`projectLoadErrorRef`、`pendingProjectOpenRef`；
- `html-ai:prepare-close`、`html-ai:close-aborted` listeners；
- Workbench effect 中所有 `DrainCoordinator.replace()`；
- `bridgeClient.workspace/source/projectFile/openFolder` 的 project workflow 调用。

根因：Main 已拥有打开顺序，Session 已拥有 FIFO/identity，但最终安全切换和关闭仍由
React effect/callback 拼装，因此宿主事件、业务状态和 presentation 互相引用。

### 9.3 修改清单

- 新增 `app/application/project-workflow.js`
  - 拥有 hydration generation、load outcome、switch operation、accepted-result FIFO
    执行和 deferred resume；
  - 通过 Canvas/ProjectOpen Port 执行 fence、picker/opaque open 和 render verify；
  - 准备完整 candidate 后调用同步 publication transaction；
  - 暴露 `prepareSwitch`、`acceptProject`、`openProject`、`prepareClose`、`abortClose`。
- `WorkspaceController` 拥有唯一 `DrainCoordinator`，各 workflow 登记自己的
  obligation；禁止 Workbench 拼装“是否安全”的布尔组合。
- 修改 `app/workbench.tsx`
  - close event listener 只同步调用 `detail.waitUntil(controller.prepareClose(...))`；
  - external/open UI 只发 command 并呈现 Outcome；
  - 删除 hydration/load/switch/close workflow refs；
  - 保留 file input、Drawer、Toast 等 presentation。
- 仅在需要时修改：
  - `external-file-open-session.js/.d.ts`；
  - `project-application-session.js/.d.ts`；
  - `project-session.js/.d.ts`；
  - `drain-coordinator.js/.d.ts`。
  修改只允许补充 command contract/inspection，不改变现有 FIFO 或 identity owner。
- 新增 `tests/project-workflow.test.mjs`；更新：
  - `tests/external-file-open-session.test.mjs`；
  - `tests/project-application-session.test.mjs`；
  - `tests/drain-coordinator.test.mjs`；
  - `tests/desktop-close-recovery.test.mjs`；
  - impact map、TEST_STRATEGY、architecture budget（不超过 16）。
- Workbench project resource read/open 也通过 Controller query/action，不留 Bridge
  escape hatch。
- 更新本文实际状态。

### 9.4 边界条件

- local picker、recent、external、startup、generated version 和 rename 仍共享主进程
  完整打开队列；
- 外部 request 仍以 opaque ID 交给 renderer，Controller 不获得任意路径 IPC 权限；
- accepted project FIFO 不得被 newer result 删除 predecessor；
- drain 后的最后一次 native edit 必须阻止 publication 并保留 accepted result 重试；
- Project/Document/Version/Canvas generation 同步发布，无 partial state；
- close committed 后不再接受新 external request；abort 只解锁自己的 freeze；
- browser `beforeunload` 仍只是弱 fallback；Electron handshake 是桌面 authority；
- 不修改 `desktop/main.mjs`、preload channel 或主进程 queue。

### 9.5 验收标准

```bash
node --test \
  tests/project-workflow.test.mjs \
  tests/project-session.test.mjs \
  tests/external-file-open-session.test.mjs \
  tests/project-application-session.test.mjs \
  tests/drain-coordinator.test.mjs \
  tests/desktop-close-recovery.test.mjs \
  tests/external-file-open.test.mjs
npm run test:electron:full
npm run architecture:check
npm run typecheck
npm run task:finish
```

预期：全部通过；Workbench Bridge 调用不超过 16；close/switch/hydration 的业务
timer/Promise/ref 不再由 React 拥有。

关键回归场景：

- A 慢读取、B 快读取以及随后在 A 上的新编辑不会产生错序 publication；
- external request 在 close-awaiting 阶段取消正确 close attempt；
- close committed 后 latest path 只由下一启动 claim；
- drain 后新增 native input 使 accepted project 延后，不丢失、不循环重试；
- hydration stuck 但无 mutable evidence 时按现有规则安全关闭；
- project load error、source mismatch、Canvas acknowledgement failure 均保留旧页面。

### 9.6 停止条件

- 需要改变 main/preload IPC 或 ProjectOpenQueue 才能迁移 renderer workflow；
- close listener 无法保持同步 `waitUntil` 注册；
- Controller 需要直接持有 DOM/Event 对象超过 command 生命周期；
- accepted FIFO、external mailbox 或 close one-shot handoff owner 发生变化；
- Project/Document/Version publication 中出现 `await` 或 partial state。

### 9.7 未决风险

- close 是所有 workflow 的联合边界；PR-3 时 Comment/Run/Version workflow 尚未全部
  迁移，需要通过现有 Session/obligation 注入过渡，不能创建第二套 close 判断；
- `ProjectRulesSession` 已自带 Bridge 和 autosave，是否纳入 Controller aggregate
  snapshot 需以最小改动决定；本 PR 不重写它；
- file input 的用户手势和 desktop async dialog 时序不同，Port contract 必须同时覆盖。

### 9.8 实施记录（2026-08-11）

- 隔离分支：`refactor/project-workflow`，基于
  `main@643a472d7cde4818ab4fe3303b7214596ca89f13`；Draft PR #152 已建立，尚未
  Ready 或合并。
- 新增 `project-workflow.js/.d.ts`。`WorkspaceController` 现在拥有唯一
  `DrainCoordinator`，创建窄的 `ExternalFileOpenSession` 与
  `ProjectApplicationSession`，并把既有 Project/Document/Comment/Draft/Run/Version/
  SourceHistory owner、Canvas Port 和 ProjectOpen Port 组合进 workflow；没有创建第
  二份事实 owner。
- Workflow 拥有 hydration generation/load outcome、switch/open operation、accepted
  FIFO 执行与 deferred resume、request-scoped close lifecycle。完整 candidate 的
  Project/Document/Version/Canvas publication 保持同步；Canvas acknowledgement 失败
  时只在当前 generation 上回滚旧权威。
- Workbench 已删除 hydration/load/switch/close workflow refs、startup/external/deferred
  orchestration 和 Drain 组合；桌面 close listener 只同步注册
  `detail.waitUntil(controller.prepareClose(...))`。project resource read/open 也改由
  Controller query/action 执行。
- Workbench 直接 Bridge 调用由 20 收敛并锁定为精确 16 项；未修改
  `desktop/main.mjs`、preload IPC、`ProjectOpenQueue`、external mailbox、persisted
  schema 或 Patch transport。
- 新增 `tests/project-workflow.test.mjs` 并同步 impact map、TEST_STRATEGY、状态所有权
  与 architecture gate。已通过 9.5 的指定 Node 集 42/42、
  `npm run test:electron:full` 19/19、`npm run architecture:check`、
  `npm run typecheck`、`npm run gate:edit -- --base origin/main` 113/113，以及
  `npm run task:finish`（113 Node、28 Browser、8 Electron、2 AI smoke）。PR-4 至
  PR-7 未获授权，本分支不进入 Ready、合并、版本或发布流程。

## 10. PR-4：Comment、Draft 与 Attachment Workflow

### 10.1 背景和目标

把所有会改变 durable Draft 或附件文件的命令移入 `CommentWorkflow`。评论 rail、
焦点、选区、卡片展开等 presentation 保留在 Workbench。

### 10.2 事实与根因

关键符号：

- `handleDraftSessionEvent`、`flushDraftPersistence`；
- `persistDraftRecovery`、`persistCurrentDraftRecovery`；
- `attachmentUploadCountRef`、`uploadAttachments`、`deleteAttachmentFile`、
  `attachmentBlob`；
- `addComment`、`confirmCommentEdit`、`deleteComment`、composer discard；
- Draft Drain obligation；
- `bridgeClient.attachment/saveAttachment/deleteAttachment`。

根因：CommentSession 拥有工作副本，DraftSession 拥有 durable CAS，但 Workbench 仍
决定 snapshot、recovery、attachment compensation 和 stale upload completion。

### 10.3 修改清单

- 新增 `app/application/comment-workflow.js`
  - `commitComment`、`editComment`、`deleteComment`、`queueDraft`、`flushDraft`；
  - `uploadAttachments`、`deleteAttachment`、stale/cancel compensation；
  - 拥有 upload count、draft recovery sequence/operation、DraftSession observer；
  - 所有 async attachment command 捕获完整 ProjectContext 和 comment/edit identity。
- Controller aggregate snapshot 增加 comment/draft persistence projection；
  WorkspaceEvent 返回聚焦/恢复 intent，不直接调用 React ref。
- 修改 `app/workbench.tsx`
  - `File` 选择和 Object URL 生命周期仍在 View/Host adapter；
  - durable comment/attachment 只发 command；
  - 删除 Draft observer、recovery refs、upload count owner 和 Bridge 调用；
  - rail layout、selection、reveal、textarea composition 保持原位。
- 仅在必要时修改 `comment-session.js/.d.ts`、`draft-session.js/.d.ts`，不得合并两者：
  Comment 是 disposable working copy，Draft 是 acknowledged durable authority。
- 新增 `tests/comment-workflow.test.mjs`；更新 comment/draft/attachment tests、impact
  map、TEST_STRATEGY 和 architecture budget（不超过 13）。
- 更新本文实际状态。

### 10.4 边界条件

- 每个 attachment 先复制到项目记录，再进入同一 Comment/Draft；
- 不保存外部原始路径，不把附件 Base64 放入 Draft/Request 文本；
- stale upload completion 必须补偿删除刚写入的项目副本；
- cancel edit 只删除本次新加入附件，不能删除 baseline/frozen attachment；
- commentId、TargetRef、updatedAt、tombstone、Draft revision/CAS 语义不变；
- ambiguous/orphaned target 不自动扩大或静默重绑；
- IME composition 中 Enter 不提交；此 UI 行为仍由 Workbench 控件负责；
- Browser memory attachment 仍不获得 Bridge 权限。

### 10.5 验收标准

```bash
node --test \
  tests/comment-workflow.test.mjs \
  tests/comment-session.test.mjs \
  tests/draft-session.test.mjs \
  tests/attachment-selection.test.mjs \
  tests/attachment-storage.test.mjs \
  tests/drain-coordinator.test.mjs
npm run test:browser:full
npm run test:ai-closed-loop:smoke
npm run architecture:check
npm run typecheck
npm run task:finish
```

预期：全部通过；Workbench Bridge 调用不超过 13；无 durable Draft/attachment
Promise、upload count 或 compensation owner 留在 React。

关键回归场景：

- 首条评论 lazy registration 后只保存一次；
- 多附件部分成功、部分失败时保留成功项并给出原恢复动作；
- 上传期间切项目或关闭 composer，迟到成功被补偿清理；
- Draft revision conflict 自动 authority query/rebase，unknown POST 不盲重试；
- 删除/编辑附件不改变 frozen Request/Version；
- 多个 orphan 评论顺序 relink 后只恢复一次原 submit intent。

### 10.6 停止条件

- 需要改变 Draft、Attachment 或 Request schema；
- File/Object URL 必须成为 durable Application authority；
- 无法区分 baseline attachment 与本次 staged attachment；
- CommentSession 与 DraftSession 被合并为一个双重 owner；
- Browser/Electron 评论行为出现分叉或 TargetRef oracle 退化。

### 10.7 未决风险

- `File`、Blob、Object URL 是浏览器宿主对象；Port 应传标准化 upload input 还是
  延迟读取函数，需要以取消/内存峰值测试决定；
- Comment local edit 与 durable Draft acknowledgement 的 UI 时机需要保持现状，
  不能假设“点击保存”必须等待 Bridge；
- attachment cleanup 失败目前是 warning，是否需要 durable cleanup ledger 不属于
  本计划；若发现实际孤儿文件不可接受，停止并另立存储计划。

### 10.8 实施记录（2026-08-11）

- 隔离分支：`refactor/comment-draft-attachment-workflow`，基于已合并的 PR-3
  `origin/main@043d78f0aff7ac0b8db8966cf08adbcfe925f5b2`。本次交付只创建 Draft
  PR；不进入 Ready、合并、版本或发布流程。
- 新增 `comment-workflow.js/.d.ts` 及其纯 codec。它是 Draft snapshot/recovery、
  DraftSession observer、附件 upload count、完整 ProjectContext + composer/edit
  identity 捕获，以及 stale/cancel cleanup 的唯一应用层 owner；`CommentSession`
  保持 disposable working copy，`DraftSession` 保持 CAS durable authority。
- `WorkspaceController` 组合并投影 CommentWorkflow，`ProjectWorkflow` 的 draft 与
  attachment drain obligation 统一委托它。Workbench 只保留 File/Object URL、焦点和
  Toast 映射，删除 Draft observer/recovery/upload-count owner 及 attachment
  Bridge 调用；直接 Bridge 调用精确收敛至 13。
- 新增/更新 CommentWorkflow、CommentSession、ProjectWorkflow 回归、影响映射、
  测试策略、状态所有权和 architecture contract。覆盖 lazy registration 单次 Draft
  写入、部分附件失败、跨项目迟到上传补偿、取消编辑只清
  staged 附件，以及 unknown Draft POST authority reconciliation。
- 已通过本节指定 Node 集 33/33、`npm run architecture:check`、`npm run typecheck`、
  `npm run test:browser:full` 73/73、`npm run test:ai-closed-loop:smoke` 2/2，及
  `npm run task:finish`（137 targeted Node、28 Browser smoke、8 Electron smoke、
  2 AI smoke）。

## 11. PR-5：Request、Run Polling、取消与冲突 Workflow

### 11.1 背景和目标

把 AI Request 冻结、unknown mutation reconciliation、后台 poll timer、cancel 和
run conflict 处理移入 `RunWorkflow`。`RunSession` 继续拥有每项目 run/handoff/
operation lock；Workbench 只呈现流程和用户意图。

### 11.2 事实与根因

关键符号：

- `generateRequest`、`sendToQoderWork`；
- `processRunStatus`、poll effect、`reconcilePendingRun` effect；
- `cancelActiveRun`、`resolveAiConflict`；
- `runSessionRef.beginSubmission/freeze/uncertain/release`；
- `bridgeClient.createRequest/status/workspace/cancelActiveRun/resolveConflict`；
- Drawer/Toast 与 workflow outcome 混在同一 callback。

根因：RunSession 已拥有状态和 locks，但发送前 freeze/Drain、POST unknown outcome、
poll timer 和 clipboard side effect 仍由 React 编排。

### 11.3 修改清单

- 新增 `app/application/run-workflow.js`
  - `submit`、`reconcileSubmission`、`pollNow/startPolling/stopPolling`、`cancel`、
    `resolveConflict`；
  - 注入 Canvas、Handoff、Scheduler、Hash Port 和现有 Sessions；
  - 保存完整 submission identity 和 stable operation key；
  - Controller `dispose()` 必须清理 timer 并 fence late callbacks；
  - unknown `createRequest` 只查询 workspace authority，不重复 POST。
- 修改 `workspace-controller.js` 暴露 run commands/events；poll 生命周期由 Controller
  snapshot 中 tracked runs 决定，不由 React effect 重挂载决定。
- 修改 `app/workbench.tsx`
  - `generateRequest` 变为薄 command adapter；
  - Drawer、Toast、relink focus、review opening仍是 presentation；
  - 删除 polling/reconcile timer、Run Bridge 调用和 submission orchestration；
  - clipboard Host Port 继续逐字 readback。
- 仅在必要时修改 `run-session.js/.d.ts`，不把 Bridge IO 塞入 RunSession；Session
  继续是纯 in-memory owner，Workflow 负责 IO。
- 新增 `tests/run-workflow.test.mjs`；更新 run/qoder/AI tests、impact map、
  TEST_STRATEGY 和 architecture budget（不超过 6）。
- 更新本文实际状态。

### 11.4 边界条件

- submit 前必须完成 native edit fence、完整 comment/TargetRef 校验、Canvas freeze、
  source+draft Drain 和 persisted SHA/revision 比对；
- freeze 之后、Request 创建之前不得重新开放编辑；
- `createRequest` payload 不包含 renderer HTML/runtime projection；Bridge 从权威源复制；
- unknown POST 保持项目只读，直到 workspace authority 明确存在或不存在 run；
- A 项目 poll/cancel/resolve 不更新 B 项目；单个慢项目不阻塞其他项目；
- clipboard copied 只表示 readback 一致，不表示 QoderWork 已收到；
- cancel 不自动停止外部 Agent；迟到 completion 按现有规则拒绝；
- conflict 的 `adopt-ai`/`keep-external` 语义和 Bridge 路由不变。

### 11.5 验收标准

```bash
node --test \
  tests/run-workflow.test.mjs \
  tests/run-session.test.mjs \
  tests/run-lifecycle.test.mjs \
  tests/qoder-handoff.test.mjs \
  tests/drain-coordinator.test.mjs
npm run test:ai-closed-loop
npm run architecture:check
npm run typecheck
npm run task:finish
```

预期：全部通过；Workbench Bridge 调用不超过 6；Workbench 不含业务 poll interval、
submission reconciliation 或 Run mutation IO。

关键回归场景：

- double-click send 只产生一个 Request；
- Request POST 成功但响应丢失，authority reconcile 后恢复同一 run；
- reconcile 仍未知时保持锁定，不能创建第二个 Request；
- A/B 项目并行 poll，A 慢或失败不覆盖 B；
- clipboard failure 保留 Request 并允许重新复制，不重新提交；
- cancel/restart、missing finalizer、malformed completion、外部冲突保持现有 fail-closed。

### 11.6 停止条件

- 需要修改 Change Request/Attempt schema 或 finalizer 协议；
- 必须改变 clipboard-only 产品边界；
- RunSession 出现第二份全局 `generating/runInProgress/copy state`；
- poll timer 不能被 fake scheduler 确定性测试或 dispose 后仍可写状态；
- AI closed-loop 任一身份、Hash、unknown-outcome oracle 退化。

### 11.7 未决风险

- `generateRequest` 目前还触发 comment relink 和 UI focus；Controller 应返回 recovery
  intent 还是 event，需要保持一次原 submit intent，不能假设简单错误码足够；
- polling 的启动条件由 tracked runs 变化驱动，Controller aggregate subscription 是否
  会产生多余 timer restart 需要 fake scheduler 证明；
- clipboard integration 是宿主 side effect，成功/失败 presentation 与 durable Request
  outcome 必须继续分离。

### 11.8 实际执行状态（2026-08-11）

- 以 `origin/main@a1b8a2a1e91d83c46b925c8ef35bcc8ba3e04967`（PR-4 已合并）建立
  `refactor/request-run-workflow` 隔离分支；未改动 Change Request/Attempt schema、
  finalizer 或 Bridge route。
- 新增 `RunWorkflow`，由 `WorkspaceController` 组合并投影。它在现有
  `RunSession` 事实所有权之上执行 native fence、freeze、Drain、persisted
  SHA/revision 核对、一次 Request POST、unknown POST 的只读 workspace 对账、tracked
  run polling、cancel/conflict 和 handoff confirmation；`RunSession` 仅增加可并存的
  controller subscription，不含 Bridge I/O。
- Workbench 已删除 Request/Run 的 Bridge 调用、poll/reconcile interval 和 run
  mutation orchestration，只保留 Canvas/Handoff host port、intent 和 Drawer/Toast/review
  presentation。直接 Bridge 调用精确降为 6：`source` 2、`versionFile` 3、
  `activateReadyVersion` 1，留待 PR-6。
- 覆盖 double-send、POST response lost/malformed authority reconciliation、authority
  read 暂失败后的锁定恢复、A/B 并行 polling 与 late callback fence、dispose、clipboard
  retry、cancel/conflict scoped identity；同时更新 impact map、TEST_STRATEGY、状态所有权
  和 architecture gate。
- 修复 polling 终态写回时把 `state` 误解码为浏览器全局 `status` 的 P0：`no-change`
  与 `error` 现在保留 canonical terminal state，不会重新显示为 processing。新增 Node
  覆盖终态解锁/可重开及 malformed Request response 的只读 authority reconciliation。
- 最终审查修复 P1：`resolveConflict` 在等待 Bridge 前冻结完整 `ProjectSession`
  context；`keep-external` 的迟到结果不能对切走又重新打开的同项目新 epoch 解锁或
  无确认 reload。后续 Ready 复审同样为 `cancel` 加入该 context/epoch fence；迟到的
  取消结果不能清除、解锁或擦除重新打开项目中新 run 的 handoff。新增两条
  project-generation fence 的 Node 回归覆盖。
- 已通过本节指定 Node 集 40/40、`npm run architecture:check`、`npm run lint`、
  `npm run typecheck` 与 `npm run test:ai-closed-loop` 16/16，以及 `npm run task:finish`
  （138 targeted Node、28 Browser smoke、8 Electron smoke、2 AI smoke）。PR-6 及其
  Version/source migration 未提前实施。

## 12. PR-6：Version Activation、Review Preparation 与 History Navigation

### 12.1 背景和目标

迁移剩余 Version/source Bridge 调用和 navigation operation。Review UI 与 review
document analysis 保留在 Workbench；Application workflow 只准备并校验不可变
Candidate、执行明确 activation 和当前/历史 source publication。

### 12.2 事实与根因

关键符号：

- `openCommittedVersion`、`activateReadyResult`、`reviewReadyResult`；
- `viewHistoryVersion`、`returnToCurrent`；
- `prepareGeneratedSourceTransition`、`commitGeneratedSourceTransition`；
- `navigationOperationRef`、`viewTransitioningRef`；
- `bridgeClient.versionFile/source/activateReadyVersion`；
- `readyReviewSession` 是 presentation review lease，与 Version authority 相邻但不同。

根因：VersionSession 拥有 projection/view state，但 IO validation、rollback、Canvas fence
和 project/document publication 仍在 Workbench。

### 12.3 修改清单

- 新增 `app/application/version-workflow.js`
  - `prepareReviewCandidate`、`activateReadyVersion`、`openCommittedVersion`、
    `viewHistory`、`returnToCurrent`；
  - 拥有 navigation operation/generation 和 rollback snapshot；
  - 校验完整 project/document/request/attempt/version identity、Hash 和时间；
  - 通过 ProjectWorkflow 的同步 publication API 提交 generated transition；
  - Review preparation 只返回 immutable candidate，不产生 activation side effect。
- 修改 Controller facade/snapshot/events；
- 修改 `app/workbench.tsx`
  - review layer 仍拥有 filters/layout/readyReviewSession UI；
  - 通过 review lease/operation identity 调用 Controller；
  - 删除 Version/source Bridge 调用、navigation Promise/ref 和 transition orchestration；
  - 处理 Outcome 映射与 review layer 动画，不写 Version owner。
- 仅在必要时修改 `version-session.js/.d.ts`，保持 immutable Version projection。
- 新增 `tests/version-workflow.test.mjs`；更新 version/history/AI tests、impact map、
  TEST_STRATEGY 和 architecture budget（0）。
- 更新本文实际状态。

### 12.4 边界条件

- `ready-to-open` Candidate 保持 pending；Review 不改变 current source；
- 只有用户明确“确认并打开/接受”才调用 activation；
- Version file、current source、completion record 的 Hash/identity 必须一致；
- protocol violation 仍可保留安全 committed Version，但显示现有 warning；
- background project Version 完成不切换当前 Canvas，只记录结果；
- history 始终只读，不增加历史回写/恢复为当前 route；
- navigation 失败恢复 prior Document + Version view，并重新核对 Canvas；
- Review runtime evidence 已由 ADR 0046 移除；静态 Review 投影仍是 disposable
  presentation，不进入 activation authority。

### 12.5 验收标准

```bash
node --test \
  tests/version-workflow.test.mjs \
  tests/version-session.test.mjs \
  tests/version-history-records.test.mjs \
  tests/run-session.test.mjs
npm run test:ai-closed-loop
npm run test:electron:full
npm run architecture:check
npm run typecheck
npm run task:finish
```

预期：全部通过；Workbench 中 `bridgeClient.*` 为 0；Review/activation/history 所有
identity、Hash、rollback 和 exact Canvas oracle 保持。

关键回归场景：

- Candidate 打开 Review 不激活，关闭 Review 仍保持原 source；
- candidate/current/completion 任一 Hash 或 ID 不一致时拒绝 activation；
- activation 成功后 Project/Document/Version/Canvas 同步发布；
- background result 不抢占当前项目；
- history navigation 失败恢复原 view，成功后历史保持只读；
- return current 重新读取 canonical source 并验证 project/document identity。

### 12.6 停止条件

- 需要改变 Version、Candidate Assessment、Completion 或 activation schema；
- Review UI state 必须成为 durable Version authority；
- navigation rollback 不能恢复完整 prior snapshot；
- publication 需要跨 `await` 暴露 partial state；
- AI closed-loop 或历史只读安全边界退化。

### 12.7 未决风险

- `readyReviewSession` 同时承担 UI overlay lease 和 Canvas fence 证据；实现前必须拆清
  哪些是 presentation、哪些是 activation precondition；
- generated source 可能改变 canonical path，Project/Run rebase 与 Version adoption 的
  同步顺序需以现有 tests 为 oracle；
- review preparation 当前读取 candidate HTML，是否与 PR-5 的 background poll 形成
  cancel race，需要 operation identity test 证明。

### 12.8 实施记录（2026-08-12）

- 实施分支 `refactor/version-activation-history-workflow` 从
  `origin/main@8c4298caad31eec955d741ba21d7749ec12447bf` 开始；本节只实现 PR-6，
  不提前处理 PR-7 的最终 composition 收口。
- 新增 `VersionWorkflow`，由 `WorkspaceController` 组合并投影 navigation/review
  snapshot 与 event。它在明确 activation 之前校验 persisted ready record 的完整
  project/document/request/attempt/version identity、candidate Hash 与时间戳；随后才
  执行 Bridge mutation、同步 Project/Document/Version publication，并以完整
  Document + Version snapshot 回滚失败的 history/current navigation。
- Workbench 已删除 Version/source Bridge 访问、activation/history navigation Promise
  与旧 operation ref。Review 继续保留在 presentation：filters/layout、review lease、
  Canvas review analysis、动画以及 Drawer/Toast 映射；`bridgeClient.*` 直接调用为 0。
- `ProjectWorkflow` 提供窄的 generated-source prepare/commit publication API，
  `VersionSession` 仅增加完整 immutable projection snapshot/restore。
- 新增 Node 覆盖：Review 不激活、late candidate stale fence、activation 的全量
  identity/hash/time fail-closed 校验、background result 不抢占 Canvas、history rollback
  byte oracle，以及 return-current 的 canonical source reread/identity 校验。
- 本地验证已通过：本节指定 Node 集 26/26、`npm run test:ai-closed-loop`、
  `npm run test:electron:full`、`npm run architecture:check`、`npm run typecheck` 和
  impact-map selection contract，以及 `npm run task:finish` 的 8/8 task gate（typecheck、
  lint、167 个 targeted Node、Web/Browser、Desktop/Electron、AI smoke）。现在只可创建
  Draft PR；不 Ready、不合并、不打 tag、不发布。

## 12.9 PR-7a：安全文件重命名 Transition Workflow

### 12.9.1 触发事实与边界

PR-7 审计发现 `commitFileRename` 仍由 Workbench 直接协调 desktop rename、Run source
rebase、Project source transition、Document publication、Document/Comment workflow reset、
recent-list refresh 和 workspace hydration。这是未在 PR-1 至 PR-6 中列出的跨 Session
业务流程，命中 §13.6，不能塞入 PR-7 cleanup。

本 PR 只把该 renderer-side transition 交给现有 `ProjectWorkflow`；desktop
`source-rename` 的 operation journal、IPC capability、Bridge relink、filesystem 操作与
持久 Schema 完全不变。`ProjectOpenPort.renameSource` 是窄的宿主端口，不是 generic
Bridge executor。

### 12.9.2 修改清单

- `ProjectWorkflow.renameSource` 捕获 Project context + expected source Hash，完成 native
  edit checkpoint、唯一 Drain、final Canvas freeze、desktop result validation、lost-response
  active-file reconciliation、late-result fence 与同步 Run/Project/Document publication；
- `WorkspaceController.renameProjectSource` 只暴露该 typed command；
- Workbench 只传递 filename intent 与展示 Outcome，删除 desktop call、operation ID、
  Hash/result 对账和跨 Session mutation；
- 增加 ProjectWorkflow Node 覆盖：成功 publication、丢失响应的 single-flight 对账、
  晚到结果不能重写新项目；更新 owner 文档、测试策略与 impact map。

### 12.9.3 不变量与验收

- desktop rename 成功前不得改变任何 renderer Session；成功后不得 publish partial
  Project/Document/Run tuple；
- 只有 active file 的 expected renamed filename 与 expected Hash 同时匹配，才可把失去的
  desktop response 视为已提交；
- 迟到结果、dispose 或新的 Project context 一律返回 `stale`，不得 rebase 当前项目；
- 不新增 Bridge route、desktop API、schema、UI 或 generic command；
- 必须通过：

```bash
node --test tests/project-workflow.test.mjs tests/source-rename.test.mjs
npm run architecture:check
npm run typecheck
npm run lint
npm run task:finish
```

### 12.9.4 实施记录（2026-08-12）

- 分支 `refactor/project-rename-workflow` 从
  `origin/main@12dcddd93a728144ff789c22df5460b3556618bb` 创建；它是 PR-7 的独立前置
  候选，不修改 PR-7 的最终 Composition/hard-gate 范围。
- 该候选只迁移安全重命名的 renderer operation owner；`PROJECT.md` workflow 仍保留给
  下一独立前置 PR。完成并合并这两个前置 PR 后，PR-7 才从新的 `origin/main` 重建。
- P1 并发复核确认：desktop rename 未决期间的切换/关闭阻断是
  `ProjectWorkflow` 自身的 Drain fact，不依赖异步 React snapshot projection；定向回归覆盖
  pending rename 不能开始新的 project transition。
- 已通过 `npm run gate:edit -- --base origin/main` 和 `npm run task:finish`；最终 task
  evidence 为 `output/test-runs/2026-08-11T19-38-29-482Z-task/results.json`（typecheck、lint、
  171 个 targeted Node、Web build、28 个 Browser smoke、Desktop/Electron 与 AI smoke 全部通过）。

## 12.10 PR-7b：`PROJECT.md` Rules Workflow

### 12.10.1 触发事实与边界

PR-7 审计还发现 `ProjectRulesSession` 自带 `projectFile`/`updateProjectFile` Bridge I/O 和
保存对账，Workbench 则持有 700ms timer、observer、打开/关闭、composition restore 和 legacy
`saveProjectRules` callback，`ProjectWorkflow` 通过该 callback 参与 drain。这是未在 PR-1 至
PR-6 中列出的跨 Session 编排，命中 §13.6，不能作为 PR-7 cleanup 混入。

本 PR 只把 `PROJECT.md` 的 renderer-side read/write、700ms autosave、unknown-write authority
reconciliation、close/switch drain 与窄的 restore presentation port 收进新的
`ProjectRulesWorkflow`。不改变 Bridge route、desktop API、schema、`PROJECT.md` 语义、UI 文案或
IME 交互合同；`ProjectRulesSession` 仍是唯一的 working-copy/composition/save projection owner。

### 12.10.2 修改清单

- 新增 `ProjectRulesWorkflow`：注入 Bridge、Project/Run Session、Scheduler、Clock 和窄的
  presentation port；每次 I/O 捕获 context/generation，单次 authority read 只用于确认未知
  写结果；
- 将 `ProjectRulesSession` 纯化为 editor working copy、generation、composition fence 与
  save acknowledgement projection，不再持有 Bridge、timer 或 Promise；
- `WorkspaceController` 组合 workflow、投影只读 `projectRules` aggregate snapshot，并暴露
  typed open/edit/composition/restore/save/close facade；
- `ProjectWorkflow` 的 `project-rules` obligation 只委托 workflow 的 inspect/drain，项目、
  source rename 和 generated-source transition 使用同一 reset fence；
- Workbench 只订阅 aggregate snapshot、转发 intent，并把 double-rAF/focus 留在 restore
  presentation port；删除 React timer、Session observer/ref 与 legacy callback；
- 增加 deterministic Scheduler、late result、unknown reconciliation、saving-time edit/close、
  stale-transition、Controller aggregate 和 IME restore 回归；同步 owner 文档、architecture
  gate 与 impact map。

### 12.10.3 不变量与验收

- Session context/generation、Project context 或 dispose 任一失效时，迟到 read/write 只能
  返回 `stale`，不得覆盖新项目 working copy；
- 700ms timer 只在规则已读、未锁定、非 composition、非 saving 且 dirty 时存在；锁定、
  close/transition 或 dispose 必须清除它；
- write response 丢失时最多进行一次同 identity `projectFile` authority read，不能盲目重发
  mutation；
- close/switch drain 必须覆盖 save 中继续输入产生的最新 working copy，不能在旧 ack 后丢弃
  新内容；composition 仍阻止保存，显式 restore 先退役原生输入节点；
- Application 不 import React/components/desktop/workbench；Workbench 不重新持有
  `ProjectRulesSession`、Bridge I/O、timer 或独立可写 copy。

```bash
node --test \
  tests/project-rules-session.test.mjs \
  tests/project-rules-workflow.test.mjs \
  tests/project-workflow.test.mjs \
  tests/workspace-controller.test.mjs
npm run architecture:check
npm run typecheck
npm run gate:edit -- --base origin/main
npm run task:finish
```

### 12.10.4 实施记录（2026-08-12）

- 隔离分支 `refactor/project-rules-workflow` 从
  `origin/main@04cd7a283a55fdd9b0fe9d95a0f9d444e106678a` 创建；它只实现本节的独立
  `PROJECT.md` workflow，不进入 PR-7 最终 composition/hard-gate 收口。
- 新增 `ProjectRulesWorkflow`，由 `WorkspaceController` 组合、只读投影和 dispose；
  `ProjectRulesSession` 现只保存 editor fact。保存或 authority read 捕获完整 context/
  generation；unknown write 最多进行一次 authority read；close/switch drain 会继续写入
  save 中到达的最新内容。
- Workbench 已删除 rules Session/observer、700ms React timer、legacy drain callback 与直接
  save owner，仅保留 Controller snapshot、typed intent 和 native textarea retirement adapter。
  未改变 Bridge/desktop/schema/UI contract。
- 新增 Node 回归覆盖 deterministic 700ms、unknown success/failure reconciliation、late
  read/write、save-time edit/close、transition stale fence、RunSession composition、Controller
  aggregate 与 IME restore；architecture gate 也拒绝 rules Session Bridge I/O、Workbench rules
  timer/ref 和 legacy ProjectWorkflow callback。
- 本地验证：`npm run gate:edit -- --base origin/main` 的 183 个 targeted Node 和 typecheck
  通过（evidence `output/test-runs/2026-08-11T20-33-34-713Z-edit/results.json`）；
  最终 `npm run task:finish` 的 typecheck、lint、184 个 targeted Node、Web build、28 Browser
  smoke、8 Electron smoke、2 AI smoke 均通过（evidence
  `output/test-runs/2026-08-11T20-36-48-878Z-task/results.json`）。

## 13. PR-7：最终 Composition 收口、Aggregate Snapshot 与硬门禁

### 13.1 背景和目标

删除迁移期 escape hatch 和遗留 workflow 代码，使架构合同成为机器可执行事实。
此 PR 不再迁移新的业务流程；若此时发现未规划流程，必须停止而不是用 generic
Bridge executor 隐藏它。

### 13.2 事实与根因

前六个 PR 即使已迁移 command，Workbench 仍可能暂时：

- 直接持有部分 Session ref/observer；
- 保留 migration-only construction/access；
- 包含旧 helper、dead callback、effect dependency 和临时 Bridge allowlist；
- architecture check 仍搜索旧 Workbench 函数形状。

如果不完成最后收口，复杂度只是从 active path 变成了兼容债务。

### 13.3 修改清单

- 修改 `workspace-controller.js/.d.ts`
  - 提供最终 runtime factory；
  - Controller 成为 Session observer 的唯一 Application 聚合点；
  - `getSnapshot/subscribe/subscribeEvents/dispose` 合同冻结；
  - 删除 migration-only Session access。
- 修改 `app/workbench.tsx`
  - 删除 Bridge import 和 module-level client；
  - 删除业务 Session mutation、timer、Promise、generation/recovery refs；
  - 只保留 Controller ref、snapshot subscription、host adapter 和 presentation state；
  - 删除 dead helper/effect，不为达到行数目标移动纯 UI。
- 修改 `scripts/check-architecture.mjs`
  - 删除临时 Bridge migration allowlist；
  - 绝对拒绝 `app/workbench.tsx` import/call BridgeClient；
  - Presentation 文件仍不能 import Application；
  - Application controller/workflow 不能 import React、components、desktop、workbench；
  - 将 registration/freeze/request/publication 检查指向新 workflow，而不是旧函数名；
  - 拒绝重新出现本计划删除的 workflow refs/owners。
- 修改 `tests/architecture-boundaries.test.mjs`
  - 加入负例 fixture：View Bridge call、Controller React import、generic Bridge escape、
    duplicate Session owner、missing drain command。
- 更新 `tests/test-impact-map.json`、`tests/TEST_STRATEGY.md`；
- 更新 `docs/ARCHITECTURE.md`、`ARCHITECTURE_CONTRACT.md`、
  `STATE_OWNERSHIP.md`、ADR 0019 和本文为 Implemented；
- 删除所有只服务迁移的 re-export、adapter、allowlist 和 TODO。

### 13.4 边界条件

- 不新增功能、不改可见 UI、不顺手拆 presentation/CSS；
- 不使用 `controller.executeBridge(method, payload)`、`command(name, any)` 等 generic
  escape 绕过 typed command；
- 不把 Session 快照复制成 Controller 可独立写 Store；aggregate 只读派生；
- Controller dispose 后所有 timer、observer、late async result 都失效；
- architecture gate 不得通过硬编码当前行号或无语义的全文字符串存在性伪造证明。

### 13.5 验收标准

```bash
rg -n 'bridgeClient\.|createRuntimeBridgeClient|application/bridge-client' app/workbench.tsx
# 预期：无输出

npm run architecture:check
npm run typecheck
npm run lint
npm run build
npm run test:node:core
npm run test:browser:smoke
npm run test:electron:smoke
npm run test:ai-closed-loop
npm run task:finish
```

预期：全部通过，无新增 skip/quarantine；architecture negative fixtures 全部能检测
对应违规；Workbench 中 Bridge 调用为 0。

最终结构回归：

- 编辑、评论、附件、切换、关闭、发送、poll、Review、activation、history 的正常 UI
  与文案不变；
- 所有 failure/unknown/stale 场景仍落到原恢复入口；
- Controller unit tests 无 React/DOM，Workbench smoke 只验证 adapter/presentation；
- `git diff` 不包含 Bridge/desktop/schema/storage migration；
- 行数、effect 数只报告，不作为通过或失败条件。

### 13.6 停止条件

- Workbench 仍有 Bridge 调用但找不到前六个 workflow owner；
- 删除 migration access 后出现新的跨 Session 编排依赖；
- aggregate snapshot 需要复制或双写 Session fact；
- hard gate 只能靠 generic allowlist 才能通过；
- 任一完整测试暴露行为变化或未列入计划的 owner。

遇到以上情况必须停止，新增一个有独立事实、边界和验收的 PR；不得把它塞入
“cleanup”。

### 13.7 未决风险

- Workbench 仍会因 JSX、评论 rail、Review 和 presentation 保持较大；这不等于
  Controller 迁移失败，也不授权继续拆 UI；
- aggregate snapshot 的渲染频率可能比现有多个 Session observer 更高，需要 React
  profiler/测试确认没有无界 rerender，但本计划不以微优化改变 owner；
- JS + `.d.ts` 仍有类型漂移风险；本 PR 只保证公开 Controller contract 和 unit tests，
  全仓 TS 迁移仍是独立事项。

### 13.8 实施记录（2026-08-12）

- 隔离分支 `refactor/final-composition-hard-gate-pr7` 从
  `origin/main@8fffb0529239b537f25fc0463921325babdf167f` 创建；它在 PR-7a、PR-7b
  已合并后只完成本节最终收口，不提前进入任何后续重构。
- 新增 `createRuntimeWorkspaceController()` 作为唯一生产组合入口：它构造唯一 typed
  Bridge client、共享 `RunSession` 和其余事实 Session，再交给 `WorkspaceController`。
  注入式 Controller construction 仅保留为 Node test seam；Controller 是
  Project/Document/Comment/Run/Version 的唯一 Application aggregate observer，发布冻结
  snapshot/event stream，并在 dispose 时断开 observer。
- Workbench 已删除 Bridge import/module-level client 和业务 Session ref；它只订阅
  Controller aggregate snapshot、调用 typed Controller command，并保留宿主 adapter 与
  presentation state。`DocumentSession` 只向 aggregate 投影
  `hasPendingWrite`/`isFlushing`，不暴露 pending-write payload 或 Promise。
- `ProjectWorkflow` 删除最终 `legacy` adapter，改用窄 `ViewStatePort`/`RecentRunsPort`
  和自身 typed event subscription；硬门禁删除临时 Bridge allowlist，拒绝 View Bridge
  call、Controller React import、generic Bridge escape、duplicate Session owner、missing
  drain command 等负例。未修改 Bridge route、desktop API、持久 schema/storage 或可见 UI。
- 已通过 `npm run architecture:check`、`npm run typecheck`、`npm run lint`、
  `npm run build`、`npm run test:node:core`（550 项）、`npm run test:browser:smoke`
  （28 项）、`npm run test:electron:smoke`（8 项）、`npm run test:ai-closed-loop`
  （16 项），以及 `npm run task:finish`。任务门禁 evidence：
  `output/test-runs/2026-08-12T05-26-49-274Z-task/results.json`（186 项 impact-selected
  Node、28 Browser、8 Electron、2 AI smoke）。下一步仅可创建 Draft PR；不得 Ready、合并、
  打 tag 或发布。

## 14. 全局验收矩阵

| 风险边界 | Node owner | Browser/Electron owner | 必须证明 |
| --- | --- | --- | --- |
| registration | workspace-controller/project/draft tests | first durable comment/open | one identity、stale result fenced |
| autosave/history | document workflow/session/Bridge tests | native Electron edit/undo/close | exact bytes、recovery、no duplicate write |
| switch/close | project workflow/drain/close tests | rapid switch/close | FIFO、final fence、no partial publish |
| comment/attachment | comment/draft/attachment tests | Browser comment + AI smoke | CAS、compensation、TargetRef |
| Request/run | run workflow/session/lifecycle tests | AI closed loop | one Request、unknown reconcile、A/B isolation |
| Version/history | version workflow/session/history tests | AI closed loop + Electron | explicit activation、immutable/history read-only |
| architecture | architecture negative fixtures | build/typecheck | View IO=0、no reverse import、no dual owner |

每个 PR 的 `task:finish` 必须基于当时最新 `origin/main`。任何 rebase、代码修改或
base 更新都会使旧验证失效；最终候选重新冻结后再 Ready 一次。

## 15. 全局停止条件

除各 PR 的停止条件外，任何阶段出现以下情况都必须暂停：

1. 当前源码事实与本文调用链、owner 或测试 owner 不一致；
2. 发现新的 persisted fact、Bridge route、IPC capability 或数据迁移需求；
3. 为完成当前 PR 必须修改下一个 PR 的核心 owner；
4. 需要 temporary dual-write、全局 Store、generic Bridge executor 或第二个 Controller；
5. 需要弱化 Hash/CAS/atomic/recovery/TargetRef/IME/Selection/Version 安全边界；
6. focused test 只能通过删除断言、扩大 timeout、跳过测试或降低 fail-closed 语义；
7. 当前 PR 不能独立回滚，或回滚会留下不兼容持久状态；
8. PR diff 混入 UI 改版、性能协议、打包、依赖升级或无关清理；
9. 基线 `origin/main` 已变化，且变化触及同一 owner/hotspot；
10. 用户没有授权继续实施、Ready、合并或扩大范围。

暂停报告必须包含：

- 发现的新事实和证据文件/符号；
- 与本文哪一条假设冲突；
- 对当前 PR 的影响；
- 建议的重新拆分或替代方案；
- 是否存在安全的原范围继续路径。

## 16. 全局未决风险

以下结论仍是假设，不能当成已证明事实：

- 引入 Controller 后会减少真实用户竞态；当前只能从 owner 分散和调用链复杂度推断，
  需要回归测试与后续缺陷数据验证；
- Workbench Bridge 调用归零一定会显著减少总 LOC；UI/presentation 本身仍可能占大头；
- Controller aggregate snapshot 不会带来额外 render churn；需要实现后的 profiler 或
  受控 render-count test；
- 所有现有 Workbench codec 都可以无损注入或移动；PR-1 前需要逐函数确认；
- 当前 Node 22 测试约束下继续使用 JS + `.d.ts` 是最低风险选择；它仍保留声明漂移
  风险，不能描述为类型问题已解决；
- existing E2E 已覆盖所有 effect 重挂载竞态；新增 workflow 必须补 deterministic
  fake scheduler/late-result tests；
- 30 处 Bridge 调用是完整的 direct-call 基线，但 generic helper、desktop IPC 和
  browser side effect 仍需在每个 PR 重新扫描；
- Controller API 名称和文件数量可以在实现时小幅调整，但 owner、Outcome、Port、
  PR 边界和停止条件不能未经汇报改变。

## 17. 每个实施 PR 的交付模板

每个 PR 描述必须包含：

```text
Outcome:
Boundary:
Baseline head/tree:
Changed owners and files:
Removed Workbench Bridge calls:
Preserved invariants:
Focused verification:
task:finish result:
Known risks/debt:
Documentation impact:
Release impact: none
Rollback: squash/revert only this PR; no persisted migration
```

每个 PR 完成后在本文对应章节补充：实际 head、实际文件、实际测试、与计划偏差、
剩余 Bridge 调用数和下一 PR 是否仍成立。计划偏差必须先审阅再实施，不能事后补写
成“原本如此”。
