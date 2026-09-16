# 结构原地编辑与 Native Edit 目标所有权验收报告

日期：2026-09-15
状态：Draft PR 阶段；未合并、未 Ready、未打包发布

## 结论摘要

本分支修复了长会话中“产品选中的目标”和浏览器实际 `activeElement` 可能分叉的问题，并把结构操作的输出选择（复制后的新元素、删除后的落点、移动后的元素）作为一次明确的目标交接继续传递给评论、格式、保存和下一次编辑。

当前结论不是“全部真实语料通过”：源码级、合成 Electron 和既有定向 Electron 验收已经通过；用户指定的私有 HTML 语料已运行能力预检，但 8 个文件均在 discovery 阶段被 Harness 拒绝，尚未形成可签收的 A/B/C 冻结结果。旧身份前缀的冻结计划也被当前 Stemmio 身份校验以 `FROZEN_IDENTITY_INVALID` 拒绝，因此没有通过替换目标或修改操作顺序来制造通过结果。

这保留了新结构原地路径的 fail-closed 行为：能够证明身份、源码、父节点和宿主关系时才原地执行；新的直接命令若会要求 Candidate，则在宿主接受前拒绝。已接受后的投影失败、历史回放和权威替换继续走既有恢复路径；本次修复没有把回退开关变成用户设置。

## 本次修复范围

- `HtmlCanvasEditor` 在结构操作完成后生成 `operationOutputSelection`：复制选择新副本，删除选择源代码推导出的落点，移动继续绑定移动元素；评论锚点与该选择一起更新，避免原元素和副本共享逻辑身份。
- Native Edit 启动时验证当前 lease、目标元素、`contenteditable`、`activeElement` 和 Selection 是否属于同一目标。旧 session 不再无条件复用；失效时先完成旧 session，无法证明新目标时 fail closed。
- 增加受同一 lease 约束的焦点恢复入口。保存等宿主异步工作结束后只恢复当前 Native Edit 目标；短暂的 iframe/body blur 只在同一 session 仍有效时有限重试，明确的外部焦点仍由用户拥有。
- 删除后的选择不再被无条件清空；Harness 也从删除前冻结源码推导并核验新落点，随后把已核验的落点传给继续编辑步骤。
- 增加一个合成 Electron 回归：复制后不重新点击直接评论、格式化，再删除并不重新点击直接评论删除落点。
- 增加 Save/flush 外部焦点回归：Native Edit 中触发 Cmd/Ctrl+S，在保存未完成时把焦点交给评论输入框，保存完成后输入框仍保持焦点。
- 保留测试专用的 `STEMMIO_DISABLE_STRUCTURAL_IN_PLACE=1` 回退入口，仅供需要 Candidate 生命周期的专用 lane；公开 C 不依赖它，产品没有新增设置或开关。

现有交互契约仍由 `docs/INTERACTION_FLOW.md` 第 5 节负责；本次同步收窄了直接结构命令的用户可见边界。

## 已执行验证

以下命令均在隔离任务 worktree、当前分支源码上执行；报告中的测试不包含私有 HTML 内容、个人路径或运行日志。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `npm ci` | 通过 | 依赖安装完成；npm audit 仍报告 1 个 moderate，未执行破坏性修复 |
| `npm run gate:edit` | 通过 | architecture/typecheck + 465 个 Node 测试全部通过；仅有既有宽度预算 advisory |
| 结构投影/目标重绑定/真实语料契约定向 Node | 通过 | 71/71 |
| `node --check`（变更的 `.mjs`） | 通过 | 无语法错误 |
| `npm run desktop:renderer` | 通过 | Vite renderer build 成功；保留既有大 chunk warning |
| 变更文件定向 ESLint | 通过 | 0 errors；8 warnings，均为既有规则/代码风格提示 |
| 新增合成 Electron 回归 | 通过 | 1 passed；覆盖 copy → direct comment → direct format → delete landing → direct comment |
| Save/flush 外部焦点 Electron 回归 | 通过 | 1 passed；覆盖 Native Edit → Cmd/Ctrl+S 等待 → 评论 textbox → flush 完成后焦点保持 |
| 既有 Electron 定向回归 | 通过 | 覆盖安全复制、删除、同父相邻移动、明确拒绝跨父/复杂操作、Runtime 编辑、Native Edit rebase、Candidate commit failure 等 |
| 收尾门禁第一轮 | 发现并修正测试契约 | `task:finish` 的 74 个 Electron 用例中 72 passed、2 failed；失败都集中在 Candidate handoff 后仍按旧元素断言选择。定向复验这 2 个用例在新提交上 2/2 passed，随后重新执行完整收尾门禁。 |
| 收尾门禁第三轮（最终） | 通过 | `npm run task:finish`：2,412 Node 通过、1 skipped，66 Browser、85 Electron 全部通过；9/9 任务门禁通过，0 failed、0 not executed。 |

关键门禁的机器可读结果位于 worktree 的 `output/test-runs/`（生成目录不提交）。

## 用户指定真实语料预检

本轮使用用户指定的本地 HTML 目录作为语料来源。它是私有输入，不提交到仓库，也不在 PR 中公开文件名和绝对路径。运行的是：

```text
STEMMIO_REAL_HTML_DIR=/path/to/user-designated-corpus \
STEMMIO_REAL_HTML_MODE=capability-preflight-only \
npm run test:real-html:electron
```

本次实际目录包含 8 个 HTML 文件。预检结果为 8/8 `DISCOVERY_ERROR`，失败发生在冻结目标/能力 discovery 阶段，未进入 A 文字、B 结构、C Runtime/iframe、D 元素能力、E 编辑后重建续写的正式验收。因此：

- 不能把这次预检记为真实语料通过；
- 不能把 synthetic Electron 结果冒充私有语料验收；
- 不能用另一个更容易操作的元素替代冻结目标；
- 需要先解决当前 Stemmio 身份迁移后的真实语料导入/目标冻结问题，再从同一原始字节重新生成 B 默认、C 关闭原地路径及必要的 A/D/E 组。

之前遗留的旧身份前缀 H05 长会话计划在当前源码上被正确拒绝为 `FROZEN_IDENTITY_INVALID`。这是保护条件，不是测试失败后换目标的理由。该旧计划没有被改写或提交。

## 门禁失败的纠偏记录

第一轮 `task:finish` 没有被用重复运行来洗绿。两个失败分别是 Candidate handoff 的呈现锚点断言和慢 Runtime 场景的旧元素选择断言；实际产品行为已经把结构操作输出选择交给新副本，正是本次目标所有权修复所要求的契约。测试随后改为等待并断言操作输出的 Stable ID（呈现锚点取新的已选元素，重复副本取最后一个输出节点），没有放宽源码、焦点、结构或连续性校验。新提交上两个失败用例单独 2/2 通过，第二轮又修复了两个连续性用例的测试夹具契约，最终以当前固定源码重新执行完整 `task:finish`：2,412 Node 通过、1 skipped，66 Browser、85 Electron 全部通过。

## 目标所有权回归覆盖

当前已锁住的最小契约如下：

1. 复制后不重新点击，评论和格式操作必须落到新副本；原元素的 Stable ID 和内容保持独立。
2. 删除后不重新点击，评论必须落到源代码推导的新落点，不能继续使用被删除元素的引用。
3. 原元素、副本和删除落点的评论锚点分别解析到各自元素；结构操作输出选择与评论锚点同步。
4. Native Edit 重新进入时必须验证 session lease、目标元素、`activeElement`、`contenteditable` 与 Selection；无法证明时不报告成功。
5. Save/flush 的异步完成只可恢复当前 lease 的 Native Edit 目标，不能把旧 session 的焦点拉回另一个 Stable ID；用户已经主动聚焦的评论输入框、工具栏或侧栏控件保持焦点。
6. C 组专用开关只改变合法操作的结构原地路径选择，不改变目标身份、源码校验、保存和恢复语义；公开 C 不使用该开关。

## 重建比例的报告口径

本分支不把 Candidate 数量或 Runtime handoff 数量命名为“整页重写率”。后续完整真实语料验收需要分别记录：

- Candidate 创建、取消、失败；
- Active 页面交接和真实 Document 替换；
- 复用同一个 Document 对象但发生 `document.open()`/`write()`/`close()` 的整页重写；
- 作者脚本重新激活；
- 局部更新接受、投影失败后的恢复。

同一次交接的多个观测信号只计一次用户画布重建；隐藏 Candidate 失败或 inactive 槽清空不另算一次。普通编辑、复制、删除、同父相邻移动、结构 Undo/Redo 将分别以冻结的“已接受编辑操作”为分母；跨父移动、任意 HTML 插入和复杂直接操作属于拒绝负例，不纳入成功操作分母。必须原地的样本另报意外重建率，非法拒绝和投影失败恢复不能算作“成功避免重建”。

此外，`working` 与 `rendered` hash 一致不能单独证明没有整页重写；验收还要读取实际保存字节、受影响节点文字/样式/结构、原元素与副本身份以及评论锚点。

## 尚未签收的范围

以下项目在真实语料 discovery 修复后必须从新的当前身份冻结计划开始执行：

- 8 文件同语料 B 默认、C 关闭结构原地路径的配对；必要时补 A 旧基线和 D/E 组；
- 原有连续编辑线：文字输入、中文输入法、连续 Enter、外部粘贴、范围格式、结束/自动/手动保存、切换选择；
- 结构与评论交叉线：复制、直接编辑/评论/格式、移动、删除落点、Undo/Redo、保存和重开；
- Candidate 竞争、动态失败、静态回退、双重失败、重试和同字节权威重载；
- 长页面、嵌套滚动、图表、评论栏、缩放和页内标签的阅读位置、工具栏目标、评论锚点、白屏/跳动/失焦与下一次输入；
- 在完整冻结场景通过后，再扩展独立会话及同一长会话 20/50/100 轮，并观察失效引用、历史淘汰、观察器、待处理 Candidate/恢复请求和内存增长。

这些未执行项是当前 Draft PR 的明确限制，不降低本次已经通过的源码和合成回归证据，也不构成最终真实语料签收。

## 隐私与交付边界

PR 只包含源码、测试和本报告；用户 HTML、附件、截图、私有绝对路径、项目记录和生成二进制均留在本机临时目录。此 PR 保持 Draft，不执行 Ready、合并、打包或发布。

## #558 评审修正记录（2026-09-16）

本节独立记录本轮收窄直接编辑能力与重建闭环的修正，不改写上文针对此前提交的历史结果。本节与本轮源码验证绑定的 exact head 为 `c45fc6237390d616ef35e15f3e416829bfb9a737`；门禁在该提交前的同一源码树完成，之后仅更新本段哈希文字。

### 本轮范围与结果

- 复制的完整 Runtime↔Source 子树证明移到当前 Native Edit lease 完成 checkpoint 之后；已知不支持的源码范围仍在收束前拒绝，作者脚本造成的漂移仍拒绝。
- C 场景的同父移动参数改为单个序列化对象，真实公共 A/B/C smoke 已完成 C recovery 全链；另有独立 Electron canary 覆盖同字节 authority reload、重新绑定、续写、保存和重开。
- 删除准入与投影落点共用 `resolveDirectDeleteSelectionLanding`；没有合法后续对象时允许准确删除并清空选择。body 可作为普通子元素的同父移动父级，但 `html/head` 与 body 本身仍不是移动目标。
- 复制、移动、删除共用特殊祖先边界；UI reorder 与结构命令都执行有限 Runtime 子树证明，覆盖运行时生成的 Canvas/表格和 closed Shadow DOM 宿主。
- 删除无消费者的 action/destination 别名与泛用兼容参数；共享源码原语、Native Edit、Undo/Redo、Candidate 恢复和输入优先协调器保留。

### 修正后验证（当前源码树）

| 验证 | 结果 |
| --- | --- |
| `npm run gate:edit` | 通过：2,413 passed、1 skipped、0 failed；保留既有架构预算 advisory |
| 结构策略、投影与真实语料契约 Node 定向测试 | 通过：81/81 |
| 变更 `.mjs` `node --check` | 通过 |
| 变更文件 ESLint | 通过：0 errors；仅既有 warning |
| Electron 立即复制、Enter、composition、动态宿主、null 落点、authority reload | 通过：各定向用例通过 |
| 真实公共 A/B/C opt-in smoke | 通过：A/H99、B/H97、C/H98 全链完成 |
| 私有八文件语料 | 未执行/阻断：仍为 discovery 阶段 `DISCOVERY_ERROR`，没有合成替代或换目标 |

### 消费者与退役口径

| 责任 | 当前 owner | 处置 |
| --- | --- | --- |
| 直接结构准入与有限 Runtime 证明 | `direct-structure-policy.js` + `HtmlCanvasEditor.tsx` | 保留；入口拒绝已知不支持范围 |
| 删除后落点 | `resolveDirectDeleteSelectionLanding` | 保留单一生产事实；策略、投影和输出选择复用 |
| 共享源码物化、历史和恢复 | 既有 SourcePatch/结构命令与统一恢复路径 | 保留；没有新增专用重建分支 |
| C recovery / C authority | 冻结公共 C 的 accepted-projection-failure；独立 authority canary | 分开记录，不把注入失败当作普通闭环前提 |
| 任意 HTML 插入与 action/destination 别名 | 无消费者 | 已删除接线与兼容别名 |

本节不构成私有真实语料签收，也不改变本 PR 的 Draft、未合并、未 Ready、未打包发布状态。

## #558 追加 Node identity 与 authority canary 收口（2026-09-16）

本节追加记录评审评论 `5686070658` 指出的合并前阻断，源码修正绑定提交
`1063b16a`，并已用普通 merge 同步 `origin/main` 的 `9d7e03ce`（同步提交
`0ca8b1c1`）。不改写上节针对前一源码树的历史证据。

- Native Edit 的 rebase 回调现在先在受控 mutation 内为本次 kernel 分配的准确
  `<br>` DOM 对象完成严格 creation-ticket grant，再由
  `IslandEditingController` 克隆 `baselineChildren` 与 `lastValidatedChildren`。
  缺失、断连、代次/执行身份不符或对象集合不完整时返回失败，沿用已接受源码的
  统一恢复路径；静态页不虚构 Runtime 授权，也不再通过新 ID 重新扫描授信。
- 复制、删除、移动的 UI 预判对当前有效 Native Edit lease 拥有的 dirty 草稿采用
  同一暂时放行语义；命令执行仍会先 checkpoint，再进行完整 Runtime↔Source
  proof，作者漂移仍 fail closed。
- 旧的 tab-remount canary 已改名以限定证明范围；新增真实“从磁盘重新载入 HTML”
  的 explicit same-byte authority canary，分别验证新 Document/generation、相同
  Working HTML Hash 和 Stable ID。二者不混写成同一种 authority 入口。

### 本轮定向证据

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck`、结构策略/投影/Runtime grant Node 定向测试 | 通过；25/25 Node 用例 |
| 变更 Electron 用例：Enter checkpoint 后同 ID 作者替身、dirty UI 上移/下移/删除、tab-remount、explicit reload | 通过；4/4 |
| 既有 Electron 回归：立即复制、Enter 立即复制、composition 复制、accepted rebase recovery | 通过；4/4 |
| 私有八文件语料 | 未执行/阻断：仍为 discovery 阶段 `DISCOVERY_ERROR`，没有合成替代或换目标 |

该追加记录不把公共 canary 或定向回归扩大为私有真实语料签收；最终合并仍以最终
exact head 的任务门禁、`release-gate` 和线上 required checks 为准。

## 2026-09-16 收尾：真实语料首错诊断与有限 UI/交接闭环

本节只追加本轮收尾结果，不改写上文历史数字或旧清单。预检使用用户指定的本地
HTML 目录，源代码基线为 `af9cd048185132cc378431e16b994e58eed3bac0`，树为
`556772aa3afa528a6e04c94e7338a9bff922dc6f`。命令为：

```text
STEMMIO_REAL_HTML_DIR=/path/to/user-designated-corpus
STEMMIO_E2E_WINDOW_MODE=hidden
npm run test:real-html:electron -- --preflight
```

### 八文件首错（本次运行）

每行保留首个具体 discovery 阶段、错误码、分类和安全标量前置条件；原始 HTML
文件名、绝对路径、选择器和堆栈不进入报告。后续同类错误最多保留 32 条，避免
用大量重复 probe 淹没首错。

| 文件 | 首错阶段 | 首错代码 | 分类 | 关键前置条件 |
| --- | --- | --- | --- | --- |
| H01 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor | candidates 375；source elements 375；tab known false |
| H02 | `runtime-generated-discovery` | `RUNTIME_GENERATED_PROBE_FAILED` | executor | source elements 161；authored candidates 160；runtime targets 0；tab known false |
| H03 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor | candidates 1029；source elements 1031；tab known false |
| H04 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor | candidates 559；source elements 559；tab known false |
| H05 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor | candidates 302；source elements 302；tab known false |
| H06 | `runtime-generated-discovery` | `RUNTIME_GENERATED_PROBE_FAILED` | executor | source elements 986；authored candidates 973；runtime targets 0；tab known true |
| H07 | `runtime-generated-discovery` | `RUNTIME_GENERATED_PROBE_FAILED` | executor | source elements 246；authored candidates 245；runtime targets 1；tab known false |
| H08 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor | candidates 630；source elements 630；tab known false |

八行均为 `DISCOVERY_ERROR`，不是产品“不支持”结果，也没有在执行中替换为更简单
目标。每行 `originalUnchanged` 和 `preflightWorkingCopy.unchanged` 均为 true；本轮
没有进入 A/B/C 正式操作、重建率或成功率分母。重复只读运行中首个 executor 代码可能
在同一探测边界的 `NO_EXACT_HIT_POINT`、`CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED`
或选择清理类错误之间变化，因此这些代码用于定位 runner 前置条件，不被解释为用户
任务失败率。

### 本轮已完成的有限收尾

- `updateMoveAvailability` 先核对源码资格和相邻方向，确定存在可执行方向后才做
  Runtime 子树证明；命令执行仍保留完整证明。
- 直接结构拒绝提示按“超出直接编辑范围 / 不能跨组或跨位置移动 / 当前页面内容
  发生变化，暂时不能执行”三类呈现，内部 reason code 只用于诊断。
- 显式同字节磁盘 reload 的 Electron canary 已补齐 reload 后真实输入、保存、正常
  关闭、同一项目冷重开及 Stable ID 校验；立即复制、Enter、composition、dirty
  Native Edit 和 accepted rebase recovery 定向用例共 6/6 通过。

### 对照与边界

旧基线 `9d7e03ce01fa1820362799c064232dd04196220e` 的一文件 discovery 预检仍为阻断，
但与本分支各运行了一组两版本都存在的普通 Electron canary（同父重排、长页复制、
源码删除）：旧版 3/3、6.6 s；本分支 3/3、5.9 s。该样本只说明共同支持的代表链
仍可执行，不足以推导可靠性或性能改善，故不宣称新旧版本在任务完成率、响应/保存
延迟、Candidate 数量或意外重建率上有改善；完整三组配对活动待 discovery 根因修复后，
沿用同一语料、冻结身份和独立结果口径再执行。安装态、长会话 20/50/100 轮和八文件
正式结构闭环也仍未执行。

## 2026-09-16 discovery contract 修正：失败状态、完整分母与首个安全 cause

本节只记录针对评审评论 `5686070658` 的 discovery 合同修正，不改写上文已经
绑定的历史结果。实现基于合并后的 #559 提交 `d34bead84785d0f8674cc5fd47a2dc9496de3924`；
本节对应的最终源码以本 PR 的 exact head 为准。

### 合同修正

- Runtime-generated probe 的诊断失败现在同时进入文件级 `DISCOVERY_ERROR` 和
  preflight 非零退出条件；即使没有异常继续向外抛出，也不会留下可签收的
  `PENDING_REVIEW`。
- authored denominator 在任何 bounded probe 之前完成静态 census。首个具体 probe
  错误仍停止后续探测，但 draft 只标记 `PARTIAL_DIAGNOSTIC`，并保留
  `known/examined/probed/unexamined` 与 `stopReason`，不把部分结果当作正式覆盖计划。
- Runtime 首错只保留一个经过白名单过滤的底层 cause（substage、safe code、target
  index/tag、connected、frame generation、hit kind）。`failureBoundary` 描述观察到的
  executor 边界，`rootCause` 在没有独立证据时保持 `UNDETERMINED`；不把八个文件
  宣称为 executor 根因。
- authored-only 页面在探测成功后会发布显式 `runtimeGenerated=false`；没有任何
  Runtime-generated target 是有效的零目标结果，不会被误报为 probe failure。缺失
  selection diagnostic（`null`）仍按探测未完成处理。

### 本次用户指定八文件只读 preflight

命令仍使用用户指定目录，不写回原稿，也不在执行中替换目标：

```text
STEMMIO_REAL_HTML_DIR=/path/to/user-designated-corpus
STEMMIO_E2E_WINDOW_MODE=hidden
npm run test:real-html:electron -- --preflight
```

结果为 `8/8 DISCOVERY_ERROR`、`pendingReview=0`、`environmentBlocked=0`，按新的
preflight 合同退出码为 1；没有进入 A/B/C 正式操作或成功率分母。每行的
`originalUnchanged` 与 `preflightWorkingCopy.unchanged` 均为 true。

| 文件 | 首错阶段 | 首错代码 | 边界 / 根因 | 安全前置条件 | discovery progress |
| --- | --- | --- | --- | --- | --- |
| H01 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor / `UNDETERMINED` | candidates 373；source elements 375；tab known false | 1/373 examined；denominator 102 |
| H02 | `runtime-generated-discovery` | `RUNTIME_GENERATED_PROBE_FAILED`；cause `target-click/RUNTIME_PROBE_TARGET_CLICK_FAILED` | executor / `UNDETERMINED` | source elements 161；authored candidates 160；runtime targets 0；frame generation 3 | 1/160 examined；denominator 147 |
| H03 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor / `UNDETERMINED` | candidates 1029；source elements 1031；tab known false | 1/1029 examined；denominator 1005 |
| H04 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor / `UNDETERMINED` | candidates 559；source elements 559；tab known false | 1/559 examined；denominator 444 |
| H05 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor / `UNDETERMINED` | candidates 302；source elements 302；tab known false | 1/302 examined；denominator 286 |
| H06 | `runtime-generated-discovery` | `RUNTIME_GENERATED_PROBE_FAILED`；cause `target-click/RUNTIME_PROBE_TARGET_CLICK_FAILED` | executor / `UNDETERMINED` | source elements 986；authored candidates 973；runtime targets 0；frame generation 3 | 1/973 examined；denominator 850 |
| H07 | `runtime-generated-discovery` | `RUNTIME_GENERATED_PROBE_FAILED`；cause `target-click/RUNTIME_PROBE_TARGET_CLICK_FAILED` | executor / `UNDETERMINED` | source elements 246；authored candidates 245；runtime targets 1；frame generation 3 | 1/245 examined；denominator 233 |
| H08 | `capability-probe` | `NO_EXACT_HIT_POINT` | executor / `UNDETERMINED` | candidates 630；source elements 630；tab known false | 1/630 examined；denominator 624 |

表中的 `executor` 是失败发生的观测边界，不是对 Harness 或产品根因的归因；下一轮
应继续从这些首错前置条件排查，不得将其改写为“不适用”或通过等待、换目标来规避。

### 本轮验证

| 验证 | 结果 |
| --- | --- |
| 结构策略与 discovery 契约 Node | 66/66 通过；`npm run gate:edit` 汇合 141/141 通过 |
| Runtime-generated Browser discovery | 4/4 通过：Runtime target、authored-only 零目标、不完整诊断、Escape stale |
| 变更文件 `node --check`、ESLint、`git diff --check` | 通过；ESLint 0 errors |
| 用户指定八文件 | 只读 preflight 仍阻断；本轮新增首错 cause 与 progress，不构成真实语料签收 |

本节不宣称安装态、长会话压力、真实 A/B/C 闭环或新旧版本配对收益已经完成；这些
活动必须在 discovery 根因修复并重新冻结当前身份后，沿用独立结果分母再执行。
