# 源页：内部 AI 对话补充与候选校验（已实现）

- 实现版本：Stemmio 0.9.6
- 日期：2026-08-02
- 状态：已进入代码、Schema、历史记录与打包验证

## 1. 内部 AI 对话里的增量要求

本轮有效要求由两部分组成：

1. 源页发送时冻结的原始评论与本地编辑；
2. 复制模式下，用户随后在 QoderWork 或其他 Agent 对话里新增、修订或撤回的要求。

本节的对话补充只适用于用户自行维护的复制/manual conversation。受管 Qoder ACP 会话
只执行已经冻结的 Request/Attempt，Stemmio 不向会话注入后续聊天文本、图片或文件；
需要改变要求时应停止本轮并建立新 Request，不能绕过冻结边界修改原 Request。

第二部分不能直接改写冻结 Request。Prompt 要求内部 AI 先调用受控 helper，把用户原话写入当前 Attempt 的 `USER_SUPPLEMENT.json`，成功后才能执行。记录失败时必须停止执行该条补充。

记录采用追加式 `add / amend / retract`，旧记录不能覆盖。`add` 可通过 `refersTo` 指明它补充的原始 instruction；修订会替代被引用的旧 supplement，撤回会从最终有效要求中移除被引用记录。能够取得的原始文件会复制到 `supplement-attachments/` 并记录 SHA-256；只能看见、无法取得原件时记录 `description-only`，历史中明确显示“原件未归档”。finalizer 会先封存补充记录和附件 Hash，再生成完成记录。Attempt 结束后新增要求必须建立新 Request。

这套机制是项目协议，不是聊天平台同步：复制模式下，源页只确认受控记录成功，不能证明
剪贴板内容已经被 AI 平台接收，也不能证明平台内每条对话都被遵守。受管 ACP 的启动或
stop 事件同样不是 Candidate 完成证据；仍以官方 completion 与 Repository 校验为准。

## 2. 候选校验分级

不可忽略的硬校验包括：

- 项目、文档、Request、Attempt、Version 身份；
- 冻结输入、输出、completion、manifest、commit marker 的 Hash；
- 完整 HTML、受管路径、普通文件与无路径逃逸；
- 冻结源码元素 ID 的唯一性与连续性：拒绝重复、伪造和可疑丢失；同一有效 ID 跨 tag、parent 和 order 变化仍是同一元素；
- supplement 封存、引用、附件与 Hash；
- 管理元信息；
- 事务、工作副本与版本完整性。

完成记录和规范化比较通过后，Bridge 生成 `candidate-assessment.json`。它只回答两个
产品问题：返回的是不是完整、可显示的 HTML；它是否大体继承了上一版。脚本、inline
handler、可执行 URL 和 refresh 指令都属于候选内容，不参与检测、分级或用户提示。
连续性证据来自可见文字、稳定 id/data 属性、class、资源引用和 title，属于
粗粒度启发式，不宣称逐节点证明。

Stable ID 硬校验先于这个连续性分级。AI 必须保留仍存在元素的
`data-stemmio-id`；移动保留 ID，真正新增的元素不填 ID，由
Stemmio 验证后分配。不能确定是删除还是丢失时拒绝 Candidate，不做
启发式重绑。通过后同时封存 AI 原始输出 Hash、系统补 ID 后的完整
Candidate Hash 和 identity report；Review、Promotion 和新 Version 只读后者。

评论 TargetRef 和有效 supplement 继续指导 AI、审阅与历史解释，但不再授权或禁止某个
DOM 子树之外的普通正文、属性、结构或样式变化。这样可以避免 AI 把 `<p>` 改为 `<div>`、
重组卡片或同步调整相关样式时被误判为失败。连续性证据充分为 `ready`；证据不足但 HTML
可用为 `attention`，保留同一不可变候选并要求先审阅；不完整或空 body 为 `blocked`，
不创建 Version。

## 3. 结果审阅与打开方式

AI 结果通过校验后先创建不可变 Version 和独立 working HTML，运行态进入 `ready-to-open`：

- 左侧仍显示原来的当前 HTML；
- 原始评论和本地编辑继续锁定并保留；
- 重启应用后仍恢复“可打开”状态；
- `ready` 候选显示“审阅对比”和“直接打开”，默认突出“审阅对比”；`attention` 候选只显示“审阅对比”；
- “审阅对比”只读取冻结 HTML 与不可变 AI 候选，不激活候选；`页面预览`、`目录导航`、`局部聚焦`、`页面运行态`、`滚动方式` 和 `画布缩放` 保持正交，不再提供变化类型筛选。默认是“双页 + 同步滚动 + 适应画布”总览，第一次只定位首处变化而不聚焦；变化聚焦与评论聚焦的上下文偏好在设置中保存，默认分别为 25% / 15%；
- 分析器只生成精确文字事实与真实元素新增/删除事实。文字保留红色删除虚线、绿色逐字实点和短语/行/段落范围；元素只标最外层 unmatched 子树并写成“新增元素 / 删除元素”，内部元素和文字不重复标注。完全重写但自身结构相同的唯一元素继续配对为文字 diff；新增逻辑文字行仍是文字事实；
- 位置、兄弟顺序、属性、CSS、样式、排版、换行、computed style、Canvas/SVG 像素和运行态视觉不进入审阅集合。Review 没有截图 owner、PNG、像素阈值、冻结图表脚本或专用 IPC；评论定位继续使用 before-only 私有绑定，但不能改变文字/元素事实；
- “变化 N 处”目录与页边位置提示只揭示 Tab、定位并更新活动说明，不改变页面、上下文偏好或缩放。目录保留每个精确 region，页边可按阅读局部聚合密度。两份冻结文档的安全 action 成对映射，Tab、折叠、业务按钮和表单状态始终双向同步，独立滚动只关闭滚动联动；同步失败静默降级，不增加提示。同步滚动使用单一输入主控、稳定语义映射与每帧最新目标，快速反向或换侧会撤销旧代次，短页触底不强拉长页；锚点、聚焦几何和评论测量不进入滚动热路径。投影在动作、DOM/尺寸变化和字体完成后自动刷新，不依赖目录选择触发；
- 审阅画布允许原页面 Tab、折叠区等纯页内交互在隔离沙箱中运行，但禁止导航、提交、弹窗、下载和宿主 IPC，运行态变化不会保存；
- 审阅页不显示 Demo 标记；“返回 AI 修改前”逐行说明不采用本次返回、继续以修改前版本为基线，以及 AI HTML 保留，并允许直接打开本轮文件夹；确认后直接恢复原 HTML 编辑，评论和编辑记录不变，候选文件与记录不删除；
- “打开 AI 修改后”说明修改前版本与本轮记录仍保留，最终按钮为“确认并打开”；确认后不显示等待 AI 页面，先挂载编辑画布再调用既有激活事务；
- 只有 `ready` 用户点击“直接打开”，或任一可审阅候选在审阅页确认“打开 AI 修改后”，项目当前路径和左侧画布才切换；
- 点击前如果当前源文件被外部改动，系统拒绝切换并保留新 Version。

审阅投影把变化事实、region 几何和 paint plan 分开。精确 evidence 与导航提示始终可独立存在；显式聚焦每侧至多生成一个上下文遮罩孔，outline 则是可选决策：文字和普通属性无框，来源明确的结构变化可有局部框，style 只有视觉变化已确认才有框。遮罩不依赖框；框存在时复用同一 region 的 canonical path。每一页的遮罩使用以 session、side 和 projection epoch 唯一命名的 SVG luminance mask；受管 mask 背景、孔和 dim rect 会隔离作者 `svg path`、`mask rect` 与通用 `path/rect` 的 fill、stroke、opacity、filter、transform 污染。

## 4. 历史展示

每个 AI Version 按四组展示：

- 源页原始评论；
- 内部 AI 对话补充；
- 本地编辑；
- AI 结果与校验（包括 candidate assessment；旧版可含 validation review）。

Version manifest 仍保持不可变；历史通过其 `requestId + attemptId` 定位同一 Attempt 下的 supplement 和 candidate assessment。旧 `validation-review.json` 只读兼容，不再由新 Attempt 写入。

2026 年 8 月的短期 Developer Preview assessment 曾省略或写入现已退役的可执行表面
字段。历史 Version 查询或已归档终态查询会先核对冻结 base、不可变候选证据和四个 Hash，
再按当前文档健康与连续性规则重算，并把移除退役字段和脚本结论的结果作为内存投影；旧
Attempt 不改写，归档 outcome 不复活。

失败或 no-change 后，本轮处理页只有“返回编辑”。退出不会自动打开某条评论，也不会清除
outcome；workspace 返回最近终态，标题栏“上轮处理”可在退出后或重启后重新打开。开始
冻结下一轮 Request 时，才把这个入口更新为新一轮。

## Agent 身份纠错闭环

内置 HTTP Agent 在写入输出和运行 finalizer 前，使用同一 Candidate 身份校验器检查完整输出。
身份错误反馈给模型，保留冻结输入和本轮有效修改，只纠正身份；最多两次纠错，每次重新校验。
合法删除不恢复，新增元素不填写 ID。失败响应仅保留在内存，不写入候选或 completion。
重试前检查取消和当前 Attempt 权限，并检查模型上下文预算；网络、权限及其他非身份错误不重试。
连续失败返回普通生成失败，原页面保留。通过后仍执行原有 finalizer 和 Repository 全部校验。
受管 Codex、Qoder 共用的 ACP host 在输出落盘前执行相同身份检查；拒绝的写入不占用唯一成功写入名额。
每次拒绝将错误证据返回 Agent，允许最多两次纠正。若 Agent 随即停止，ACP driver 在同一会话内主动发送
纠错要求（最多两次），不改变冻结任务、权限或已完成输出。连续三次拒绝即终止。
所有路径共用的 finalizer 也在写 completion 前检查 ID，因此手动复制给其他 Agent 的任务不会提前封存错误输出。
冻结规则要求外部 Agent 读取错误后修正并重跑 finalizer；手动会话无法由应用主动唤醒，自动继续依赖外部 Agent 执行合同。
这些消息只纠正已有输出，不属于追加用户要求，不创建 supplement。
