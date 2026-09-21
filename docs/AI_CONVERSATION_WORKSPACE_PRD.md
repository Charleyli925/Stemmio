# Stemmio AI 对话与 Agent 工作区产品需求

- 文档版本：PRD v0.2
- 最近更新：2026-08-21（Asia/Shanghai，UTC+8）
- 状态：历史方案；Discussion 产品线已于 2026-08-26 退役
- 适用范围：Stemmio 桌面版单 HTML 项目的评论、预览、Qoder CLI 对话、受管 AI 修改、Candidate 审阅、正式版本晋升与对话历史
- 关联文档：[MVP 产品需求](MVP_PRD.md)、[交互流程](INTERACTION_FLOW.md)、[设计语言](DESIGN_LANGUAGE.md)、[Change Request 协议](CHANGE_REQUEST_PROTOCOL.md)、[版本与项目文件产品需求](VERSION_AND_PROJECT_FILES_PRD.md)、[状态所有权](STATE_OWNERSHIP.md)、[安全模型](SECURITY_MODEL.md)、[ADR 0032](decisions/0032-qoder-acp-agent-bridge.md)

> **当前产品覆盖规则（2026-08-26）：** Qoder 与 Codex 都不再提供新 Discussion Turn。
> AI 侧栏只保留历史 Conversation 可读、Execution 进度、Candidate 决策和基于页面评论的
> “交给 AI 修改”。源页 HTTP Agent（ADR 0069）在侧栏可选模型和思考深度；Qoder 与 Codex
> 仍不提供思考深度控件。本文其余 Discussion、讨论草稿、讨论 Host、讨论路由和讨论并发章节仅作
> 已交付方案的历史记录，不再是实现或验收要求。旧记录中的 `discussion` mode 和 `discuss`
> draft intent 只为无损读取保留，不能成为新的发送能力。

> **当前展示补充（2026-09-22）：** Agent 的公开过程默认折叠为一行最新非空段落预览，空白只做整理，
> 不截断正文；用户可手动展开并在本轮及标签回访时保留选择。typed `result-summary` 与 Stemmio
> 校验、失败、采用事实仍按时间顺序可见。侧栏仅在真实正文被截断时提示省略；复制始终取完整脱敏正文，
> 不包含预览或元数据。临时阅读位置、跟随底部状态和展开状态由打开标签的 Workbench 展示 owner 持有，
> 关闭标签清理，不进入 Conversation 业务记录。当前行为唯一合同见 [交互流程](INTERACTION_FLOW.md)。

本文定义 Stemmio 下一阶段的目标产品规则。它不是对现有 Agent 交付弹窗或处理抽屉的局部换皮，而是把编辑、评论、AI 讨论、受管执行、Candidate 决策与审阅统一为一个围绕真实 HTML 的连续工作流。

本文只定义目标产品与验收合同。实施时必须同步更新协议、Schema、状态所有权、安全模型、测试和 ADR；不能只增加一个聊天侧栏，也不能让 Renderer 或 Qoder 会话绕过现有 Request、Candidate、Version 与 Working Copy 权威。

## 1. 产品结论

Stemmio 只保留两个顶层页面模式：

1. **编辑模式**：用户编辑真实 HTML，并通过右侧空间评论栏创建、修改和删除评论。AI 对话不在编辑模式中显示，Qoder 在此模式没有读取或修改授权。
2. **预览模式**：用户查看只读页面、页面上的“评”标记和右侧 AI 对话；AI 讨论、Qoder 受管执行、Candidate 等待决定与审阅均从这里进入。

核心合同如下：

> 编辑只负责编辑和评论；AI 对话只发生在预览或审阅。普通对话只能读取精确页面上下文，不能修改 HTML。只有用户明确“交给 AI 修改”后，Stemmio 才建立新的冻结 Request，并只授权 Qoder 写入独立 Candidate。当前 HTML 只有在用户明确采用且 Promotion 原子完成后才会切换。

右侧 AI 区采用 Agent 产品的对话结构，但 Stemmio、Qoder CLI 和用户拥有不同的权威：

- 用户表达问题、修改要求和最终决定。
- Qoder CLI 提供可见回复与受管执行进展，但不能声明 Candidate 已验证、已保存或已采用。
- Stemmio 展示冻结、权限、校验、Candidate、冲突、采用和恢复等系统事实，并且是唯一可以宣告“结果已验证”“当前页面已切换”的界面主体。

## 2. 产品设计原则

以下 11 条是本 PRD 的验收前置。任何实现与其中一条冲突，即使功能正确也不接受。多数条目是仓库既有方向的成文化，不是新增要求。

### 2.1 零不必要模态

全产品的模态只允许用于**破坏性确认**。交付准备、执行进度、结果决策、采用授权全部内联在 AI 侧栏。

该原则直接判定现有 Agent 交付弹窗必须删除：它的内容在侧栏里有更好的位置。

### 2.2 一个概念一种视觉

同一件事在不同模式下必须长同一个样。评论标记在编辑模式和 AI 预览里是同一个组件的两种交互态，不是两套视觉。用户切模式时标记不改变外观。

### 2.3 失败就地展开

不新开界面、不叠弹窗、不发 Toast。预期内的失败（未登录、未安装、额度不足、目录为空）在它发生的那个控件里展开，并给出下一步动作。

### 2.4 安静优先，触达变响

静息态使用最少墨水；Hover、键盘聚焦或导航到才加强。适用于评论标记、模型名称、执行阶段和已完成阶段折叠。

### 2.5 不展示用户改不了的东西

不向用户显示他无法选择、无法影响、也不需要理解的参数。该原则判定“思考深度”不出现在界面上：`reasoningEffort` 作为 provenance 记录保留，界面标签不存在。

### 2.6 待决定的行动必须常驻可见

需要用户决定的动作不允许滚出视口。在窄侧栏里，随消息流滚动的操作按钮会在对话变长后消失，用户会得到一个看不见的待决定状态。因此当前可执行的决定属于常驻行动条，不属于消息流。

### 2.7 文案不暴露实现

用户可见文案禁止出现：ACP、Host、manifest、readOrder、SHA、ticket、lease、finalizer、Candidate ID、进程、绝对路径、npm prefix、CLI 版本号、原始错误文本。

### 2.8 进度不制造消息洪水

同一阶段的高频事件在一条消息内原位更新；已完成阶段折叠为一行摘要。错误必须保留发生阶段和可恢复动作。

### 2.9 权威分层在文案上可辨

Qoder 只能说它正在做什么；只有 Stemmio 能说结果已验证、页面已切换。Qoder 消息禁止使用“已保存”“已创建版本”“已采用”。用户必须能分清是谁在说话。

### 2.10 材质与动效统一

AI 侧栏走[设计语言](DESIGN_LANGUAGE.md)已定的材质体系，不发明新材质。侧栏是 docked aside，不使用遮罩、不阻止用户滚动预览。减少动态效果时保留全部状态变化，去掉位移与脉冲动画。

### 2.11 流程步数上限

- 从“我想改”到“AI 开始执行”不超过两次点击（切换意图 → 发送）。
- 从“结果已就绪”到“页面已切换”不超过一次点击（直接采用）。

该上限是“流程顺畅”的唯一可验收形式。任何新增确认步骤都必须先证明它不违反此上限。

## 3. 背景与问题

当前发送流程把同一件事拆成“怎样交给 AI”弹窗、等待处理工作台、已发送 HTML 预览和独立审阅页。状态完整，但用户在最需要观察页面时被带离页面，且交付方式、Agent 进度、Stemmio 校验与版本决定被表现为多套界面。

下一阶段还需要解决以下问题：

1. 编辑态的右侧评论具有空间定位，AI 对话具有时间顺序；二者不能塞进同一个滚动流，也不能切换后让用户误以为评论消失。
2. Qoder CLI 既可以参与只读讨论，也可以执行受管修改；两类会话的文件和工具权限必须明确分离。
3. AI 对话必须回答“这句话针对哪一个项目、哪一份 HTML、哪次 Request、哪份 Candidate”，不能只依赖文件名、路径或当前画布。
4. Qoder 的流式回复、Stemmio 的阶段事实和最终 Candidate 权威必须分层；Agent 说“完成”不等于 Stemmio 已接受结果。
5. 审阅中继续讨论不应自动采用 Candidate；用户要求继续修改时，必须先完成一次明确的采用。
6. 模型通常不止一个。Stemmio 需要提前加载真实可用模型、让用户显式选择，并记录每个 Turn 与 Request 实际使用的模型。
7. 一个项目可以有多个 HTML Document。对话必须跟随 Document，切换 Document 时不能串线，也不能中断另一个 Document 的后台生成。
8. 应用重启、项目切换、HTML 继续编辑、Agent 流式中断和对话过长时，消息与页面身份不能串线或静默丢失。

## 4. 目标与非目标

### 4.1 目标

- 编辑模式继续使用现有真实 HTML 编辑与空间评论体验，不因增加 AI 对话而降低编辑面积或隐藏评论事实。
- 用户点击 AI 入口时，一次完成“提交当前输入 checkpoint → 进入预览 → 展开 AI 对话”，不弹模式说明弹窗。
- AI 预览在评论原 TargetRef 上显示只读“评”标记，复用编辑模式同一个标记组件；Hover 或键盘聚焦后展开只读评论正文。
- 用户可在 AI 预览中与 Qoder 讨论当前页面；讨论对话只能读取精确、只读的页面上下文快照。
- 用户可明确把本轮评论和修改要求交给 Qoder CLI 或复制给外部 Agent。
- Qoder CLI 自动执行时，用户持续看见 Qoder 与 Stemmio 各自负责的流式进展，不离开冻结页面。
- 执行中 Composer 始终可见，允许用户提前写下一条草稿，但不能发送或改变已冻结 Request。
- Candidate 通过校验后仍显示修改前的冻结页面，由 Stemmio 在常驻行动条中询问用户“审阅对比”或“直接采用”。
- 审阅中允许继续和 Qoder 讨论结果；普通讨论不采用、不修改 Candidate。
- 对话、Turn、消息、阶段、模型和页面上下文均具有稳定身份与时间记录，可在项目重开后恢复。
- Conversation 跟随 Document；切换 Document 即切换对话，且互相看不到对方的记录。
- 模型目录在用户进入 AI 前尽可能预加载；模型可由用户显式选择。
- 复制模式保持现有通用任务包和剪贴板安全合同，不伪装成外部 Agent 对话已同步。

### 4.2 非目标

- 不在编辑画布旁同时常驻 AI 对话；AI 对话必须进入预览或审阅。
- 不把 Preview DOM、Agent 对话记忆、Qoder session ID 或流式文本当作 HTML、Request、Candidate 或 Version 权威。
- 不允许讨论模式调用写文件、终端、finalizer、Candidate 发布或 Promotion 能力。
- 不根据自然语言自动猜测用户是在“讨论”还是“继续修改”。
- 不让 Qoder 直接修改当前 Working Copy、历史快照、正式 Version 或冻结 base。
- 不展示或持久化模型隐藏推理、Chain of Thought、原始 stderr、完整终端日志、账号凭证或外部原文件路径。
- 第一阶段不提供思考深度、温度、Top P、上下文窗口或最大输出 token 等参数，界面上也不提示它们存在。
- 不提供 Token 用量、额度余量或成本估算界面；额度问题由用户在 Qoder 侧查看。
- 第一阶段不自动同步复制模式中外部 Agent 的回复。
- 第一阶段不提供多人共享对话、云端同步、消息逐条删除、对话分支合并或跨 Document 对话。
- 不因用户发送普通讨论消息而创建 Request、Candidate 或正式 Version。
- 不允许多个修改 Request 同时争用同一个 Document 的下一正式 Version。

## 5. 产品术语

| 名称 | 用户是否看见 | 定义 |
|---|---:|---|
| 编辑模式 | 是 | 真实 HTML 可编辑；右侧显示空间评论；无 AI 对话与 Agent 权限 |
| AI 预览 | 是 | 当前或冻结 HTML 的只读预览；页面显示“评”标记；右侧显示 AI 对话 |
| 审阅 | 是 | 修改前与 Candidate 的隔离对比；运行时仍属于待决定 Candidate |
| Conversation | 是 | 围绕同一 Document 长期存在的一条 AI 对话线程，可跨多个 HTML Context 与 AI 轮次 |
| Context | 否 | 一组精确页面身份，至少绑定 Working Copy、source SHA 和谱系基础 |
| Turn | 否 | 用户发出一条消息后，Qoder 与 Stemmio 对应产生的一次对话或执行往返 |
| Discussion Turn | 否 | 只读讨论；不创建 Request，不授权修改 |
| Execution Turn | 否 | 用户明确授权后创建冻结 Request，由 Qoder 只写独立 Candidate |
| Stemmio Message | 是 | Stemmio 对冻结、校验、版本、错误和决策等系统事实的可见说明 |
| Qoder Message | 是 | Qoder CLI 的可见文本回复或结构化执行阶段；不拥有结果权威 |
| Request | 可在详情中看见 | 一次已冻结的修改意图、HTML、评论、附件、项目规则、模型与交付配置 |
| Candidate | 是 | Qoder 输出并通过协议校验、尚未采用的完整 HTML |
| Promotion | 是 | 用户明确采用 Candidate 后，原子创建下一正式 Version 与 Working Copy 的动作 |
| 行动条 | 是 | AI 侧栏中常驻显示当前待决定动作的区域，位于消息流与 Composer 之间 |
| Composer | 是 | AI 对话底部的意图开关、上下文摘要、输入、模型选择与发送操作区 |
| Model Catalog | 是 | Bridge 对当前 Qoder 账号真实可用模型的有界、可刷新列表 |
| Discussion Snapshot | 否 | 讨论 Turn 开始时建立的短命只读 HTML 快照，Turn 结束即删除 |

## 6. 顶层页面模式与信息架构

### 6.1 编辑模式

编辑模式保持现有布局：

- 中央画布是可编辑 HTML。
- 右侧是空间评论栏；评论卡继续与 TargetRef 的画布位置对齐。
- 顶部保留“编辑 / 预览”模式切换和 AI 入口。
- AI 对话不常驻、不覆盖评论栏，也不通过页签替换评论栏。
- Qoder 讨论或修改会话即使在后台存在，也不能在编辑画布中获得新页面权限。

用户点击 AI 入口时，Stemmio 必须：

1. 完成当前原生输入 checkpoint；IME、SourcePatch 或映射失败时留在编辑模式并显示就地错误。
2. 进入当前 HTML 的桌面预览。
3. 隐藏空间评论卡，改为在页面 TargetRef 上显示只读“评”标记。
4. 展开右侧 AI 对话。
5. 建立或恢复当前 Document 的 Conversation 与最新 Context。

这五步属于一个连续视觉转换，不弹出“即将进入 AI 模式”说明。

### 6.2 普通预览与 AI 预览

用户只点击顶部“预览”时，可进入普通预览并保持 AI 侧栏收起。用户点击 AI 入口时，预览与 AI 侧栏同时打开。两者读取同一桌面交互预览能力，不创建第三种作者页面运行模式。

普通预览展开 AI 侧栏后即成为 AI 预览；再次点击顶部“AI 助手”收起侧栏，但不退出预览。侧栏内部不再提供第二个“收起”按钮。用户点击“编辑”时退出预览、关闭 AI 侧栏并恢复空间评论栏。

### 6.3 AI 侧栏三层结构

AI 侧栏自上而下是三个固定区域。**消息流承载事实、当前过程和 Stemmio 决定；可变发送交互只放底部 Composer。**

```text
┌ 顶部 ────────────────────────────────┐
│ AI 助手 · 当前阶段                    │
│ 当前文件 · 历史入口                   │
├ 消息流 ──────────────────────────────┤
│  你       把这块结构再简化一些         │
│  Stemmio 已将 index.html 交给 Qoder   │
│           发送了评论、HTML 与项目规则   │
│  Qoder    已读取本轮任务                │
│           正在修改目标区域              │
│           Thinking…                    │
│  Stemmio 版本 5 等待你的决定           │
│           你可以先看变化，也可以直接采用  │
│  [审阅对比]  [直接采用]                │
├ Composer ────────────────────────────┤
│  [Qoder ▾]              [发送/复制]   │
└──────────────────────────────────────┘
```

该结构的产品约束：

- **消息流中的每一条都是终态事实**，不含按钮、不随状态变化重绘、不需要原位更新可交互控件。向上滚动查看历史时看不到任何失效按钮。
- **行动条只在存在待决定动作时出现**，出现时常驻可见，不随消息流滚动。没有待决定动作时行动条不占空间。
- **Composer 承载全部可变交互**：意图开关、本轮上下文摘要、模型选择、输入与发送。
- 侧栏是 docked aside，不使用遮罩、不阻止用户滚动预览。

### 6.4 侧栏尺寸与窄窗口

- 宽屏默认宽度 400px，可在 340–460px 间调整。
- 应用最小窗口宽度为 960px。
- 窗口宽度小于 1200px 时，侧栏默认收起为紧凑入口。
- 窗口宽度小于 1024px 时，侧栏与画布互斥：展开侧栏即让位画布，不允许把两者都挤到不可用宽度。
- 正式实现必须在 960px 最小宽度下验证画布、评论标记、行动条、Composer 和审阅控件均可访问。

### 6.5 消息角色

- **用户**：使用用户头像或稳定的本地默认头像；消息记录用户原文。
- **Qoder CLI**：使用 Qoder 图标；可显示文本回复、Agent 名称/版本和结构化进展。
- **Stemmio**：使用 Stemmio 品牌图标；只显示产品事实、权限、校验、错误和决策。

Qoder 消息不能使用“已保存”“已创建版本”“已采用”等只有 Stemmio 才能确认的文案。Qoder 的“已完成”后必须继续出现 Stemmio 的独立校验阶段。

## 7. 评论在编辑、AI 预览与审阅中的表现

### 7.1 编辑模式

- 已保存评论继续使用空间评论卡。
- 评论可新增、修改、删除和管理附件；异常失联评论只在卡片中说明删除后重新评论。
- 画布标记、评论栏与 Draft 继续读取同一份 CommentSession/Draft 权威。

### 7.2 AI 预览与冻结预览

产品当前已经存在两套评论标记：编辑模式的可点击标记（`<button>`、24px pill、`评N` 计数、可键盘聚焦）与审阅的只读标记（`<span role="note">`、`评`、有 Hover 气泡但**键盘不可达**）。预览模式目前不显示任何评论标记。

该现状违反 2.2。实施时必须抽出**一个共享的只读评论标记与气泡组件**，由预览与审阅共用，并以编辑模式的视觉为规范：

- 尺寸、圆角、配色、白描边、投影与编辑模式一致。
- 同一目标多条评论显示“评N”，沿用编辑模式的计数规则。
- 使用可聚焦元素。Hover **或键盘焦点**进入后展开只读气泡；移出或焦点离开后气泡关闭，“评”继续常驻。审阅现有标记的键盘缺陷在同一改动中修正。
- 评论正文与附件保持只读。
- 只读态下点击标记**不进入编辑、不打开编辑工具栏、不改变选区**。
- 气泡按冻结顺序展示同一目标的多条评论。
- 找不到、歧义或已经脱离文档的目标不伪造左上角标记；对应评论仍在本轮详情中保留。
- 评论正文必须留在可信 React 宿主层，不注入 authored HTML，不暴露完整定位映射给页面脚本。

预览模式的标记位置不需要二次改写 authored HTML。预览本来就通过受管 bootstrap 给每个元素打上源节点标识，因此标记层直接复用这条已有链路：受信主机把评论目标解析成源节点身份，只把标记键与节点身份发进页面，bootstrap 测量视口坐标并回传（滚动与 resize 时按帧节流重测），React 宿主层据此叠加绝对定位标记。

回传的布局必须经白名单过滤：未请求的键、重复的键、非有限坐标一律丢弃，数量也有上限，因此页面脚本不能凭空造出标记或把它移到别处。标记层自身指针透明，只有标记接收指针事件，点击永远能落到被预览的页面上。

全局评论针对整页，没有“页面原位置”可标，因此不在页面上生成标记；它的正文仍在本轮详情中可读。

### 7.3 正式审阅

审阅的主任务是看清 AI 改了哪里。评论标记默认不参与该任务。

- “修改前”和“修改后”页**默认都不显示评论标记**。
- 审阅工具栏提供一个默认关闭的“显示评论”开关；开启后“修改前”页显示与 AI 预览相同的只读评论标记，“修改后”页仍不显示。
- 该默认值保证评论标记不与审阅变化标注争夺视觉层级。
- 评论标记与文字/元素变化框、修订条和上下文遮罩各自独立，不参与变化发现或 Candidate 授权。

## 8. Conversation 与 Document 绑定

### 8.1 绑定规则

Conversation 属于 Document，不属于项目、不属于文件路径。

- 每个 Document 可以拥有多个 Conversation，但任一时刻只有一个当前 Conversation。
- 第一阶段默认自动为 Document 建立一条 Conversation；用户可从历史中新建或切换已归档对话。
- Conversation 不依赖文件路径。文件改名、Stemmio 自己的原子替换或 Working Copy 切换不改变 Conversation 身份。
- 新 Conversation 的标题默认取第一条用户消息的安全、限长摘要；用户可后续重命名。

### 8.2 切换 Document

用户在同一项目内切换 Document 时：

1. AI 侧栏**立即清空**，进入 loading 态。
2. 加载目标 Document 的当前 Conversation。
3. 不允许保留上一个 Document 的消息做视觉过渡。任何时刻界面上的对话必须与当前 Document 一致。

Document A 的 Conversation 中永远看不到 Document B 的任何消息、Turn 或 Context。该隔离由存储布局保证（每个 Conversation 一个目录，Conversation 绑定 `documentId`），不依赖读取时过滤。

### 8.3 后台在飞 Turn

用户在 Document A 有在飞 Turn 时切换到 Document B：

- A 的 Turn **继续生成并继续保存**，不因界面切换被取消或标记失败。
- B 可以独立发起自己的 Turn。
- 用户切回 A 时：
  - Turn 已封存 → 从 Repository 读到完整消息。
  - Turn 未封存 → 从 Bridge 会话取当前累积文本，继续观察流式进展。
- 后台在飞状态在项目面板 / 文档列表中以安静的进行中指示器呈现，复用现有后台运行结果投影。**不使用弹窗、不使用 Toast、不抢焦点。**

### 8.4 并发上限

| 层级 | 上限 |
|---|---|
| 单个 Document | 最多 1 个在飞 Turn |
| 整个应用 | 最多 2 个并发 Qoder 进程 |

超过应用级上限的 Turn **排队**，不拒绝。排队状态在 Composer 内说明“正在等待上一个任务完成”。不向用户显示“任务过多”这类他无法处理的报错。

Execution Turn 本身受“一个 Document 一个活跃 Request”约束，因此并发只可能来自 Discussion Turn。

### 8.5 打开侧栏时的恢复

- 存在当前 Conversation：恢复消息、草稿、模型选择和最后 Context。
- 不存在：建立本地空 Conversation，但不运行 Qoder、不联网、不创建 Request。
- 当前 HTML 与最后 Context Hash 不同：插入新的 Context 分界，不改写旧消息。

## 9. AI 讨论流程

### 9.1 讨论模式

AI 侧栏初始状态在顶部显示：

```text
讨论 · 只读
Qoder 可以阅读当前预览并回答问题，但不能修改 HTML。
```

Composer 的意图开关默认停在“讨论”。

用户发送讨论消息前，Stemmio 必须：

1. 安全持久化用户原文、消息身份、当前 Context 和模型配置。
2. 建立只读 Discussion Turn。
3. 建立 Discussion Snapshot（见 9.2）。
4. 只向 Qoder 提供该快照、允许的评论摘要、项目规则摘要和当前 Conversation 的有界上下文。
5. 不提供写文件、终端、finalizer、Candidate、Request mutation、MCP 或宿主 IPC 权限。
6. 流式展示 Qoder 的可见回复。

若持久化用户消息失败，不得向 Qoder 发送。若 Qoder 在讨论回复中声称已经改过文件，Stemmio 仍只把它当作文本；没有 Request、Candidate 和 completion 就不产生任何产品状态变化。

### 9.2 讨论上下文来源

讨论的页面上下文是**用户当前在左侧看到的那份 HTML**，即 Working Copy 的当前字节。Preview DOM 永不作为来源。

Discussion Host 不得直接读取 Working Copy 路径。Turn 开始时，Stemmio 把这份字节写成一份短命只读快照，放在受管控制目录下，Turn 结束即删除。Discussion Host 的读取范围就是这一个文件。

该设计的产品含义：

- 快照 SHA 就是 Context 的 `sourceSha256`。“Qoder 读的是哪份字节”永远有确定答案。写快照前先核对调用方给出的 Working Copy Hash，不一致即按过期来源失败，不生成快照。
- 外部程序在讨论进行中修改文件，不影响本轮讨论；只影响下一个 Turn 的快照。
- Agent 拿不到任何可写路径、拿不到项目其他文件、拿不到 Working Copy 真实路径。
- 删除是产品不变量而非清理礼节：成功、失败、超时、取消都必须删掉快照；**删除无法确认时按失败处理**（即使该轮回复本身可用），同时把已得到的结果随错误带出，供界面继续展示用户已经看到的内容。

### 9.3 讨论超时

Discussion Turn 使用比 Execution Turn 更短的超时预算（建议 2 分钟）。超时按中断处理：保留已收到文本，标记 interrupted，不伪装完整。

### 9.4 返回编辑

当不存在修改中的 Request 时，用户可以随时点击“编辑”：

- 当前 Discussion Turn 可继续在后台完成，或按用户明确停止；不得因 UI 切换被误记为失败。
- AI 侧栏关闭，空间评论栏恢复。
- 用户随后修改 HTML 时，Conversation 不删除；下次进入 AI 时创建新的 Context 分界。
- 针对旧 Context 迟到完成的 Qoder 回复必须标记“基于上一份页面预览”，不能假装针对新 HTML。

当存在冻结 Request 时，编辑入口真实 disabled；只有结束本轮、拒绝 Candidate 或成功采用后才能恢复编辑。

## 10. 模型目录与模型选择

### 10.1 模型选择是显式的，但不是常驻控件

模型在设置中的 AI 服务面板选择。Composer 底部只显示当前默认 Agent 的静态身份，不提供服务、模型或思考深度选择器。目录只有一个模型时不提供无意义的下拉；切换只影响后续 Turn，不改写冻结 Request 或历史消息。

> **实现现状（2026-08-22 实测校正）**：模型选择**可以实现**，往下的路径是 CLI 参数而不是 ACP 字段。
>
> 实测依据（`@qoder-ai/qodercli@1.1.27`，已登录账号）：
>
> - `qodercli --help` 含 `-m, --model <model>`（“Model for the current session”）——**spawn 时可指定模型**。
> - `qodercli --list-models` 正常返回当前账号可用模型（实测 15 项：Auto / Ultimate / Performance / Efficient / Lite / Qwen3.8-Max / …）。Stemmio 的使用前检查已在调它并解析出有界、经消毒的模型标识。
> - ACP 协议本身确实无模型字段（`session/new` 参数与 schema 均无），也不回报实际使用的模型。**这只否定“通过协议选模型”，不否定“选模型”。**
>
> 因此本节不存在协议级阻塞，只是**尚未实现**。待做项：
>
> 1. 把使用前检查已得到的有界模型列表送到 Renderer——注意 `availability()` 是故意不执行 Qoder 的纯磁盘检查，拿不到模型；模型只在 `preflight()` 结果里。此事会拓宽 `docs/STATE_OWNERSHIP.md` 现有边界（该文档写明 Renderer 不接收 model count），需同 PR 显式修订。
> 2. 把选中模型作为 `--model` 参数给到 Bridge 的 spawn 路径（现在写死 `args = ["--acp"]`），并保持可执行文件身份围栏不变。
> 3. 选择落盘：对话草稿 schema 已支持 `modelId` / `modelDisplayName`；Turn 与消息也已有该字段，可直接记录每轮实际使用的模型。
> 4. “下拉仅在多于一个可选时出现”的展示规则已在侧栏就位（`sidebarModelLine()`），接上真数据即可。
>
> 记录一次误判：本条先前曾被写成“协议阻塞、不实现”，依据只有 ACP schema，**没有跑一次 `qodercli --help`**。结论错误。以后对第三方 CLI 能力的判定必须有实测输出，不得只凭协议推测。

### 10.2 目录状态复用现有可用性模型

模型目录**不引入独立状态机**。它复用 Qoder 可用性投影，只增加一个模型数组。失败态复用已有的 Qoder 可用性卡片，在侧栏内就地展开。

| 目录状态 | 复用可用性状态 | 界面 |
|---|---|---|
| 正在读取 | `checking` | 模型位显示“正在读取模型…”，可读历史、可写草稿，发送不可用 |
| 就绪 | `ready` + `models[]` | 显示当前模型名 |
| 需要登录 | `auth-required` | 发送按钮变为“登录 Qoder 后可发送”，点击就地展开登录指引 |
| 未安装 | `not-installed` | 发送按钮变为“安装 Qoder CLI 后可发送”，点击就地展开安装指引 |
| 暂时不可用 | `unavailable` | 就地说明并提供重新检查 |
| 目录为空 | `unavailable` + 空目录原因 | 明确说明当前账号没有可用模型；复制任务仍可用 |

发送按钮在不可用时**不得只是变灰而不解释**。按钮文案本身必须说明原因，点击后就地展开对应指引。

### 10.3 提前加载

Stemmio 维护进程内模型目录，并把“用户是否已同意本机 Qoder 集成”这一件事持久化。

| 是否落盘 | 内容 | 理由 |
|---|---|---|
| 落盘 | 「用户已同意本机 Qoder 集成」布尔 + 时间戳，存于应用级偏好 | 这是用户的决定，本来就该记住。不是凭证、不是账号、不是模型列表 |
| 不落盘 | 模型列表本身 | 易变的账号事实，每次应用启动重新读取 |

加载顺序：

1. 应用启动后先完成不运行 Qoder 的磁盘发现。
2. 无同意记录时，不在后台启动 CLI 或访问账号；第一次打开 AI 侧栏时通过内联说明取得授权，那一次允许等待并显示进度。
3. 有同意记录时，在 Bridge 就绪和窗口空闲后后台执行一次受控模型目录刷新，使 AI 侧栏首次展开时优先已有结果。
4. 应用重新获得焦点、用户点击“重新检查”、登录状态变化或目录超过 TTL 时刷新。
5. 不得持久化凭证、原始命令输出或账号信息。
6. 每次真正发送 Discussion Turn 或 Execution Request 前，仍要执行有界使用前复核，不能把预加载结果当作永久授权。

预加载不得创建 Request、锁定页面、打开终端、弹出其他应用或自动发送消息。

设置页使用独立 `diagnose`，而不是把正式 preflight 当成状态检查。
diagnose 可以做只读安装、登录或 HTTP 可达性探测，但不创建 ticket、
不建立 Agent session、不修改当前模型。正式发送前仍必须重新
preflight 并把选择冻结到 Request。

### 10.4 默认模型

选择优先级：

1. 当前 Conversation 最近一次成功使用且仍可用的模型。
2. Qoder 明确报告的默认模型。
3. 当前目录第一项。

如果上次模型不再可用，Stemmio 选择新的默认项并在模型名旁显示一次内联说明：

> 上次使用的模型已不可用，请确认当前模型后继续。

在用户确认或主动重新选择前，不发送新的 Turn 或 Request。

### 10.5 思考深度不出现在界面上

Stemmio 不传显式 reasoning-effort 覆盖，由 Qoder 对所选模型使用自己的默认策略。

每个 Turn/Request 记录 `reasoningEffort = qoder-default`，用于解释没有发生 Stemmio 侧覆盖。**该记录不对应任何界面元素。** 界面上不存在“思考深度”标签、说明或控件。不记录也不展示模型隐藏推理内容。

### 10.6 模型记录与执行一致性

- 每条用户消息、Qoder 回复和 Request 都记录用户发送时实际选定的 `modelId`。
- 模型显示名与稳定 ID 分开保存；历史优先显示当时名称，执行只使用当前目录验证后的稳定 ID。
- Execution Request 在冻结时写入模型配置；Request 创建后不得修改模型。
- 使用前复核发现模型消失时，Request 不创建、页面不锁定，用户返回模型选择。
- Qoder 实际报告模型与冻结模型不一致时，本轮失败关闭，不接受 Candidate。

## 11. 交给 AI 修改

### 11.1 一个意图开关贯穿三个状态

Composer 左侧是一个意图开关。它在三种状态下第二项不同，但**始终是同一个控件**，用户只需学习一次。

| 状态 | 意图开关 |
|---|---|
| AI 预览 | `[讨论] [交给 AI 修改]` |
| Candidate 待决定 | `[讨论结果] [继续修改]` |
| 正式审阅 | `[讨论结果] [继续修改]` |

- 普通讨论的发送按钮只产生 Discussion Turn，不能隐式升级为修改权限。
- Stemmio 不分析自然语言猜测意图；只有用户主动切换开关才改变本次发送的性质。

### 11.2 修改意图的上下文摘要在 Composer 内

用户把意图开关切到“交给 AI 修改”后，Composer 上方原位展开本轮上下文摘要。**不插入对话卡、不弹全屏对话框。**

```text
本轮将包含：N 条评论 · 当前 HTML · 项目规则
交付方式  [Qoder CLI ▾]                Qwen3.8-Max
┌────────────────────────────────────────┐
│ 补充说明（可选）…                        │
└────────────────────────────────────────┘
                            [交给 AI 修改]
```

- 评论数、交付方式、模型或准备状态变化时，该摘要自然随状态更新。它是 Composer 的一部分，不是一条需要“原位更新”的消息。
- 交付方式是发送按钮旁的分体选择，默认上次使用过的方式，不强制用户每次二选一。
- 切回“讨论”时摘要收起，输入内容保留。

### 11.3 Qoder CLI 分支

用户以 Qoder CLI 交付后：

1. 执行完整使用前安装、版本、登录、模型目录、模型身份和当前可用性检查。
2. 检查失败时留在 Composer 内就地展开；不冻结、不创建 Request、不锁定页面。
3. 检查成功后提交当前来源 checkpoint，并重新取得最终 HTML、评论、附件、项目规则和模型选择。
4. 取得精确 HTML、source SHA 与 revision 后才锁定当前 Document。
5. 持久化 Request/Attempt/Candidate 身份、交付授权与模型配置。
6. Bridge 使用一次性 ticket 启动受管 Qoder Execution Turn。

模型预加载只改善等待体验，不替代第 1 步使用前检查。

### 11.4 复制任务分支

复制模式继续使用现有 Request/Attempt、Prompt、文件与 finalizer 合同：

- 用户选择复制并发送后才冻结和创建 Request。
- Stemmio 写入剪贴板并逐字 readback；成功只表示剪贴板一致，不代表外部 Agent 已收到或运行。
- 产品不自动打开、控制、粘贴或读取外部 Agent 对话。
- AI 侧栏只记录 Stemmio 的“任务已复制”事实，不生成虚假的 Qoder 回复。
- 外部 Agent 的后续补充仍按受控 supplement helper 记录；Stemmio 不自动同步外部聊天全文。

### 11.5 冻结后的权限分界

Request 成功创建后，Stemmio 在消息流中插入一条不可变权限分界：

```text
Stemmio · 已将“index.html”交给 Qoder
发送了 3 条评论、当前 HTML 和项目规则。
```

顶部状态切换为“处理中”。该状态来自 Request 权威，不由 UI 本地猜测。

## 12. Qoder 执行与流式展示

### 12.1 执行期间画布

- 中央始终显示本轮修改前的冻结 HTML。
- 冻结评论显示“评”标记与只读气泡。
- 不显示低透明遮罩，不跳到全屏等待工作台。
- 编辑入口、评论编辑、项目规则修改和再次提交真实 disabled。
- 用户可滚动、使用允许的预览交互、切换 Document、切换项目、查看历史和导出 HTML 副本。

### 12.2 消息流

Qoder 与 Stemmio 使用各自头像展示。Stemmio 只显示当前可靠阶段，Agent 的公开回复在同一头像和名字下按消息事件逐行排列：

```text
Stemmio   已将“index.html”交给 Qoder
           发送了 3 条评论、当前 HTML 和项目规则
Qoder      已读取本轮任务
           正在修改目标区域
           Thinking…
Stemmio   版本 5 等待你的决定
           你可以先看变化，也可以直接采用
```

同一 Agent 消息的 token 增量合并在原行；新的公开消息事件新增一行，但不重复头像和名字。工具事件和隐藏推理不创建消息。Agent 处理期间显示一行轻量动态 `Thinking`，终态立即移除。过程区域默认折叠为一行最新非空公开段落预览，预览只整理空白并由视觉省略号收尾，不滚动跑马；无公开正文时保留三点且不显示空折叠控件。用户可手动展开或收起，本轮状态更新不能覆盖选择；历史过程也保持轻量折叠并按时间顺序保留事实边界。typed `result-summary` 与 Stemmio 校验、失败、采用事实仍作为正常消息可见，普通 Agent 文本按类型进入过程，不通过关键词猜结果。展开区域与同一消息流共用纵向滚动；复制取完整脱敏正文，不复制预览或元数据，只有真实截断才提示省略。新内容到达时，只有用户仍在底部或刚启动新 Request 才自动跟随；用户上滚、选择文本或展开历史时显示“有新进展”，不抢滚动。侧栏重挂载时按打开标签恢复临时锚点与跟随状态，明确新 Request 才回到底部；错误必须保留发生阶段和可恢复动作。

### 12.3 可见文本流边界

Qoder 的可见文本回复进入消息流。该能力修订 ADR 0032 中“公开状态排除 Agent 原始输出”的子句，必须由一条新 ADR 显式取代，不得静默改写。

新边界：

- 只放行 Agent 明确作为用户可见消息发送的文本块。
- 模型隐藏推理块**一律丢弃**，不落盘、不进内存投影、不进遥测。
- 单条消息与单个 Turn 各有字节上限；超限时截断并标注“部分内容已省略”。事件计数上限不能替代字节上限。
- 仍然排除：stderr、stack、Prompt 原文、绝对路径、账号信息、原始工具结果。
- 结构化工具进展必须经过 allowlist、限长和安全文案映射。

### 12.4 Composer

执行中 Composer 仍显示意图开关、模型名和输入区：

- 模型冻结为本轮模型，不能修改。
- 用户可以输入下一条草稿。
- 草稿实时保存在 Conversation Draft 中，并标明“仅保存草稿，不会发送给当前任务”。
- 发送按钮 disabled，辅助文案为“Qoder 完成本轮后可发送”。
- 草稿不进入当前 Request、Prompt、USER_SUPPLEMENT 或 Candidate。

### 12.5 进度与权威

会话初始化、session update、tool call、文件读写、终端创建、Agent stop 和文本回复都只是展示或诊断事实。只有官方 finalizer 的 completion 与 Repository 校验可以使本轮进入 Candidate 待决定状态。

源页 HTTP Agent 使用 SSE 返回整页 HTML。Bridge 只在内部累积正文，
侧栏只读取已接收字节数；reasoning、usage 和 heartbeat 仅证明连接活动。
HTTP 与 ACP 正式执行均无固定总时长上限；连续 45 分钟无有效协议数据
才是 `AGENT_TURN_TIMEOUT`。断线、取消、超时或 provider error 的半成品
不写 output，不进入 finalizer。

运行失败的行动不再提供更换模型、切换 Agent 或复制给其他 AI。
可重试失败只有“重新发送”与“结束本轮”；重新发送复用该 Request
冻结的页面、评论、provider、模型和配置，不读取之后改动的 Catalog。

额度不足、容量不可用一类失败必须在侧栏出现一条清楚的 Stemmio 消息并给出下一步，不允许静默失败或只留一个无解释的灰按钮。Stemmio 不提供额度余量或成本估算界面。

## 13. Candidate 就绪与 Stemmio 决策

### 13.1 画布保持修改前

Candidate 通过校验后：

- 中央仍显示本轮修改前冻结 HTML。
- 评论标记继续可见。
- Candidate 不自动预览、不自动打开、不自动成为当前 Working Copy。
- 顶部状态变为“结果 · 等待决定”。

### 13.2 消息流留事实，行动条留决定

消息流中只追加一条不可变事实：

```text
Stemmio   候选版本 5 已准备好
```

用户可执行的决定出现在常驻行动条中：

```text
候选版本 5 等待你的决定
你可以先看变化，也可以直接采用。
[审阅对比]  [直接采用]
```

- `ready` Candidate 显示两个操作，默认突出“审阅对比”。
- `attention` Candidate 只显示“审阅对比”，并在行动条内说明变化较大。
- `blocked` 不创建可采用 Candidate；行动条只显示失败原因和恢复动作。
- “直接采用”仍需执行完整 Promotion 验证；按钮不是提前切换页面。
- 决定完成后行动条更新为下一个待决定动作，或在没有待决定动作时消失。消息流同时追加对应的不可变结果事实。

### 13.3 待决定期间的讨论

Candidate 待决定时 Composer 恢复发送能力，意图开关默认停在“讨论结果”。Qoder 只能读取冻结 before 与不可变 Candidate，不能继续写 Candidate、运行 finalizer 或修改当前页面。

普通讨论不改变 Candidate Hash，不视为补充修改要求，也不自动采用。

## 14. 正式审阅

### 14.1 进入审阅

用户点击“审阅对比”后：

- 中央进入现有 before/after 隔离审阅。
- AI 侧栏保持打开，不返回旧处理工作台。
- Conversation、Context、模型与草稿不丢失。
- 两页默认都不显示评论标记；审阅工具栏的“显示评论”开关默认关闭。
- 审阅工具栏继续控制页面、变化类型、目录导航、滚动和缩放；上下文可见度移到“设置 → 常规”，
  变化聚焦与评论聚焦分别保存，默认 25% / 15%。

### 14.2 审阅讨论

审阅中可以继续发送“讨论结果”消息。Discussion Turn 可读取：

- 冻结 before HTML。
- 不可变 Candidate HTML。
- 用户当前审阅定位的变化 ID 和安全摘要。
- 当前 Conversation 的有界上下文。

它不能写 Candidate、当前 HTML、评论、Version 或 review state。Qoder 回复也不能驱动审阅页自动跳转，除非用户点击明确的定位操作。

### 14.3 返回修改前

用户选择“返回 AI 修改前”时：

- 不采用 Candidate。
- 结束当前待决定状态并恢复原 Working Copy 编辑。
- 原评论、附件、本地编辑、Candidate、Conversation 和本轮记录全部保留。
- Conversation 插入 Context 结果分界：“未采用候选版本 5，继续基于修改前页面”。
- 下一次修改必须建立新 Request。

## 15. 采用并继续修改

### 15.1 两步模型

“继续修改”不是一个链式原子事务，而是**两个用户可见动作**：

1. 采用当前 Candidate（Promotion）。
2. 在新页面上发送下一轮修改要求。

用户在 Candidate 待决定或审阅状态把意图开关切到“继续修改”后，Composer 上方原位展开：

```text
需要先采用候选版本 5，才能在它的基础上继续修改。
修改前版本、本轮对话和候选记录都会保留。
                                    [采用并继续]
```

点击“采用并继续”后：

- Stemmio 执行 Promotion。
- 成功后回到新 Working Copy 的 AI 预览，**侧栏保持打开，草稿原文保留**。
- 意图开关自动停在“交给 AI 修改”，用户按一次发送即开始下一轮。

该设计满足 2.11 的步数上限：采用一次点击，发送一次点击。它不引入跨 Promotion 与 Request 的单一原子序列，因此失败恢复退化为两个既有流程各自的失败恢复。

### 15.2 Promotion 顺序

用户点击“采用并继续”后按唯一顺序执行：

1. 持久化用户下一轮原文为 `draft`，不先发送 Qoder。
2. 重新验证 Candidate、项目、Document、Request/Attempt、Hash、外部源状态和 Promotion 可用性。
3. 原子 Promotion Candidate，建立下一正式 Version 与新 Working Copy。
4. 确认编辑画布可从新 Working Copy 安全挂载。
5. Conversation 插入新的 Context 分界，绑定新 Working Copy、Version 和 source SHA。

到此为止本次动作结束。**下一轮 Request 不在本序列内创建**；它由用户随后的发送动作触发，走第 11 节的完整使用前检查与冻结流程。

### 15.3 原位状态变化

同一条 Stemmio 消息原位更新，直到成为终态事实：

```text
正在采用候选版本 5
→ 候选版本 5 已成为当前页面
```

失败时该消息成为一条终态错误事实，行动条提供“重试采用”或“返回审阅”，用户原文、模型选择和 Composer 意图保持不变。不弹出新的工作台，不清空输入。

## 16. Conversation 与消息数据合同

### 16.1 Conversation

每条 Conversation 至少包含：

```json
{
  "schemaVersion": "1.0.0",
  "conversationId": "conversation_<opaque>",
  "projectId": "project_<opaque>",
  "documentId": "document_<opaque>",
  "title": "调整搜索大盘页面",
  "status": "active",
  "createdAt": "2026-08-21T08:00:00.000Z",
  "updatedAt": "2026-08-21T08:15:00.000Z",
  "archivedAt": null,
  "activeContextId": "context_<opaque>",
  "lastSequence": 42
}
```

Conversation 身份不可从标题、路径、文件名、模型 session ID 或第一条消息 Hash 推导。Conversation 归档不删除消息、Context、Request 或 Candidate 关联。

### 16.2 Context

每个 Context 至少包含：

```json
{
  "contextId": "context_<opaque>",
  "conversationId": "conversation_<opaque>",
  "projectId": "project_<opaque>",
  "documentId": "document_<opaque>",
  "workingCopyId": "working_<opaque>",
  "sourceSha256": "<sha256>",
  "basedOnVersionId": "ver_0004",
  "exactVersionId": null,
  "requestId": null,
  "attemptId": null,
  "candidateId": null,
  "side": "working-copy",
  "createdAt": "2026-08-21T08:00:00.000Z"
}
```

`side` 至少支持：

- `working-copy`
- `frozen-base`
- `candidate`
- `review-pair`

Context 只描述消息所针对的页面事实，不授权文件读写。

### 16.3 Message

每条可见消息至少包含：

```json
{
  "schemaVersion": "1.0.0",
  "messageId": "message_<opaque>",
  "conversationId": "conversation_<opaque>",
  "turnId": "turn_<opaque>",
  "sequence": 42,
  "actor": "user",
  "kind": "text",
  "status": "completed",
  "text": "把这里的结构再简化一些",
  "contextId": "context_<opaque>",
  "createdAt": "2026-08-21T08:12:00.000Z",
  "completedAt": "2026-08-21T08:12:00.000Z",
  "parentMessageId": null,
  "modelId": "Qwen3.8-Max",
  "modelDisplayName": "Qwen3.8-Max",
  "reasoningEffort": "qoder-default",
  "requestId": null,
  "attemptId": null,
  "candidateId": null
}
```

**Message 不含任何界面或交互字段。** 没有 `actions`、`buttons`、`cardState`、`disabled` 或等价成员。可执行动作由行动条依据当前产品状态推导，不从消息记录读取。

`actor` 支持：

- `user`
- `qoder`
- `stemmio`

`kind` 至少支持：

- `text`
- `progress`
- `decision-outcome`
- `error`
- `context-boundary`
- `permission-boundary`
- `result-summary`

`status` 至少支持：

- `draft`
- `queued`
- `streaming`
- `completed`
- `interrupted`
- `failed`
- `cancelled`

### 16.4 Turn

Turn 保存：

- `turnId`
- `conversationId`
- `contextId`
- `mode = discussion | execution | review-discussion`
- 用户起始消息
- 模型配置
- Qoder 可见回复身份
- 开始、完成与中断时间
- 关联 Request/Attempt/Candidate（如有）
- 安全终态

Transport session ID 可以作为 Bridge 内部诊断关联，但不能替代 Conversation/Turn 身份，也不能成为恢复或写入授权。

### 16.5 时间与顺序

- 所有持久时间使用 UTC ISO 8601；界面按本地时区显示。
- 同一 Conversation 使用 Repository 分配的严格递增 `sequence`。Repository 是唯一写者，因此递增天然成立，不需要客户端时间排序或分布式协调。
- 流式消息先建立稳定 Message 身份，再在内存中累积受控片段；完成后一次性封存。
- 应用崩溃后未封存消息恢复为 `interrupted`，不得补写成完整回复。
- 消息写入失败时，不得推进发送、Agent 调用或产品状态。

### 16.6 存储布局

Conversation Repository 使用项目受管目录，并沿用仓库既有的持久化模式：单个 JSON 记录、有界数组、`revision` 递增、原子替换。

```text
.stemmio/
  conversations/
    index.json                  原子替换（Document → 对话映射与当前对话指针）
    <conversationId>/
      conversation.json         原子替换（contexts / turns / messages 同处一条记录）
      draft.json                原子替换
```

不使用 jsonl 追加式布局。追加写入的唯一优势是降低频繁追加的成本，而本文已经规定流式片段不落盘、只在 Turn 封存时写一次，写入频率本就极低；改用既有模式可以直接复用已验证的原子写实现，测试形态与其余记录一致，一致性也更容易保证。

约束：

- **Bridge 侧 Conversation Repository 独占写**，Renderer 只读投影。用户可见历史读取 Repository 投影，不扫描目录猜测对话。
- 单写者使得 `sequence` 由记录自身的 `lastSequence` 分配即可严格递增，不需要任何协调。
- `conversation.json`、`index.json` 与 `draft.json` 均为可变记录，遵循保留未知成员的前向兼容约定。
- **流式片段不落盘。** 只在 Turn 封存时写入完整消息；流式中断时一次性写入一条 `interrupted` 记录加已收到文本。`draft`、`queued`、`streaming` 三个状态在写入时被拒绝，因此落盘记录里的每条消息都是终态，崩溃恢复不需要修补半成品。
- 草稿存放在独立的小记录中，防抖的草稿写入不会重写消息历史。
- 对话身份同时是目录名，必须在进入文件系统前通过安全模式校验，构造出的身份不得逃逸受管目录。
- 写入必须原子、身份可验证，并遵守项目根与 Registry 边界。

### 16.7 对话长度上限

- 单个 Conversation 的消息数上限为 500 条，同时设字节上限。
- 触及上限时自动归档当前 Conversation 并新建一条，在新对话首条插入“上一段对话已归档”的可见事实，并提供跳转回看入口。
- 归档不删除任何记录。

### 16.8 Drain 义务

关闭项目、切换项目、切换 Document 和关闭应用前，未封存的 Turn 与未持久化的草稿必须完成 drain。该义务登记进现有 drain 协调者，不新建协调机制。

## 17. Agent 权限合同

### 17.1 权限矩阵

| 状态 | Agent 可读 | Agent 可写 | 终端/finalizer | 当前 HTML |
|---|---|---|---|---|
| 编辑 | 无 | 无 | 无 | 用户可编辑 |
| AI 讨论 | 单文件 Discussion Snapshot | 无 | 无 | 只读预览 |
| Request 执行 | 冻结 Request readOrder | 唯一 Candidate 路径 | 仅固定 finalizer | 保持冻结前内容 |
| Candidate 待决定 | before + Candidate 只读 | 无 | 无 | 保持冻结前内容 |
| 审阅讨论 | before + Candidate + 安全审阅定位 | 无 | 无 | 不切换 |
| Promotion | 无 Agent 权限 | Repository 原子事务 | 无 | 成功后切换 |
| 下一轮执行 | 新冻结 Request | 新 Candidate | 新固定 finalizer | 新基线保持不变 |

### 17.2 Discussion Host

讨论模式必须使用与修改 Host 分离的受限能力。它**不是** Execution Host 换一个读取列表，而是一个独立的、显著更小的策略：

| 维度 | Execution Host | Discussion Host |
|---|---|---|
| 策略来源 | 冻结 Request 权威（request.json + runtime-state 校验） | 单个 Discussion Snapshot；不要求也不读取任何 Request 或 runtime 记录 |
| 读取范围 | manifest 的精确 6 项 readOrder | 一个只读快照文件 |
| 写路径 | 唯一 Candidate 路径 | 无 |
| finalizer | 固定 Node finalizer | 无 |
| 终端 | 仅 finalizer 命令 | 无 |
| 其他 | — | 无通用路径读取、无 MCP、无导航、无系统自动化、无剪贴板、无宿主 IPC、无 Request/Candidate/Version/Promotion mutation |

两者复用同一批文件安全校验（禁符号链接祖先、正规文件校验、身份比对），但能力集合在 Bridge 与工具 Schema 层真实不同，不靠 Prompt 文案区分。

两者也复用同一个 ACP 驱动，但驱动**按带品牌策略的 `mode` 分派**：Host、向 Agent 声明的客户端能力（讨论模式为 `writeTextFile:false`、`terminal:false`）、以及是否要求 Turn 完成证据，全部由策略决定，调用方不能注入 Host。因此“执行策略配讨论 Host”或反向组合在结构上不可能出现。执行模式的 `assertTurnCompleted()` 是**强制调用**，不是可选调用：一旦该方法缺失或改名，Turn 直接失败，而不是静默跳过 finalizer 证据。讨论模式显式声明“不要求完成证据”，其 Turn 结果里没有 completion。

Discussion Snapshot 由 Stemmio 在 Turn 开始时建立、Turn 结束时删除。Agent 不知道也不能推导 Working Copy 的真实路径。

### 17.3 Execution Host

继续遵守 ADR 0032：

- 只读冻结 manifest 的精确 readOrder。
- 只写唯一 Candidate 路径。
- 只调用固定 finalizer。
- 不获得当前 Working Copy、历史快照、任意 shell 或其他项目权限。
- Agent stop、文本完成或工具返回都不创建 Candidate 权威。

### 17.4 Review Host

审阅讨论 Host 只读 before/Candidate pair 和用户明确的审阅定位摘要。它不能写任一 HTML，不能改变审阅 reducer 状态，也不能把一句“继续修改”直接解释为授权。真正继续修改必须经过第 15 节的显式意图开关和 Promotion 顺序。

### 17.5 并发不变量

以下三条是显式不变量，不从锁定矩阵倒推：

1. 一个 Conversation 同时最多一个在飞 Turn。
2. 一个 Document 同时最多一个在飞 Turn。
3. 整个应用同时最多两个 Qoder 进程；超出的 Turn 排队而不拒绝。

Execution Turn 另受“一个 Document 一个活跃 Request”约束。执行进行中不接受同一 Document 的讨论发送。

### 17.6 与既有 runtime-state 的边界

以下是既有平台事实，本设计必须遵守，不得在其上另建：

- **`activeRequest` 是 runtime-state 里的必填单槽，一个项目对应一个文档，因此“一个项目一个活跃 Request”与上面的“一个 Document 一个活跃 Request”是同一条约束。** Execution Turn 复用这条既有单槽 Request 路径；Conversation 绝不把自己建成一个常驻会话去占用该槽，否则会与既有 AI 执行流相撞。Discussion Turn 不创建 Request、不触碰 `activeRequest`，因此讨论并发只受第 17.5 条的进程上限约束。
- **v4 的 source-history journal 没有生产写入者，是空的。** Conversation 持久化不复用它，也不在其上叠加，而是使用第 16.6 节自己的记录。
- **可变记录保留未知成员，写回顺序固定为 `{...read, ...authoritative}`。** Conversation 的可变记录（`conversation.json`、`index.json`、`draft.json`）遵循该约定：加字段无需 bump schema、无需迁移；已知成员严格校验、权威值优先，未知成员从读取结果原样保留。不可变的追加型消息记录仍严格校验。

### 17.7 记录归属（provenance）

平台已提供写入方盖章的记录归属：`provenance = { actor: { kind: "human" | "agent", id }, device }`，由写入方盖章，不接受调用方传入，且已落在 Draft 的 comments/changeEvents 上。

- Execution Turn 冻结时写入的评论与编辑事件属于 Draft 记录，因此自动带上 provenance；`agent` 类型可用来区分是哪一回合、哪个 Agent 产生的补充。Conversation 不重复盖章，读取即可。
- Conversation 消息自身的 `actor`（`user` / `qoder` / `stemmio`）是产品层“谁在说话”的概念，与 provenance 的归属概念相关但不等同：`user` 对应 `human`，`qoder` 对应 `agent`，而 `stemmio` 是产品自身的系统事实，没有 provenance 对应项。因此不把 provenance 结构强塞进每条消息，只在冻结进 Draft 的记录上沿用平台已有的盖章。

## 18. 状态机与锁定矩阵

### 18.1 产品状态机

```text
editing
  ↔ preview-discussion
  → preparing-delivery
  → submitting
  → processing
  → validating
  → committing
  → ready-to-open
  ↔ review-view
  → promoting
  → editing(new working copy)
  → preview-discussion(new working copy)

ready-to-open / review-view
  → decline
  → editing(original working copy)
```

`preview-discussion` 是页面/对话展示状态，不是第三种作者编辑模式，也不写入现有 AI runtime-state。`review-view` 仍是 `ready-to-open` 上的视图状态，不创建第二个 Candidate 状态。

“采用并继续”走 `promoting → preview-discussion(new working copy)`，随后由用户发送触发新一轮 `preparing-delivery`。不存在从 `promoting` 直接进入 `processing` 的转移。

### 18.2 锁定矩阵

| 状态 | 编辑 HTML | 修改评论 | 发送讨论 | 写 Composer 草稿 | 创建修改 Request | 切换 Document/项目 |
|---|---:|---:|---:|---:|---:|---:|
| editing | 是 | 是 | 否 | 保留已有 | 否 | 是 |
| preview-discussion | 否；可返回编辑 | 否 | 是 | 是 | 是 | 是 |
| preparing-delivery | 否；冻结前可取消 | 否 | 否 | 是 | 正在准备 | 是 |
| processing | 否 | 否 | 否 | 是 | 否 | 是 |
| validating/committing | 否 | 否 | 否 | 是 | 否 | 是 |
| ready-to-open | 否 | 否 | 是 | 是 | 需先采用 | 是 |
| review-view | 否 | 否 | 是 | 是 | 需先采用 | 是 |
| promoting | 否 | 否 | 否 | 是 | 否 | 是 |

讨论 Agent 可在用户返回编辑后于后台完成旧 Context 回复，但不能获得用户随后编辑出的新内容；修改 Request 的 Qoder 会话不允许返回当前 Document 编辑。

## 19. 历史与项目关联

### 19.1 Conversation 历史

- 项目历史提供“AI 对话”入口，按 Document 分组，组内按 Conversation 更新时间排序。
- 每条 Conversation 显示标题、最后消息时间、最后模型、关联 Version/Request 数量和当前/归档状态。
- 对话详情按 Context 分界展示页面变化，不把所有消息错误归到当前 HTML。
- 用户可以新建 Conversation；旧 Conversation 归档但不删除。

### 19.2 Version 关联

正式 AI Version 详情增加：

- `conversationId`
- 产生该 Version 的 `turnId`
- `requestId / attemptId / candidateId`
- 模型与 `qoder-default` 思考深度记录
- 用户原始修改要求
- Qoder 可见完成摘要
- Stemmio 校验与采用结果

Version manifest 保持不可变；历史通过稳定身份读取 Conversation 投影。Conversation 标题、后续讨论或归档状态变化不能改写 Version manifest。

### 19.3 拒绝与 no-change

- 拒绝 Candidate：Conversation 保留该轮 Qoder 回复、Stemmio 校验、拒绝决定和 Candidate 关联。
- no-change：不创建新 Version；Conversation 记录“未识别到明确的页面变化”。
- error：Conversation 记录安全错误摘要和恢复结果，不持久化原始 stderr 或敏感诊断。
- cancelled：记录是谁、何时、在哪个 Context 结束；不暗示外部 Agent 已停止。

## 20. 异常与恢复

### 20.1 模型目录

- 目录加载慢：模型位保持读取中，用户可阅读历史和输入草稿，不能发送。
- 登录失效：显示需要登录，发送按钮说明原因并可就地展开指引；已保存草稿和模型历史不丢。
- 模型消失：不得静默使用另一个模型；要求用户确认新选择。
- 刷新返回空目录：不创建 Qoder Turn/Request，复制任务仍可用。
- 预加载目录与发送时目录不一致：以发送时复核为准，并在 Composer 内说明变化。

### 20.2 流式回复

- 网络或 Agent 中断：当前 Qoder Message 标记 interrupted，已收到文本可保留但不得伪装完整。
- 讨论超时：按中断处理，保留已收到文本。
- 应用关闭：Discussion Turn 可有界取消；Execution Turn 必须遵守受管进程清理和退出 fence。
- 重启后无法恢复 Qoder transport session：Conversation 恢复，旧 Turn 标记 interrupted；不猜测继续。
- 重复事件：按 Turn/Message identity 去重，不能生成重复气泡或阶段。
- 高频事件超预算：压缩为阶段摘要并标记“部分技术进展已收起”，不影响 Candidate 权威。
- 文本流超字节预算：截断并标注“部分内容已省略”，不丢弃整条消息。

### 20.3 页面上下文变化

- 用户从 AI 预览返回编辑并修改 HTML：建立新 Context；旧消息不改写。
- Qoder 对旧 Context 的回复迟到：显示“基于上一份页面预览”。
- 当前文件被外部程序修改：进行中的讨论继续读取本轮 Discussion Snapshot，不受影响；发送修改或 Promotion 前必须进入现有外部冲突流程。
- 文件改名或 Stemmio 原子替换：通过 ID-first Working Copy 身份恢复；不得新建 Conversation。
- Document 身份无法安全确认：Conversation 只读，禁止新 Turn 和 Request，直到项目恢复。

### 20.4 Document 与项目切换

- 切换 Document 时侧栏立即清空并加载目标 Document 的 Conversation；不保留上一个 Document 的消息做过渡。
- 源 Document 的在飞 Turn 继续生成并保存，不被取消。
- 切回时若 Turn 已封存则读 Repository，未封存则读 Bridge 会话累积文本。
- 用户在采用过程中切换 Document 或项目：后台操作按身份完成；返回时恢复正确 Conversation 与状态。
- 应用级并发已满时新 Turn 排队，并在 Composer 内说明正在等待。

### 20.5 Promotion 与继续修改

- Promotion 失败：保持审阅和 Candidate，下一轮消息保持草稿，行动条提供重试采用或返回审阅。
- Promotion 成功：进入新 Working Copy 的 AI 预览，草稿保留，意图开关停在“交给 AI 修改”。此时尚未创建下一轮 Request，用户可以修改草稿后再发送。
- 用户发送下一轮失败：按第 11 节使用前检查失败处理，不回滚已提交 Version。
- 新 Request 已创建但 Qoder 启动失败：按 Agent Bridge 同 Request 安全重试/不可重试规则处理。

### 20.6 复制模式

- 剪贴板失败：Request 保留，提供重新复制或结束本轮。
- 已复制后用户结束：继续使用外部 Agent 风险确认；Stemmio 不声称停止外部进程。
- 外部 Agent 写回 Candidate：仍需 completion 与 Repository 校验。
- 外部聊天回复不在 Stemmio：历史只显示已复制、supplement 记录和最终 Candidate，不伪造对话。

## 21. 隐私、安全与遥测

### 21.1 本地数据

Conversation 可能包含 HTML、评论、用户要求、Qoder 回复和模型信息，属于项目内容。默认只保存在项目的受管本地目录，不进入系统剪贴板、Crash 日志或遥测。

Discussion Snapshot 是短命只读文件，Turn 结束即删除，不进入版本历史、导出 HTML 副本或备份。

### 21.2 禁止进入遥测

- 用户消息正文。
- Qoder 回复正文。
- HTML、评论、附件内容。
- 文件名、路径、项目名、Document 名和 Conversation 标题。
- 模型隐藏推理、Prompt、stderr、账号、组织或凭证。
- `conversationId`、`messageId`、`requestId` 等真实稳定身份。

允许的聚合信号仅包括经过分桶的模式使用、Turn 成败、目录加载状态、是否选择复制、是否进入审阅和是否采用；必须继续使用不可逆项目伪名且不允许反推内容。

### 21.3 Agent 输出

Stemmio 只展示 Qoder 明确作为用户可见消息发送的文本。内部 reasoning、思维链、工具原始结果和系统 Prompt 不进入 Conversation，也不进入内存投影。结构化工具进展必须经过 allowlist、限长和安全文案映射。

## 22. 可访问性与键盘行为

- AI 侧栏使用独立 `aside` landmark，不伪装 modal。
- Conversation 使用可浏览的日志语义；流式 token 不逐 token 触发屏幕阅读器。
- 当前阶段使用 `aria-live=polite` 的合并状态；失败与需要用户决定使用明确 alert/status。
- 行动条是稳定的命名区域。待决定动作出现时通知一次，不要求用户在消息日志中搜索按钮。
- Agent 选择器只显示 Logo 与 Agent 名称；菜单支持点击空白或 Escape 关闭，加载/错误说明单独就地呈现。
- 执行中 Composer 可输入草稿；发送按钮 disabled，旁边有可读原因，不能只靠颜色表达。
- “评”标记可键盘聚焦，焦点打开气泡；焦点离开前气泡不消失。只读态下 Enter/Space 不触发编辑。
- `Escape` 只关闭当前非破坏性浮层或收起侧栏，不取消 Request、不拒绝 Candidate。
- 意图开关支持箭头键、Home/End 和清晰的 pressed/selected 状态。
- “采用并继续”的内联说明在屏幕阅读器顺序中紧跟用户草稿，不把焦点强制送到页面顶部。
- 减少动态效果时保留所有状态变化，但关闭侧栏滑动、消息位移和阶段脉冲动画。

## 23. 用户文案合同

### 23.1 模式

| 场景 | 主文案 | 辅助文案 |
|---|---|---|
| AI 讨论 | `讨论 · 只读` | `Qoder 可以阅读当前预览，但不能修改 HTML。` |
| Request 执行 | `处理中` | 当前文件、发送给 Agent 的内容与当前可靠阶段。 |
| Candidate 就绪 | `待决定` | `版本 N 等待你的决定`，由带头像和名字的 Stemmio 消息呈现。 |
| 正式审阅 | `审阅 · 只读` | `讨论不会改变候选。` |
| 继续修改 | `采用并继续` | 不追加解释性阻断文案，由当前可用动作表达状态。 |

### 23.2 模型

| 状态 | 文案 |
|---|---|
| 加载 | `正在读取模型…` |
| 需要登录 | `登录 Qoder 后可发送` |
| 未安装 | `安装 Qoder CLI 后可发送` |
| 空目录 | `当前账号没有可用模型` |
| 上次模型失效 | `上次使用的模型已不可用，请确认当前模型后继续。` |
| 排队中 | `正在等待上一个任务完成` |

界面上不存在思考深度相关文案。

### 23.3 结果

| 场景 | 文案 |
|---|---|
| Qoder 完成 | `Qoder CLI 已完成本轮执行` |
| Stemmio 校验 | `Stemmio 正在核对完成记录与候选` |
| 候选通过 | `候选版本 N 已准备好` |
| 待决定提示 | `候选版本 N 等待你的决定` |
| 讨论草稿 | `仅保存草稿，不会发送给当前任务` |
| 迟到回复 | `这条回复基于上一份页面预览` |
| 拒绝候选 | `未采用候选版本 N，继续基于修改前页面` |
| 采用完成 | `候选版本 N 已成为当前页面` |
| 对话归档 | `上一段对话已归档` |
| 文本截断 | `部分内容已省略` |

## 24. 分期与并行拆分

冲突瓶颈只有两个文件：Agent Bridge 服务与受限 ACP 客户端。所有 Agent 能力改动都落在这两处。Conversation 持久化与侧栏界面几乎全是新文件，因此可以真并行。

### 24.1 波次一：三条可同时开工

| 包 | 内容 | 主要落点 | 依赖 |
|---|---|---|---|
| **P1-A** Conversation 持久化 | Schema、Conversation Repository（Bridge 独占写）、原子替换与 revision 递增、sequence 分配、崩溃恢复、500 条归档 | 新增 Schema 文件、新增 Repository 脚本与测试；工作区 Bridge 入口新增路由 | 无 |
| **P1-B** 侧栏界面骨架 | 顶部、消息流、行动条、Composer、意图开关，使用 fixture 数据，不接真实后端 | 新增 `app/workbench/` 侧栏模块与样式；Workbench 主文件挂载点 | 只需 P1-A 的 Schema 形状，不等实现 |
| **P1-C** 预览评论标记 | 抽共享只读标记与气泡组件（含键盘支持）；预览 bootstrap 测量已有源节点并回传位置；预览叠加标记层；审阅改用共享组件 | 共享标记新文件、`HtmlInteractionPreview`、`AiReviewWorkspace`、Workbench 主文件传参 | 无 |

三个包的新增代码互不重叠，可并行开工。

已知共享文件风险：

- **Workbench 主文件被 P1-B 和 P1-C 同时触及**（分别是侧栏挂载点与预览传参）。两者区域不同，但如果分开提交需要协调合并顺序；合在一个变更里提交可以避开。
- P1-A 的 Bridge 路由与 Qoder ACP Agent Bridge 分支有重叠区域，按 24.5 处理。

P1-C 不是“给现有标记加一个只读态”：预览模式不挂载编辑器组件，标记在那里不存在；而审阅已有的只读标记与编辑态标记视觉不一致且键盘不可达（见 7.2）。它的验收包括三件：AI 预览能看到“评”标记且 Hover/聚焦出评论详情、点击不进入编辑、预览与审阅使用同一个标记组件。

### 24.2 合并点 M1：必须串行

1. 侧栏改读真实 Conversation Repository。
2. 把现有交付、进度、决策与审阅入口迁入侧栏；进度使用既有阶段与事件计数渲染 Stemmio 自己的阶段文案。
3. 删除 Agent 交付弹窗与全屏等待工作台及其调用点。
4. 下调架构预算，使天花板跟随实际行数下降。

M1 结束时零新增 Agent 能力、不修改 ADR 0032，但产品已经具备单一 AI 入口、无模态、无全屏等待台、对话可持久化恢复。这是一个可交付的里程碑。

### 24.3 波次二：共享 Agent 文件，可并行开发、按序合并

| 包 | 内容 | 合并序 |
|---|---|---|
| **P2-D** 模型目录 | 使用前检查保留模型名称；可用性投影增加模型数组；同意记录落应用级偏好；后台预加载 | 先合，是 P2-E 的前置 |
| **P2-E** Discussion Host | 独立讨论策略、Discussion Snapshot 建立与清理、讨论 Bridge 路由、并发与排队 | 与 P2-F 并行开发 |
| **P2-F** 可见文本流 | 新 ADR 显式取代 ADR 0032 输出边界子句；放行可见文本块、丢弃隐藏推理；字节预算 | 任一顺序 |

三者改动的是不同函数：P2-D 改使用前检查，P2-E 新增导出与路由，P2-F 改事件构造与状态投影。实际冲突面小。P2-F 可以只在 Execution Turn 上验收，不必等 P2-E。

> **交付现状（2026-08-22）**
>
> - **P2-E 已交付**（PR #271）：独立讨论策略与只读 Host、短命快照的建立与删除（含超时/取消/异常路径，删除未确认即失败）、`POST /discussion/start` 与 `GET /discussion/status` 与 `POST /discussion/cancel`、渲染层 Session/Workflow 与 Composer 接线。**并发仅完成到单 Document 单在飞 Turn**；§17.5 第三条（全应用两个 Qoder 进程上限与排队）未实现，它需要执行与讨论共用一个进程名额门。
> - **P2-F 已交付**（PR #271，ADR 0036）：仅讨论模式放行可见文本，64 KiB 预算、去控制字符、超预算标记截断；`agent_thought_chunk` 与非文本块一律丢弃；执行模式预算为 0（行为不变，已测）。整轮随 `sealConversationTurn` 落盘，提问先存再发送。
> - **P2-D 尚未实现**（**不是阻塞**），且不再是 P2-E 的前置（P2-E 已在它之前交付）。详见 §10.1 的实现现状：`qodercli` 有 `-m/--model`，`--list-models` 也正常返回，所以模型选择可以做；待做的是把列表送到 Renderer（会拓宽 STATE_OWNERSHIP 边界，需显式修订）、把选中模型作为 `--model` 传给 spawn、以及落盘选择与每轮实际模型。

### 24.4 波次三

| 包 | 内容 | 依赖 |
|---|---|---|
| **P3-G** 采用并继续（两步） | Promotion 后回到新 Working Copy 的 AI 预览并保留草稿；意图开关自动切换 | M1 |
| **P3-H** 文档同步收口 | 第 26 节的联动文档 | 各包结论 |

### 24.5 合并顺序前置

Qoder ACP Agent Bridge 分支尚未合并，且与本 PRD 的多个包共享文件与文档。实施前必须先确定该分支的合并顺序，否则 P1-A、P1-B、P2-D、P2-E、P2-F 与文档同步都会反复解冲突。

## 25. 验收标准

### 25.1 设计原则

- [ ] 正常路径中不存在任何模态；模态只用于破坏性确认。
- [ ] 评论标记在编辑模式与 AI 预览中视觉完全一致。
- [ ] 预期内失败全部就地展开，不产生 Toast、不新开界面。
- [ ] 界面上不存在思考深度标签、说明或控件。
- [ ] 待决定动作在任何滚动位置都可见。
- [ ] 用户可见文案不含 2.7 列出的任何实现术语。
- [ ] 从“我想改”到执行不超过两次点击；从结果就绪到页面切换不超过一次点击。

### 25.2 页面与评论

- [ ] 编辑模式只显示可编辑画布和空间评论栏，不显示 AI 对话。
- [ ] 点击 AI 入口直接进入预览并展开侧栏，不弹模式说明。
- [ ] 返回编辑恢复空间评论栏，不丢 Conversation。
- [ ] AI 预览的“评”标记与编辑模式复用同一组件，只读态下点击不进入编辑。
- [ ] Hover 与键盘聚焦均可展开只读气泡；焦点离开前气泡不消失。
- [ ] 歧义/缺失评论不在页面左上角生成伪标记。
- [ ] 审阅两页默认不显示评论标记；工具栏开关默认关闭。

### 25.3 侧栏结构

- [ ] 消息流中不存在任何按钮或可变交互控件。
- [ ] 向上滚动查看历史时看不到失效按钮。
- [ ] 行动条在存在待决定动作时常驻可见，不随消息流滚动。
- [ ] 没有待决定动作时行动条不占空间。
- [ ] 意图开关在预览、待决定、审阅三态是同一个控件。
- [ ] 960px 最小窗口宽度下画布、标记、行动条、Composer 与审阅控件均可访问。

### 25.4 Conversation 与 Document

- [ ] Conversation、Context、Turn 和 Message 均使用稳定 ID。
- [ ] 消息绑定 `projectId + documentId + contextId + sourceSha256`。
- [ ] 切换 Document 时侧栏立即清空再加载，不出现跨 Document 混显。
- [ ] Document A 的 Conversation 中读不到 Document B 的任何记录。
- [ ] Document A 的在飞 Turn 在切换到 B 后继续生成并保存。
- [ ] 切回 A 时未封存 Turn 可继续观察流式进展。
- [ ] 应用级并发上限触发时 Turn 排队，不报不可处理的错误。
- [ ] 文件改名不新建 Conversation；HTML 字节变化建立新 Context。
- [ ] 重启后完成消息、草稿、模型和中断状态可恢复。
- [ ] 流式中断不会把部分回复标为 completed。
- [ ] 用户消息未持久化时不会发送 Qoder。
- [ ] 落盘记录中不存在未封存的流式片段。
- [ ] 消息数达到上限时自动归档并新建，旧记录不删除。
- [ ] Message 记录中不存在任何界面或交互字段。

### 25.5 模型

- [ ] 模型由用户显式选择；当前模型名在 Composer 中可见。
- [ ] 只有一个可用模型时不呈现无可选项的下拉框。
- [ ] 已授权用户在 AI 侧栏打开前优先获得后台预加载目录。
- [ ] 同意记录跨应用进程保留；模型列表不落盘。
- [ ] 加载/需要登录/未安装/暂时不可用/空目录均有明确状态与就地指引。
- [ ] 发送按钮在不可用时说明原因，不只是变灰。
- [ ] 模型切换只影响后续 Turn；历史保留原模型。
- [ ] 发送前复核模型仍可用；不静默降级。

### 25.6 权限

- [ ] Discussion Host 只读单个 Discussion Snapshot，无写文件、终端、finalizer、MCP 或任意路径读取能力。
- [ ] Discussion Host 不读取任何 Request 或 runtime 记录，也不需要它们存在。
- [ ] Discussion Snapshot 在 Turn 结束后被删除，不进入版本历史或导出。
- [ ] Execution Host 只读冻结 readOrder、只写唯一 Candidate、只调用固定 finalizer。
- [ ] Review Host 只读 before/Candidate，不能修改审阅状态或 HTML。
- [ ] Qoder 文本“完成”不会跳过 completion 与 Repository 校验。
- [ ] 普通讨论不会创建 Request、Candidate 或 Version。
- [ ] 三条并发不变量各有独立测试。

### 25.7 执行与结果

- [ ] Qoder 与 Stemmio 使用不同头像和文案权威。
- [ ] 执行始终显示冻结页面，不进入全屏等待工作台。
- [ ] 同一公开 Agent 消息的 token 原位更新；新的公开消息事件在同一头像下逐行展示。
- [ ] Agent 处理中显示动态 `Thinking`，结束、失败或中断后移除。
- [ ] 新内容在跟随态自动顶入视口；用户上滚时不抢滚动，并提供“有新进展”。
- [ ] 可见文本流只包含 Agent 明确面向用户的文本；隐藏推理不落盘、不进投影。
- [ ] 文本流超字节预算时截断并标注，不丢整条消息。
- [ ] 执行中可写草稿但不能发送，草稿不进入当前 Request。
- [ ] Candidate 就绪后仍显示修改前页面。
- [ ] `ready` 行动条显示审阅与直接采用；`attention` 只显示审阅。
- [ ] 额度类失败产生一条清楚的 Stemmio 消息；界面不出现额度余量或成本估算。

### 25.8 审阅与采用

- [ ] 审阅保留 AI 侧栏和 Conversation。
- [ ] 审阅普通讨论不采用、不修改 Candidate。
- [ ] “继续修改”只能由显式意图开关触发。
- [ ] “采用并继续”不使用模态弹窗，说明在 Composer 内联显示。
- [ ] Promotion 成功后回到新 Working Copy 的 AI 预览并保留草稿，此时尚未创建下一轮 Request。
- [ ] Promotion 失败保留 Candidate、审阅状态、用户草稿和模型选择。
- [ ] 返回修改前保留 Candidate、Conversation 和本轮记录。

### 25.9 复制与恢复

- [ ] 复制成功只表示剪贴板 readback 一致。
- [ ] Stemmio 不伪造外部 Agent 回复。
- [ ] Document 与项目切换后每个 Conversation/Run 恢复到正确归属。
- [ ] Bridge 重启、进程清理未知和残留继续遵守现有 fail-closed fence。
- [ ] 外部源冲突阻止 Request 冻结或 Promotion，不丢对话。
- [ ] 关闭项目、切换项目、切换 Document 与关闭应用前完成 Conversation drain。

### 25.10 隐私与可访问性

- [ ] 对话正文、HTML、路径、Document 名、模型隐藏推理和真实 ID 不进入遥测。
- [ ] AI 侧栏、模型选择、Composer、行动条、“评”标记与内联说明完整支持键盘。
- [ ] 流式状态不会逐 token 打扰屏幕阅读器。
- [ ] 颜色不是权限、错误或选中状态的唯一表达。
- [ ] 减少动态效果模式保留全部状态但移除非必要动画。

## 26. 文档与架构联动

实施本 PRD 时必须同步：

- `MVP_PRD.md`：修改评论、发给 AI、状态机、Candidate 与验收口径。
- `INTERACTION_FLOW.md`：删除正常路径交付弹窗和全屏等待工作台；加入两模式、侧栏三层结构、Conversation、模型、意图开关、审阅讨论和采用并继续。
- `DESIGN_LANGUAGE.md`：登记侧栏材质复用、行动条层级与安静优先在评论标记上的适用。
- `CHANGE_REQUEST_PROTOCOL.md`：冻结模型配置、Conversation/Turn 关联和下一 Request 顺序。
- `AI_SUPPLEMENT_AND_VALIDATION.md`：受管会话从“不注入后续聊天”调整为“讨论只读且不改写冻结 Request；修改必须新 Request”，并继续保留 supplement 审计边界。
- `VERSION_AND_PROJECT_FILES_PRD.md`：Version 与 Conversation/Turn/模型关联。
- `STATE_OWNERSHIP.md`：新增 ConversationSession、ConversationWorkflow、ConversationRepository、模型目录与独立 Discussion/Review Host 所有权；修订“Renderer 不接收模型数量”的条款以允许用户可选模型列表。
- `ARCHITECTURE_CONTRACT.md`：补充依赖方向、Bridge 路由、持久消息、drain 义务，以及“侧栏代码不进入 Workbench 主文件”的约束。
- `SECURITY_MODEL.md`：定义三类 Agent Host 的真实能力隔离、Discussion Snapshot 生命周期与模型目录刷新边界。
- `NOTIFICATION_MESSAGE_CATALOG.md`：新增模式、模型、排队、流式中断、文本截断、上下文漂移、对话归档与采用并继续文案。
- `TEST_STRATEGY.md`：增加 Schema、Repository、Bridge、Electron 端到端、重启、Document 切换、并发、键盘和 package 验证。
- `scripts/architecture-budget.json`：M1 删除交付弹窗与等待工作台后下调天花板；新增代码不得抬高 Workbench 主文件预算。
- 新 ADR 一：记录“Conversation 为 Document 级持久事实、AI 只在 Preview/Review、Discussion/Execution/Review Host 权限分离、模型目录预加载与用户可选、思考深度由 Qoder 默认且不呈现”。
- 新 ADR 二：显式取代 ADR 0032 中“公开 Agent 状态排除原始输出”的子句，定义可见文本流的 allowlist 与字节预算。不得静默改写 ADR 0032 的其余结论。

## 27. 最终产品口径

Stemmio 不是把聊天框贴到 HTML 编辑器旁边，而是把同一份真实页面上的讨论、修改与审阅连成一个可追溯的 Agent 工作流：

- 编辑时，用户专注编辑和评论。
- 进入 AI 后，页面自然切到预览，评论变成同一个“评”标记的只读态，对话出现在右侧。
- 对话跟着 Document 走，切换文档就切换对话，后台仍在生成的那一轮不会被打断。
- Qoder 在讨论时只能阅读一份短命只读快照；用户明确交给 AI 后才可以写独立 Candidate。
- 模型在用户进入前尽可能加载，在设置中选择；用户改不了的参数不出现在界面上。
- Qoder 展示它正在做什么，Stemmio 展示哪些结果已经被验证。
- 消息流只留不可变事实，当前该做的决定永远在视野里。
- Candidate 返回后，原页面保持不变，直到用户审阅、采用或拒绝。
- 继续修改就是先采用、再发送两个清楚的动作，不被弹窗打断，也不藏在一个跨事务的原子序列里。
- 每条对话、每个时间点、每个模型和每次修改都能回答：它针对哪一个 Document、哪一份 HTML、哪次 Request 和哪份 Candidate。

这套规则必须在不削弱现有 ID-first 身份、冻结 Request、Candidate 隔离、finalizer、Promotion 原子性与版本历史的前提下实现。

Conversation v2 records provider-neutral facts. Each Agent Turn carries its
requested/resolved provider selection, nullable validated binding and capability
snapshot fingerprint; each reply uses actor `agent`, provider id and actual
provider-namespaced model. v1 is projected in memory without rewriting bytes.
Unknown-provider history stays visible and reviewable but cannot restart.

### Current compact composer contract (2026-09)

The Settings default selects new turns; document-specific historical service overrides no
longer determine the composer. A frozen Request keeps its original Agent. The composer
shows a static identity, a persistent local draft and one send/stop action. Model, service
and reasoning selection live in Settings. Current decisions attach above the input and
never enter historical messages. Public progress uses the actual executor, preserves
message paragraph boundaries when sealed, and reveals metadata only on hover/focus.
The behavior and refresh matrix is owned by `INTERACTION_FLOW.md`.
