# Codex Subagent 路由决策

> 这是当前决策记录。生效配置位于 `.codex/config.toml`、`.codex/agents/`、`.agents/skills/` 和 `AGENTS.md`。

## 怎么使用

主模型与思考深度始终由用户选择。本项目启用 V2；普通 Sol/Astra 按下面的角色路由，其他主模型由子 Agent 继承。Ultra 使用原生路由与线程策略，不套第 5 节流程。

这不是自动加载的文档：主 Agent 在普通委派前按入口读取第 5 节，已读且未变则复用；子 Agent 收到自包含任务包与本次必要资料。角色决定职责，模型由路由决定。

## 1. 子 Agent 角色

这一节只确定职责，不选择模型。

| 角色 | 做什么 | 权限 | 是否保留 |
|---|---|---|---|
| `explorer` | 查找文件、代码路径、状态流和风险 | 只读 | 是，使用 Codex 内置角色 |
| `worker` | 根据明确任务修改代码并做短验证 | 可写 | 是，使用 Codex 内置角色 |
| `reviewer` | 独立检查错误、回归、竞态和测试缺口 | 只读 | 是，使用项目自定义角色 |
| `tester` | 运行现有测试并收集报告，不修改代码和测试 | 只写测试生成物 | 是，使用项目自定义角色 |

## 2. Sol 路由表

只要主 Agent 是 Sol 且不是 Ultra，无论用户选择 Low、Medium、High、XHigh 还是 Max，都使用这一张表。

| 子 Agent 角色 | 使用的模型 | 推理强度 | 什么时候调用 |
|---|---|---|---|
| `explorer` | `gpt-5.6-luna` | `max` | 按需调用 |
| `worker` | `gpt-5.6-luna` | `max` | 按需调用 |
| `reviewer` | `gpt-5.6-sol` | 最低 `high`，随主 Agent 向上对齐 | 按需调用 |
| `tester` | `gpt-5.6-luna` | `max` | 按需调用 |

## 3. Astra 路由表

只要主 Agent 是 Astra 且不是 Ultra，无论用户选择 Low、Medium、High、XHigh 还是 Max，都使用这一张表。

| 子 Agent 角色 | 使用的模型 | 推理强度 | 什么时候调用 |
|---|---|---|---|
| `explorer` | `gpt-5.6-luna` | `max` | 按需调用 |
| `worker` | `gpt-5.6-luna` | `max` | 按需调用 |
| `reviewer` | `gpt-6-astra` | 最低 `high`，随主 Agent 向上对齐 | 按需调用 |
| `tester` | `gpt-5.6-luna` | `max` | 按需调用 |

### Reviewer 对齐表

Reviewer 与主 Agent 使用同一模型家族，推理强度最低为 High；当主 Agent 为 XHigh 或 Max 时继续向上对齐。

| 主 Agent | Reviewer |
|---|---|
| Sol Low / Medium / High | Sol High |
| Sol XHigh | Sol XHigh |
| Sol Max | Sol Max |
| Astra Low / Medium / High | Astra High |
| Astra XHigh | Astra XHigh |
| Astra Max | Astra Max |
| Sol/Astra Ultra | 保持 Ultra 原生选择 |

## 4. Ultra

Sol Ultra 和 Astra Ultra 保持用户选择及 Codex 原生委派行为，不读取普通 Sol/Astra 路由表。

目前没有可核验的公开配置表明 Sol Ultra 与 Astra Ultra 使用不同的委派触发条件。因此普通 Sol/Astra 共同采用 Ultra 可观察到的核心原则：可独立并行且能明显改善速度或质量时主动委派。两者仍按各自路由表选择子 Agent 模型和推理强度。

- Ultra 是否仍固定使用某个 `tester`：否
- Ultra 是否仍要求一个独立 `reviewer`：否
- Ultra 的其他例外：不强制使用第 5 节的项目级路由证据、依赖分波、任务包和线程生命周期规则

## 5. 共用规则

本节由普通（非 Ultra）委派共用；Sol/Astra 只在路由上区分。主 Agent 按需读取，子 Agent 只接收本次任务所需的约定与资料。

### 5.1 推进与委派

对已授权的实现，主 Agent 持续推进到约定验收成立；规划、第一版代码或子 Agent 返回都不是完成。范围内修复、局部选择和必要复测自主处理；只有需要新授权、实质需求选择或无法解决的阻塞才询问用户。咨询、诊断和规划请求仍保持原范围。

具体、有界且独立执行能明显节省时间或提高质量时主动委派；优先探索、日志、测试、独立审查，也可交出方案明确的实现。没有固定的 Explorer → Worker → Tester → Reviewer 流水线。短小、紧耦合，或交接监督成本接近直接实现的工作留给主 Agent。主 Agent 继续不冲突的工作，结果成为依赖时才等待。

### 5.2 精简任务包

每次派发使用下列信息，可合并字段；不适用的扩展项直接省略：

```text
任务：ID、角色、目标与最终行为。
源码：绝对 checkout、base、HEAD；有相关未提交修改时附任务 diff 或 working-tree hash（含相关 untracked 文件）。
权限：允许读写、文件所有权、禁止动作；只读任务明确禁写，叶子 Agent 不再委派。
输入：已知事实、必要约束和 required_reading（路径、章节或符号；按任务附上适用的 `.agents/skills/` 入口，只给本次需要的那个）。
验收：关键场景、验证方法；需要持久证据时给出路径。
上报：何种新事实需暂停受影响部分；仍可安全继续的范围。
返回：任务 ID、建议状态、已读资料、实际源码身份、改动/证据、验证及偏离与阻塞。
```

只有涉及依赖或并行时才补 `depends_on`、相关任务、源版本、所有权和状态；只启动已就绪任务，核验完成才解锁依赖。失败、取消或未核验的工作不解锁；循环依赖重新拆分。端口、进程、构建目录、检查点和等待条件按需提供。

主 Agent 必须在消息中传递适用的权限与角色约定；内置 Worker 额外收到 5.3 的实现信息和执行约定。子 Agent 行动前读懂相关源码及 `required_reading`；缺失或冲突时报告具体阻塞。已读且未变资料不机械重读，源码变化或新问题才补充阅读。不要要求子 Agent 阅读整套管理规则、路由表或完整聊天；优先自包含任务包和 `fork_turns: "none"`。这只控制显式交接，不消除 Codex 自动注入或运行时继承的上下文。

### 5.3 Worker 交接

主 Agent 在“输入”中写清最终行为、已定关键方案及必要理由、相关文件/符号、必须保持的行为和公共接口；在权限和验收中给出修改范围、重要场景与验证方法。消除影响正确性的关键歧义即可，不逐行设计，也不先做完整实现。功能复杂本身不排除 Luna；若剩余工作持续依赖设计判断或交接不划算，主 Agent 保留或接回。

**每次发给内置 worker 的消息必须附上以下执行约定：**

```text
读懂要修改的实现及必要调用方、类型和测试，核对关键假设。在授权范围内自主完成局部实现、函数组织、类型适配、必要测试补充和针对性自检；无需先复述计划等批准。
保留他人修改，不扩大范围，不削弱断言或绕过检查。普通参数、类型或局部测试组织差异自行解决。
只有新事实推翻关键假设、改变约定行为/公共接口、扩大写入范围、需要新授权或使验收失效时，暂停受影响修改，向主 Agent 返回证据；不隐瞒阻塞，可继续明确安全且不受影响的部分。
返回实际改动、源身份、自检结果、重要偏离和未解决问题；完成声明不代替主 Agent 验收。
```

### 5.4 路由证据

由主 Agent 按任务 ID 关联角色、预期模型/强度、显式或继承方式与实际证据；不要求子 Agent 猜测或自证模型。核对客户端线程或子会话 `turn_context.model`、`effort`、`multi_agent_version`。不可见记为 `unverified`，不当作已证明或不匹配，也不自动否定已独立核验的工作结果。

不匹配时停止并不接受代码变更，用原预期重试一次；显式模型/强度确不可用时，先记原失败，再将省略模型和强度、继承主 Agent 作为该次重试的授权 fallback。原预期为继承则仍继承。该次重试仍失败或不匹配，记为 `failed`，保留只读证据，不解锁依赖。路由状态 `verified | fallback | unverified | mismatch` 与任务状态分开，最终记录实际值或不可见及 fallback。

### 5.5 所有权、纠偏与接回

普通模式最多 3 个子线程；同一 worktree 同时只有一个写者，包括主 Agent、测试生成物和报告；只读工作使用冻结源码。叶子 Agent 不再委派。按需明确文件、构建目录、端口与进程所有权。

规划/关键假设错误由主 Agent 修正规划；局部实现错误把具体证据交回原 Worker 修正。重复误解同一约束、一次聚焦纠正后仍无有效进展，或工作重新变成持续设计时，主 Agent 接回；普通一次编译错误不触发强制接管。Worker 上报不等于向用户申请审批，主 Agent 先在原授权内继续解决。

关键输入变化、越界、重复、源码过期或证据不足时发送聚焦纠偏。过期/被替代记 `cancelled`；错误源码、未授权操作、写入冲突或纠偏无进展记 `failed`。接管或修复前先停止受影响 Worker/Tester 及其拥有的进程、保留证据、确认写入权释放；不动无关进程或他人修改，不在测试尚运行时改冻结源码。

完成线程由运行时释放；仍占名额时只用客户端实际暴露的关闭能力，不虚构操作或超额启动。

### 5.6 验证与完成

Worker 完成局部自检；Tester 依现有角色指令在冻结源码上运行指定验证，保留首个失败和已有 runner retry 约定；Reviewer 只读检查实际 diff 和相关代码的正确性，不只核对是否照计划执行。异步、Harness 与资源类测试另按 `tests/TEST_STRATEGY.md` 与 `.agents/skills/stemmio-test-reliability/SKILL.md` 执行，评审方法按 `.agents/skills/stemmio-code-review/SKILL.md` 执行；角色 skill 只提供方法，不增加权限。角色按任务需要选择，不能替代仓库已有必需门禁。

主 Agent 按风险核对源码/base/相关 dirty 改动、权限与所有权、必读资料、实际 diff 和验收证据。源码、配置、环境与验证范围仍适用时复用证据；相关变化、失败、缺失覆盖或新疑点才重验受影响部分，不完整重复子 Agent 的阅读与测试。失效证据不签发完成，不隐去失败或靠重跑取绿。

主 Agent 在当前会话给出最终任务状态，关联路由记录、源码、改动/证据、验证、剩余限制与阻塞；有既存报告目录时可复用，不新建元数据系统。部分结果不能冒充主任务完成；授权边界及 P0/P1 scope-stop 规则仍适用。

## 6. 兼容性与验证

- 静态配置/文档检查不证明模型质量或每次交接正确；修改源码规则后，从该项目根目录开启新会话。已运行会话不会因文档修改自动清除上下文。
- 当前桌面端附带的 Codex CLI `0.153.4` 将 `multi_agent_v2` 标记为 stable，但官方配置参考尚未列出这个键；Codex 升级后需要重新验证。
- 已分别用普通 `gpt-5.6-sol` / `low` 和 `gpt-6-astra` / `low` 启动真实项目会话，两者的会话元数据均记录 `multi_agent_version: "v2"`。
- 2026-09-10 的两个真实子线程探针分别显式请求 `gpt-5.6-sol` / `high` 和 `gpt-5.6-luna` / `max`；子会话 `turn_context` 记录的实际模型、推理强度与请求一致，且均为 `multi_agent_version: "v2"`。这证明本次显式路由，不代替今后每次委派的运行证据。
- 同日的 Reviewer 顶档对齐探针分别显式请求 `gpt-6-astra` / `max` 和 `gpt-5.6-sol` / `max`；子会话 `turn_context` 记录均与请求一致且为 V2。这验证了 Sol/Astra Max Reviewer 不降级的显式路由能力，其他深度仍按每次委派记录实际证据。
- `features list` 不会反映本次项目级覆盖；验证时以从项目目录启动的真实会话元数据为准。

## 参考

共用规则参考官方的按需阅读与清理重复指令建议；Luna 路由、交接与验收边界是本项目的选择，不是官方质量保证。

- [OpenAI：Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)

- [OpenAI Docs：子智能体](https://learn.chatgpt.com/zh-Hans/docs/agent-configuration/subagents)
- [OpenAI Docs：模型与推理强度](https://learn.chatgpt.com/zh-Hans/docs/models?surface=app)
